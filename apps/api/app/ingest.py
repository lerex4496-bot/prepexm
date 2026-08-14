"""
Load assembled pipeline JSON into the authoring database.

Everything lands as review_status='pending'. This module has no code path that
can write 'approved' — that transition exists only in the review API, driven by
a human.

Re-running is safe: a paper is replaced wholesale, but any question that has
already been reviewed keeps its decision, note and audit trail.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .db import Base, SessionLocal, engine
from .models import Audit, Option, Paper, Question, REVIEW_PENDING


def confidence_for(q: dict) -> float:
    """
    Lower means "put this in front of a human sooner".

    Deliberately blunt and explainable — it orders a queue, it does not decide
    anything. Every deduction corresponds to a concrete defect the reviewer
    will see on screen.
    """
    score = 1.0
    warnings = q.get("warnings") or []
    score -= 0.25 * len(warnings)
    if len(q.get("options") or []) != 4:
        score -= 0.3
    if not any(o.get("isCorrect") for o in q.get("options") or []):
        score -= 0.3
    if not (q.get("stem") or {}).get("en"):
        score -= 0.3
    if q.get("multiKey"):
        score -= 0.05
    return max(0.0, round(score, 3))


class StructurallyUnsound(Exception):
    """The parsed paper cannot be imported as it stands."""


def assert_sound(path: Path, data: dict) -> None:
    """
    Refuse a paper whose question numbering is broken.

    Question ids are built as `<paper>-q<number>`, so two questions sharing a
    number share an id. Postgres rejects the second, which aborts the whole
    import — one malformed paper stopped every later paper from loading.

    But crashing was the SAFE failure. The dangerous version is the one where
    an upsert quietly overwrites the first question with the second, leaving a
    paper that looks complete and is missing content nobody can see is gone.

    A duplicate number always means the parse went wrong upstream — in the 2024
    Paper II booklets, passage prose is being captured as extra questions — so
    the paper is rejected here, loudly, rather than repaired by guesswork.
    """
    numbers = [q.get("number") for q in data.get("questions") or []]
    seen, dupes = set(), []
    for n in numbers:
        if n in seen:
            dupes.append(n)
        seen.add(n)
    if dupes:
        shown = ", ".join(str(d) for d in sorted(set(dupes))[:10])
        raise StructurallyUnsound(
            f"{len(dupes)} duplicate question numbers ({shown}) — parse is wrong, not importable"
        )


def drop_unusable(data: dict) -> list[int]:
    """
    Remove individual questions that cannot be stored, and say which.

    A question whose options repeat a label — two options both labelled "A" —
    violates the (question, label) uniqueness the schema enforces, and would
    abort the entire import. It comes from option text being split across
    columns and re-lettered, and it affects 44 questions across the corpus,
    almost all in Mathematics.

    Rejecting the whole PAPER for this would be the wrong trade: it throws away
    148 sound questions to avoid two broken ones. Duplicate question NUMBERS
    stay a paper-level rejection (see assert_sound) because that means the
    parse lost its place entirely; a duplicate option label is local damage.

    Nothing is repaired here — a question with ambiguous options is dropped,
    never guessed at.
    """
    kept, dropped = [], []
    for q in data.get("questions") or []:
        labels = [o.get("label") for o in q.get("options") or []]
        if len(labels) != len(set(labels)):
            dropped.append(q.get("number"))
        else:
            kept.append(q)
    data["questions"] = kept
    return dropped


def ingest_file(path: Path, db) -> tuple[str, int, int, list, list]:
    data = json.loads(path.read_text(encoding="utf-8"))
    assert_sound(path, data)
    dropped = drop_unusable(data)
    p = data["paper"]
    paper_id = p["id"]

    # Preserve human decisions across re-ingest — but ONLY while the content
    # they approved is unchanged. Also capture the correct-answer set so a
    # changed answer can invalidate a stale approval (see below).
    prior = {}
    for q in db.scalars(
        select(Question)
        .options(selectinload(Question.options))
        .where(Question.paper_id == paper_id)
    ):
        prior[q.id] = {
            "status": q.review_status,
            "by": q.reviewed_by,
            "at": q.reviewed_at,
            "note": q.review_note,
            "topic": q.topic_id,
            "correct": sorted(o.label for o in q.options if o.is_correct),
            "stem": q.stem_en or "",
        }

    existing = db.get(Paper, paper_id)
    if existing:
        db.delete(existing)
        db.flush()

    paper = Paper(
        id=paper_id,
        exam_code=p["examCode"],
        paper_type=p["paperType"],
        session_label=p["sessionLabel"]["en"],
        held_on=p["heldOn"],
        set_code=p.get("setCode", ""),
        source_pdf=p["sourcePdf"],
        key_pdf=p["keyPdf"],
        key_legend_verified=bool(p.get("keyLegendVerified")),
        total_questions=p["totalQuestions"],
        duration_min=p.get("durationMin", 150),
        source_type=p.get("sourceType", "PYQ"),
        review_status=REVIEW_PENDING,
    )
    db.add(paper)

    kept = 0
    invalidated: list[tuple] = []
    for q in data["questions"]:
        ex = q.get("extractionMethod") or {}
        region = q.get("hindiRegion") or {}
        qid = q["id"]

        question = Question(
            id=qid,
            paper_id=paper_id,
            group_id=q["groupId"],
            number=q["number"],
            part=q.get("part"),
            subject=q.get("subject"),
            stem_en=(q.get("stem") or {}).get("en", ""),
            stem_hi=(q.get("stem") or {}).get("hi"),
            passage_en=(q.get("passage") or {}).get("en"),
            passage_hi=(q.get("passage") or {}).get("hi"),
            extraction_en=ex.get("en"),
            extraction_hi=ex.get("hi"),
            source_page=q.get("sourcePage"),
            hindi_page=region.get("page"),
            hindi_bbox=region.get("bbox"),
            key_raw=q.get("keyRaw"),
            multi_key=bool(q.get("multiKey")),
            status=q.get("status", "ok"),
            topic_id=q.get("topicId") or None,
            difficulty=q.get("difficulty", "medium"),
            source_type=q.get("sourceType", "PYQ"),
            provenance={
                "sourcePdf": p["sourcePdf"],
                "keyPdf": p["keyPdf"],
                "setCode": p.get("setCode"),
                "parser": "ctet_parse/ctet_assemble",
            },
            warnings=q.get("warnings") or [],
            confidence=confidence_for(q),
            review_status=REVIEW_PENDING,
        )

        new_correct = sorted(
            o["label"] for o in (q.get("options") or []) if o.get("isCorrect")
        )
        new_stem = (q.get("stem") or {}).get("en", "")

        if qid in prior:
            pr = prior[qid]
            # An approval attests to specific content. If the correct answer or
            # the stem has changed underneath it, that attestation no longer
            # means anything and MUST NOT carry over — otherwise a pipeline fix
            # silently ships content no human ever actually approved.
            changed = pr["correct"] != new_correct or pr["stem"] != new_stem
            if changed and pr["status"] != REVIEW_PENDING:
                invalidated.append(
                    (qid, q["number"], pr["status"], pr["correct"], new_correct)
                )
                question.review_status = REVIEW_PENDING
                question.review_note = (
                    f"auto-reset on re-ingest: content changed "
                    f"(correct {pr['correct']} -> {new_correct})"
                )
            else:
                question.review_status = pr["status"]
                question.reviewed_by = pr["by"]
                question.reviewed_at = pr["at"]
                question.review_note = pr["note"]
                kept += 1
            question.topic_id = pr["topic"] or question.topic_id

        for o in q.get("options") or []:
            question.options.append(
                Option(
                    label=o["label"],
                    text_en=(o.get("text") or {}).get("en", ""),
                    text_hi=(o.get("text") or {}).get("hi"),
                    is_correct=bool(o.get("isCorrect")),
                )
            )
        db.add(question)

    for qid, num, was, old_correct, new_correct in invalidated:
        db.add(
            Audit(
                question_id=qid,
                action="invalidated",
                field="review_status",
                old_value=f"{was} (correct={old_correct})",
                new_value=f"pending (correct={new_correct})",
                actor="system",
            )
        )

    db.commit()
    return paper_id, len(data["questions"]), kept, invalidated, dropped


def one_set_per_sitting(files: list[Path]) -> list[Path]:
    """
    Keep one file per (paper type, exam date).

    CBSE prints four sets of each paper — the same questions in a different
    order so neighbours cannot copy. Set O and set P of 01 March are the SAME
    150 questions, so importing every set would multiply the bank without
    adding a single new question, and would serve her the same question four
    times in one practice session.

    Where a sitting was parsed more than once, the file with the most questions
    carrying an official answer wins.
    """
    groups: dict[tuple[str, str], list[tuple[int, Path]]] = {}
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        paper = data.get("paper") or {}
        key = (paper.get("paperType"), paper.get("heldOn"))
        if not all(key):
            continue
        keyed = sum(
            1
            for q in data.get("questions") or []
            if any(o.get("isCorrect") for o in q.get("options") or [])
        )
        groups.setdefault(key, []).append((keyed, f))

    chosen = []
    for key in sorted(groups, key=lambda k: (k[0] or "", k[1] or "")):
        members = sorted(groups[key], key=lambda m: (-m[0], m[1].name))
        chosen.append(members[0][1])
        for _keyed, dropped in members[1:]:
            print(f"  skipping {dropped.name} — same sitting as {members[0][1].name}")
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser(description="Import parsed papers as review_status=pending.")
    ap.add_argument(
        "--glob",
        default="ctet_ctet_p*.json",
        help="which parsed files to import (default: the original naming only)",
    )
    ap.add_argument(
        "--all-sets",
        action="store_true",
        help="import every set of a sitting; by default only one is kept, "
             "because the sets are the same questions reshuffled",
    )
    args = ap.parse_args()

    Base.metadata.create_all(engine)
    root = Path(__file__).resolve().parents[3]
    files = sorted((root / "content" / "parsed").glob(args.glob))
    if not files:
        print(f"no parsed papers matched {args.glob!r}")
        return 1
    if not args.all_sets:
        files = one_set_per_sitting(files)

    with SessionLocal() as db:
        total = 0
        total_invalid = 0
        rejected: list[tuple[str, str]] = []
        for f in files:
            # One unsound paper must not stop the rest loading. The session is
            # rolled back so a partial write from the failed paper cannot leak
            # into the next one's transaction.
            try:
                pid, n, kept, invalid, dropped = ingest_file(f, db)
            except StructurallyUnsound as e:
                db.rollback()
                rejected.append((f.name, str(e)))
                continue
            note = f" ({kept} prior reviews preserved)" if kept else ""
            if dropped:
                note += f"  [dropped {len(dropped)}: duplicate option labels on Q{', Q'.join(str(d) for d in dropped)}]"
            print(f"  {f.name:44} -> paper {pid}  {n} questions{note}")
            if invalid:
                total_invalid += len(invalid)
                print(f"      !! {len(invalid)} prior approvals INVALIDATED — answer changed:")
                for qid, num, was, old_c, new_c in invalid[:6]:
                    print(f"         Q{num:<4} was {was}, correct {old_c} -> {new_c}")
                if len(invalid) > 6:
                    print(f"         ... and {len(invalid) - 6} more")
            total += n
        ok = len(files) - len(rejected)
        print(f"\ningested {total} questions from {ok} papers, all review_status=pending")
        if rejected:
            print(f"\n{len(rejected)} papers REJECTED — not imported:")
            for name, why in rejected:
                print(f"  {name}\n      {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

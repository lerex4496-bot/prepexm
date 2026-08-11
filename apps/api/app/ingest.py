"""
Load assembled pipeline JSON into the authoring database.

Everything lands as review_status='pending'. This module has no code path that
can write 'approved' — that transition exists only in the review API, driven by
a human.

Re-running is safe: a paper is replaced wholesale, but any question that has
already been reviewed keeps its decision, note and audit trail.
"""

from __future__ import annotations

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


def ingest_file(path: Path, db) -> tuple[str, int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
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
    return paper_id, len(data["questions"]), kept, invalidated


def main() -> int:
    Base.metadata.create_all(engine)
    root = Path(__file__).resolve().parents[3]
    files = sorted((root / "content" / "parsed").glob("ctet_ctet_p*.json"))
    if not files:
        print("no assembled papers found — run tools/ctet_corpus.py first")
        return 1

    with SessionLocal() as db:
        total = 0
        total_invalid = 0
        for f in files:
            pid, n, kept, invalid = ingest_file(f, db)
            note = f" ({kept} prior reviews preserved)" if kept else ""
            print(f"  {f.name:44} -> paper {pid}  {n} questions{note}")
            if invalid:
                total_invalid += len(invalid)
                print(f"      !! {len(invalid)} prior approvals INVALIDATED — answer changed:")
                for qid, num, was, old_c, new_c in invalid[:6]:
                    print(f"         Q{num:<4} was {was}, correct {old_c} -> {new_c}")
                if len(invalid) > 6:
                    print(f"         ... and {len(invalid) - 6} more")
            total += n
        print(f"\ningested {total} questions from {len(files)} papers, all review_status=pending")
    return 0


if __name__ == "__main__":
    sys.exit(main())

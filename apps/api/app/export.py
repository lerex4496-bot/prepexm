"""
Export APPROVED content to the SQLite bundle the mobile app ships.

This is the enforcement point for:

    SOURCE -> EXTRACT -> VALIDATE -> HUMAN REVIEW -> APPROVED -> APP

The `review_status = 'approved'` filter is in the SELECT itself, not applied
afterwards and not left to the caller, so there is no code path by which parser
output, OCR output, converted legacy text or LLM output reaches a student
without a human decision. A paper with zero approved questions exports as an
empty bundle rather than silently falling back to pending rows.

The bundle also carries, per question, the extraction method and the source
page/bbox — so provenance survives all the way onto the device.
"""

from __future__ import annotations

import argparse
import hashlib
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .db import SessionLocal
from .models import Paper, Question, REVIEW_APPROVED, REVIEW_PENDING

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = ROOT / "apps" / "mobile" / "assets" / "content" / "studymate.db"

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE papers (
  id               TEXT PRIMARY KEY,
  exam_code        TEXT NOT NULL,
  paper_type       TEXT NOT NULL,
  session_label    TEXT NOT NULL,
  held_on          TEXT NOT NULL,
  set_code         TEXT,
  source_type      TEXT NOT NULL,
  total_questions  INTEGER NOT NULL,
  duration_min     INTEGER NOT NULL,
  total_marks      INTEGER NOT NULL
);

CREATE TABLE questions (
  id             TEXT PRIMARY KEY,
  paper_id       TEXT NOT NULL REFERENCES papers(id),
  number         INTEGER NOT NULL,
  part           TEXT,
  subject        TEXT,
  stem_en        TEXT NOT NULL,
  stem_hi        TEXT,
  -- Comprehension passage, repeated on each question of its block. The app
  -- renders it above the stem; a question that asks about a text must ship
  -- with that text.
  passage_en     TEXT,
  passage_hi     TEXT,
  extraction_en  TEXT,
  extraction_hi  TEXT,
  topic_id       TEXT,
  difficulty     TEXT,
  explanation_en TEXT,
  explanation_hi TEXT,
  -- Gujarati is the NEET student's medium. Present in the bundle schema even
  -- while the CTET corpus leaves it null, so the app's language resolver can
  -- report "no Gujarati for this question" from the DATA rather than from a
  -- missing column.
  explanation_gu TEXT,
  source_type    TEXT NOT NULL,
  -- 'ok' | 'bonus'. Bonus means the official key accepted every option, so any
  -- attempt scores. The app's scorer must honour this.
  status         TEXT NOT NULL,
  multi_key      INTEGER NOT NULL DEFAULT 0,
  key_raw        TEXT,
  source_page    INTEGER
);
CREATE INDEX idx_q_paper ON questions(paper_id, number);

CREATE TABLE options (
  question_id TEXT NOT NULL REFERENCES questions(id),
  label       TEXT NOT NULL,
  text_en     TEXT NOT NULL,
  text_hi     TEXT,
  is_correct  INTEGER NOT NULL,
  PRIMARY KEY (question_id, label)
);
"""



# Questions that are pending ONLY because an explanation was written onto them
# after they were approved.
#
# The gate is right to send those back: the explanation is new content and no
# human has read it. But it invalidates the WHOLE question, and the stem,
# options and answer key are byte-for-byte what a reviewer already signed off.
# Left alone, one batch run took the shippable bank from 368 questions to 216 —
# not because anything became doubtful, but because something was added
# alongside it.
#
# So those questions can ship at their APPROVED STATE: the reviewed content, and
# the unreviewed explanation stripped out. Nothing a human has not read reaches
# the student, which is the actual rule; the explanation reappears once it is
# reviewed.
#
# Matched on the exact notes written by the two code paths that do this. Anything
# pending for a CONTENT reason — a changed answer key, a failed validation — does
# not match and stays out, which is the important half.
EXPLANATION_ONLY_NOTES = (
    "returned to review: explanation added after approval",
    "returned to review: LLM explanation added after approval",
)

def export(out_path: Path, require_full_paper: bool = True,
    include_reapprovable: bool = False,
) -> dict:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    con = sqlite3.connect(out_path)
    con.executescript(SCHEMA)

    stats = {"papers": 0, "questions": 0, "options": 0, "skipped_papers": []}

    with SessionLocal() as db:
        papers = db.scalars(select(Paper).order_by(Paper.paper_type)).all()

        for p in papers:
            approved = db.scalars(
                select(Question)
                .options(selectinload(Question.options))
                .where(
                    Question.paper_id == p.id,
                    # THE GATE. Do not move this into a Python-side filter.
                    Question.review_status == REVIEW_APPROVED,
                )
                .order_by(Question.number)
            ).all()

            # Optionally re-admit questions whose only un-reviewed part is an
            # explanation. They are exported WITHOUT it — see the note above.
            reapprovable: list[Question] = []
            if include_reapprovable:
                reapprovable = db.scalars(
                    select(Question)
                    .options(selectinload(Question.options))
                    .where(
                        Question.paper_id == p.id,
                        Question.review_status == REVIEW_PENDING,
                        Question.review_note.in_(EXPLANATION_ONLY_NOTES),
                    )
                    .order_by(Question.number)
                ).all()
                stats["reapprovable"] = stats.get("reapprovable", 0) + len(reapprovable)
                approved = sorted(approved + reapprovable, key=lambda q: q.number)

            # Ids whose explanation must be blanked on the way out.
            strip_explanations = {q.id for q in reapprovable}

            if not approved:
                stats["skipped_papers"].append((p.paper_type, "no approved questions"))
                continue

            # A partially-approved paper would present as a complete exam while
            # silently missing questions, which corrupts scoring and percentile
            # feel. Ship whole papers only, unless explicitly overridden.
            if require_full_paper and len(approved) != p.total_questions:
                stats["skipped_papers"].append(
                    (p.paper_type, f"{len(approved)}/{p.total_questions} approved")
                )
                continue

            con.execute(
                "INSERT INTO papers VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    p.id, p.exam_code, p.paper_type, p.session_label, p.held_on,
                    p.set_code, p.source_type, len(approved), p.duration_min, len(approved),
                ),
            )
            stats["papers"] += 1

            for q in approved:
                con.execute(
                    "INSERT INTO questions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        q.id, q.paper_id, q.number, q.part, q.subject,
                        q.stem_en, q.stem_hi, q.passage_en, q.passage_hi,
                        q.extraction_en, q.extraction_hi,
                        q.topic_id, q.difficulty,
                        # Blanked for a re-admitted question: its explanation
                        # has not been reviewed, so it does not ship.
                        None if q.id in strip_explanations else q.explanation_en,
                        None if q.id in strip_explanations else q.explanation_hi,
                        None if q.id in strip_explanations else q.explanation_gu,
                        q.source_type, q.status, int(q.multi_key), q.key_raw, q.source_page,
                    ),
                )
                stats["questions"] += 1
                for o in q.options:
                    con.execute(
                        "INSERT INTO options VALUES (?,?,?,?,?)",
                        (q.id, o.label, o.text_en, o.text_hi, int(o.is_correct)),
                    )
                    stats["options"] += 1

    built = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # A partial bundle is a development artefact and must announce itself, so
    # an incomplete paper can never be mistaken for a shippable one on device.
    for k, v in (
        ("schema_version", "1"),
        ("built_at", built),
        ("source", "studymate authoring plane"),
        (
            "gate",
            "review_status=approved only"
            if not include_reapprovable
            else "approved + explanation-only pending (explanations stripped)",
        ),
        ("completeness", "whole-papers-only" if require_full_paper else "PARTIAL-DEV-BUILD"),
    ):
        con.execute("INSERT INTO meta VALUES (?,?)", (k, v))

    con.commit()
    con.execute("VACUUM")
    con.close()

    digest = hashlib.sha256(out_path.read_bytes()).hexdigest()
    con = sqlite3.connect(out_path)
    con.execute("INSERT INTO meta VALUES ('sha256_at_build', ?)", (digest,))
    con.commit()
    con.close()

    stats["path"] = str(out_path)
    stats["bytes"] = out_path.stat().st_size
    stats["sha256"] = digest
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument(
        "--include-reapprovable",
        action="store_true",
        help=(
            "also ship questions that went back to review ONLY because an "
            "explanation was added, with that explanation stripped out"
        ),
    )
    ap.add_argument(
        "--allow-partial",
        action="store_true",
        help="export papers that are only partly approved (default: whole papers only)",
    )
    args = ap.parse_args()

    s = export(
        args.out,
        require_full_paper=not args.allow_partial,
        include_reapprovable=args.include_reapprovable,
    )
    print("=" * 60)
    print("APPROVED-ONLY EXPORT")
    print("=" * 60)
    print(f"  papers    : {s['papers']}")
    print(f"  questions : {s['questions']}")
    print(f"  options   : {s['options']}")
    print(f"  bytes     : {s['bytes']:,}")
    print(f"  sha256    : {s['sha256'][:16]}…")
    print(f"  path      : {s['path']}")
    if s["skipped_papers"]:
        print("\n  skipped:")
        for name, why in s["skipped_papers"]:
            print(f"    {name:18} {why}")
    if s["questions"] == 0:
        print("\n  Bundle is EMPTY — nothing has been approved yet. That is the gate working.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

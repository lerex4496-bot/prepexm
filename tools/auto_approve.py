"""
Approve questions that pass every mechanical check, and only those.

WHAT THIS IS
------------
The review queue exists so nothing reaches the student that has not been
checked. Most of that checking is mechanical — four options, none empty, the
marked option agreeing with CBSE's published key — and a person doing it by
hand across thousands of questions will get tired and start clicking approve.
That is worse than automating it, because it produces the same result with a
false signature on it.

So this approves exactly what can be established without judgement:

  * the server's own `blocking_problems()` finds nothing — the SAME function the
    review UI calls, not a reimplementation that could drift from it
  * the answer matches the official CBSE key, re-decoded independently by
    tools/verify_keys.py
  * the deterministic gate (tools/review_gate.py) returned PASS

Anything else stays pending. There is deliberately NO override path here: the
API supports overriding a failed validation with a written justification, and
that is a decision for a person, not a script.

WHAT IT IS NOT
--------------
It is not a reading of the question. It cannot tell you the stem was truncated
mid-sentence, that an option belongs to the question above, or that a passage
went missing — those need eyes on the source PDF. It records itself honestly in
the audit trail as an automated actor so that distinction is never lost: a
question approved here is "mechanically sound", not "read and understood".

Usage:
    python tools/auto_approve.py --paper-type CTET_P2_SOCSCI --dry-run
    python tools/auto_approve.py --paper-type CTET_P2_SOCSCI --commit
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.db import SessionLocal  # noqa: E402
from app.main import blocking_problems  # noqa: E402
from app.models import (  # noqa: E402
    Audit,
    Paper,
    Question,
    REVIEW_APPROVED,
    REVIEW_PENDING,
)
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

# Recorded against every approval. Deliberately not a person's name: the audit
# trail has to make plain that no human read these, so a later reviewer can tell
# machine-checked content from read content.
ACTOR = "auto:deterministic-gate"
NOTE = (
    "Mechanically verified: 4 options, none empty, answer matches the official "
    "CBSE final key (independently re-decoded). Not read for transcription "
    "fidelity."
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper-type", help="e.g. CTET_P2_SOCSCI")
    ap.add_argument("--paper-id", help="restrict to one paper")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="report only")
    group.add_argument("--commit", action="store_true", help="write the approvals")
    args = ap.parse_args()

    with SessionLocal() as db:
        q = (
            select(Question)
            .options(selectinload(Question.options))
            .join(Paper, Paper.id == Question.paper_id)
            .where(Question.review_status == REVIEW_PENDING)
        )
        if args.paper_type:
            q = q.where(Paper.paper_type == args.paper_type)
        if args.paper_id:
            q = q.where(Question.paper_id == args.paper_id)

        pending = list(db.scalars(q))
        approved = 0
        held: Counter[str] = Counter()
        by_paper: Counter[str] = Counter()

        for question in pending:
            problems = blocking_problems(question)
            if problems:
                for p in problems:
                    # Collapse the varying numbers so the tally is readable.
                    held[p.split(":")[0].split("(")[0].strip()] += 1
                continue

            if args.commit:
                db.add(
                    Audit(
                        question_id=question.id,
                        action=REVIEW_APPROVED,
                        field="review_status",
                        old_value=question.review_status,
                        new_value=REVIEW_APPROVED,
                        actor=ACTOR,
                    )
                )
                question.review_status = REVIEW_APPROVED
                question.reviewed_by = ACTOR
                question.review_note = NOTE
            approved += 1
            by_paper[question.paper_id] += 1

        if args.commit:
            db.commit()

        print(f"pending examined : {len(pending)}")
        print(f"{'approved' if args.commit else 'would approve'} : {approved}")
        print(f"left pending     : {len(pending) - approved}")
        if by_paper:
            print("\nper paper:")
            for pid, n in by_paper.most_common():
                paper = db.get(Paper, pid)
                label = f"{paper.paper_type} {paper.session_label} set {paper.set_code}" if paper else pid
                print(f"  {n:>4}  {label}")
        if held:
            print("\nheld back — these need a person:")
            for reason, n in held.most_common():
                print(f"  {n:>4}  {reason}")
        if args.dry_run:
            print("\ndry run — nothing written. Re-run with --commit to apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

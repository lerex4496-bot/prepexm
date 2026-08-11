"""
Re-render the explanations that failed their stage-1/stage-2 checks.

WHY THIS EXISTS AS A SEPARATE PASS
----------------------------------
`twostage.render_stage2` now retries once when the checks fail, but the long
generation run was started before that existed and cannot pick it up — a Python
process holds the module it imported. So every failure from that run sits in
`explanation_runs` with `passed = false`, and the broken text sits on the
question, flagged.

Rather than repair them one at a time as they appear, this sweeps them all at
the end.

WHAT A FAILURE ACTUALLY LOOKED LIKE
-----------------------------------
Measured, not hypothetical. On q095 stage 1 produced three substantive
distractor explanations for A, B and D; stage 2 returned a single entry reading

    {"label": "C", "why_wrong": "विकल्प C"}

— one stub, no content, and labelling the CORRECT option as a distractor. It is
a bad roll rather than a bad prompt: the identical input renders correctly on a
second attempt. That is exactly what makes a sweep worthwhile.

WHAT IT WILL NOT DO
-------------------
It never keeps a re-render that also fails. If the second attempt is no better,
the original stays flagged for a human. Silently swapping in whichever attempt
looked nicer would convert a visible failure into an invisible one, which is
the opposite of what the checks are for.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal, migrate  # noqa: E402
from app.llm import LLMError  # noqa: E402
from app import providers as reg  # noqa: E402
from app import twostage as ts  # noqa: E402
from app.models import Audit, ExplanationRun, Question  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    migrate()
    with SessionLocal() as db:
        failed = list(
            db.scalars(
                select(ExplanationRun)
                .where(ExplanationRun.passed.is_(False))
                .order_by(ExplanationRun.id)
            )
        )

        # A failed run that has since been superseded by a passing one for the
        # same question and language is already fixed — the failure is history,
        # not a defect. Re-rendering it would be a paid call to solve a problem
        # that no longer exists.
        already_ok = {
            (r.question_id, r.lang)
            for r in db.scalars(
                select(ExplanationRun).where(ExplanationRun.passed.is_(True))
            )
        }
        superseded = [r for r in failed if (r.question_id, r.lang) in already_ok]
        failed = [r for r in failed if (r.question_id, r.lang) not in already_ok]
        if superseded:
            print(f"{len(superseded)} already repaired by a later run — skipping those")
        if args.limit:
            failed = failed[: args.limit]

        print(f"{len(failed)} failed renderings to repair\n")
        if not failed:
            return 0
        if args.dry_run:
            for r in failed:
                probs = (r.verification or {}).get("problems", [])
                print(f"  {r.question_id} [{r.lang}] {probs}")
            return 0

        repaired = stubborn = skipped = 0
        for i, run in enumerate(failed, 1):
            q = db.get(Question, run.question_id)
            if q is None:
                skipped += 1
                continue

            correct = [o.label for o in q.options if o.is_correct]
            if not correct:
                skipped += 1
                continue

            try:
                res = ts.explain_two_stage(
                    db,
                    stem=q.stem_en,
                    options=[(o.label, o.text_en) for o in q.options],
                    correct_labels=correct,
                    lang=run.lang,
                    is_bonus=q.status == "bonus",
                    subject=q.subject,
                    passage=q.passage_en,
                )
            except (LLMError, reg.NoProviderError) as e:
                stubborn += 1
                print(f"  [{i}/{len(failed)}] {run.question_id} [{run.lang}] ERROR {str(e)[:80]}")
                continue

            if not res.passed:
                stubborn += 1
                print(
                    f"  [{i}/{len(failed)}] {run.question_id} [{run.lang}] STILL FAILING "
                    f"{res.verification.get('problems')}"
                )
                continue

            field = f"explanation_{run.lang}"
            setattr(q, field, res.prose)
            run.passed = True
            run.verification = {**res.verification, "note": "repaired by a later re-render"}
            run.stage2_text = res.stage2.text if res.stage2 else None
            run.stage2_ms = res.stage2.ms if res.stage2 else None
            db.add(
                Audit(
                    question_id=q.id,
                    action="explain_repaired",
                    field=field,
                    old_value=None,
                    new_value=res.prose[:400],
                    actor="repair:two_stage",
                )
            )
            db.commit()
            repaired += 1
            print(f"  [{i}/{len(failed)}] {run.question_id} [{run.lang}] repaired")

        print()
        print(f"  repaired        : {repaired}")
        print(f"  still failing   : {stubborn}   (left flagged for a human)")
        print(f"  skipped         : {skipped}")
        print("\n  APPROVED by this tool : 0   (approval happens only in Content Review)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

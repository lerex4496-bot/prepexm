"""
Run the two-stage explanation pipeline over a batch of questions and report
what actually happened.

WHY A SEPARATE TOOL AND NOT A LOOP IN THE API
---------------------------------------------
Generating explanations for the whole bank is a long, resumable, interruptible
job — 369 questions across three languages at roughly a minute each. That is not
an HTTP request. Running it here means it can be stopped and restarted, it skips
work already done, and it reports honest aggregate numbers rather than a
success/fail per call that nobody totals up.

WHAT IT WILL NOT DO
-------------------
Nothing here approves anything. Every explanation lands with the question in the
review queue, exactly as a single call would. `--status approved` is available
but warns first: writing an explanation onto an approved question RETURNS IT TO
PENDING by design, so a careless batch can empty the shipping bundle.

Usage:
  python tools/explain_batch.py --lang hi --limit 20            # pending only
  python tools/explain_batch.py --lang en,hi --all --resume     # one stage 1, two renders
  python tools/explain_batch.py --lang hi --limit 20 --status approved --yes
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal, migrate  # noqa: E402
from app.llm import LLMError  # noqa: E402
from app import providers as reg  # noqa: E402
from app import twostage as ts  # noqa: E402
from app.models import (  # noqa: E402
    Audit,
    ExplanationRun,
    Question,
    REVIEW_APPROVED,
    REVIEW_PENDING,
)


def pick(db, *, langs: list[str], status: str | None, limit: int | None, resume: bool) -> list[Question]:
    from sqlalchemy import or_

    stmt = select(Question).order_by(Question.paper_id, Question.number)
    if status:
        stmt = stmt.where(Question.review_status == status)
    if resume:
        # Keep a question if ANY requested language is still missing. Stage 1 is
        # shared, so re-rendering one missing language costs almost nothing once
        # we are already reasoning about that question.
        missing = []
        for lang in langs:
            column = getattr(Question, f"explanation_{lang}")
            missing.append(or_(column.is_(None), column == ""))
        stmt = stmt.where(or_(*missing))
    rows = list(db.scalars(stmt))
    return rows[:limit] if limit else rows


def main() -> int:
    ap = argparse.ArgumentParser()
    # Comma-separated, because stage 1 is shared across them. Asking for
    # "en,hi" costs one reasoning pass and two renders rather than two of each.
    ap.add_argument("--lang", default="hi", help="one or more of en,hi,gu (comma-separated)")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--all", action="store_true", help="no limit")
    ap.add_argument(
        "--status",
        default=REVIEW_PENDING,
        help="review_status to select (default: pending, so no approval is lost)",
    )
    ap.add_argument("--any-status", action="store_true")
    ap.add_argument("--resume", action="store_true", help="skip questions already done")
    ap.add_argument("--yes", action="store_true", help="skip the approved-questions warning")
    args = ap.parse_args()
    langs = [x.strip() for x in args.lang.split(",") if x.strip()]
    bad = [x for x in langs if x not in ("en", "hi", "gu")]
    if bad:
        print(f"unknown language(s): {bad}")
        return 1

    migrate()

    with SessionLocal() as db:
        ts.seed_glossary(db)
        reg.seed(db)

        # Fail loudly and immediately rather than a third of the way in.
        needed = ("REASON", "LOCALISE") if any(x != "en" for x in langs) else ("REASON",)
        for role in needed:
            try:
                r = reg.resolve(db, role)
                flag = " (FALLBACK)" if r.is_fallback else ""
                print(f"  {role:<9} -> {r.name}/{r.model}{flag}")
            except reg.NoProviderError as e:
                print(f"  {role:<9} -> UNAVAILABLE: {e}")
                return 1

        status = None if args.any_status else args.status

        targets = pick(
            db,
            langs=langs,
            status=status,
            limit=None if args.all else args.limit,
            resume=args.resume,
        )
        # Count what this run would UN-APPROVE from the ACTUAL selection, not
        # from the status filter. The first version of this check tested
        # `--status approved`, so `--any-status` walked straight past it and
        # could empty the shipping bundle without saying a word — which is
        # exactly what it then did.
        at_risk = [q for q in targets if q.review_status == REVIEW_APPROVED]
        if at_risk and not args.yes:
            print(
                f"\nRefusing: {len(at_risk)} of these {len(targets)} questions are APPROVED.\n"
                "Writing an explanation onto an approved question returns it to the review\n"
                "queue by design, so this run would leave a fresh export short by\n"
                f"{len(at_risk)} questions until a human re-approves them.\n\n"
                "An already-installed APK carries its own copy and is unaffected.\n"
                "Pass --yes if that is what you want."
            )
            return 2

        print(f"\n{len(targets)} questions to process (langs={','.join(langs)}, status={status or 'any'})")
        if at_risk:
            print(f"  {len(at_risk)} approved questions will return to the review queue")
        print()
        if not targets:
            return 0

        ok = failed = unverified = ungrounded = 0
        problems: dict[str, int] = {}
        s1_ms: list[int] = []
        s2_ms: list[int] = []
        started = time.time()

        for i, q in enumerate(targets, 1):
            correct = [o.label for o in q.options if o.is_correct]
            # Same refusal the API applies: a question whose extraction failed
            # would have the model inventing the missing content.
            if not correct or not q.stem_en.strip() or len(q.options) < 2:
                print(f"  [{i}/{len(targets)}] {q.id} SKIPPED — incomplete question")
                continue

            try:
                runs = ts.explain_languages(
                    db,
                    stem=q.stem_en,
                    options=[(o.label, o.text_en) for o in q.options],
                    correct_labels=correct,
                    langs=langs,
                    is_bonus=q.status == "bonus",
                    subject=q.subject,
                    passage=q.passage_en,
                )
            except ts.MissingPassageError as e:
                # Not an error: a deliberate refusal. Counted apart from
                # failures so the summary does not read as breakage.
                ungrounded += 1
                print(f"  [{i}/{len(targets)}] {q.id} REFUSED — {str(e)[:96]}")
                continue
            except (LLMError, reg.NoProviderError) as e:
                failed += 1
                print(f"  [{i}/{len(targets)}] {q.id} FAILED — {str(e)[:110]}")
                continue

            if not runs:
                failed += 1
                print(f"  [{i}/{len(targets)}] {q.id} FAILED — no language rendered")
                continue

            for lang, run in runs.items():
                field = f"explanation_{lang}"
                old = getattr(q, field)
                setattr(q, field, run.prose)

                db.add(
                    ExplanationRun(
                        question_id=q.id,
                        lang=lang,
                        stage1_json=run.stage1.data,
                        stage1_provider=run.stage1.provider,
                        stage1_ms=run.stage1.ms,
                        stage2_text=run.stage2.text if run.stage2 else None,
                        stage2_provider=run.stage2.provider if run.stage2 else None,
                        stage2_ms=run.stage2.ms if run.stage2 else None,
                        mode=run.mode,
                        verification=run.verification,
                        passed=run.passed,
                    )
                )
                chain = run.stage1.provider + (f" -> {run.stage2.provider}" if run.stage2 else "")
                db.add(
                    Audit(
                        question_id=q.id,
                        action="explain",
                        field=field,
                        old_value=old,
                        new_value=run.prose[:400],
                        actor=f"batch:{run.mode}:{chain}"[:200],
                    )
                )

            if q.review_status == REVIEW_APPROVED:
                q.review_status = REVIEW_PENDING
                q.review_note = "returned to review: explanation added after approval"
                db.add(
                    Audit(
                        question_id=q.id,
                        action="invalidated",
                        field="review_status",
                        old_value=REVIEW_APPROVED,
                        new_value=REVIEW_PENDING,
                        actor="system",
                    )
                )

            db.commit()

            # Stage 1 ran once for the whole question, so it is counted once.
            first = next(iter(runs.values()))
            s1_ms.append(first.stage1.ms)

            marks = []
            for lang, run in runs.items():
                if run.stage2:
                    s2_ms.append(run.stage2.ms)
                if run.passed:
                    ok += 1
                    marks.append(f"{lang}:ok")
                else:
                    unverified += 1
                    marks.append(f"{lang}:UNVERIFIED")
                    for p in run.verification.get("problems", []):
                        kind = p.split(":")[0].split(" — ")[0]
                        problems[kind] = problems.get(kind, 0) + 1

            print(
                f"  [{i}/{len(targets)}] {q.id} {' '.join(marks):<26} "
                f"{first.mode:<12} s1={first.stage1.ms}ms "
                f"s2={sum(r.stage2.ms for r in runs.values() if r.stage2)}ms"
            )

        elapsed = time.time() - started
        done = ok + unverified
        print("\n" + "=" * 66)
        print(f"  languages             : {','.join(langs)}")
        print(f"  questions attempted   : {len(targets)}")
        print(f"  renderings written    : {done}")
        print(f"  verification PASSED   : {ok}")
        print(f"  verification FAILED   : {unverified}   (written, flagged for the reviewer)")
        print(f"  generation errors     : {failed}")
        print(f"  refused (no passage)  : {ungrounded}   (comprehension text not attached)")
        if s1_ms:
            print(f"  stage 1 median        : {sorted(s1_ms)[len(s1_ms)//2]} ms")
        if s2_ms:
            print(f"  stage 2 median        : {sorted(s2_ms)[len(s2_ms)//2]} ms")
        print(f"  wall clock            : {elapsed/60:.1f} min  ({elapsed/max(done,1):.0f}s per question)")
        if problems:
            print("  failure kinds:")
            for kind, n in sorted(problems.items(), key=lambda x: -x[1]):
                print(f"    {n:>3}  {kind}")
        print("=" * 66)
        print("\n  APPROVED by this tool : 0   (approval happens only in Content Review)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

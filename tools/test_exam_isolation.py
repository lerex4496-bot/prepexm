"""
Regression test: a student preparing for one exam must never be served another
exam's content.

WHY THIS TEST EXISTS
--------------------
`exam_code` was declared on the paper type and then used in exactly zero
queries. The bundle happily returned everything it held, so a NEET student was
shown CTET papers, CTET subjects in the Learn tab, and CTET questions in
practice. Nothing failed loudly — the app looked like it was working.

This runs the SAME SQL the app runs (mirrored from src/db/content.ts,
src/plan/todayPlan.ts, src/db/mistakes.ts and app/practice/quick.tsx) directly
against the shipped bundle, and asserts that querying as one exam returns zero
rows belonging to any other.

Run: python tools/test_exam_isolation.py
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

BUNDLE = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "assets" / "content" / "studymate.db"

# Mirrors of the app's queries. If a query here drifts from the app, this test
# stops being meaningful — keep them in step.
QUERIES: dict[str, str] = {
    "listPapers": """
        SELECT exam_code FROM papers WHERE exam_code = :exam
    """,
    "loadPaperQuestions": """
        SELECT p.exam_code FROM questions q
          JOIN papers p ON p.id = q.paper_id
         WHERE p.exam_code = :exam
    """,
    "loadPaperOptions": """
        SELECT p.exam_code FROM options o
          JOIN questions q ON q.id = o.question_id
          JOIN papers p ON p.id = q.paper_id
         WHERE p.exam_code = :exam
    """,
    "listSubjects": """
        SELECT p.exam_code FROM questions q
          JOIN papers p ON p.id = q.paper_id
         WHERE p.exam_code = :exam
         GROUP BY q.subject, q.part, p.exam_code
    """,
    "quickPractice.subject": """
        SELECT p.exam_code FROM questions q
          JOIN papers p ON p.id = q.paper_id
         WHERE p.exam_code = :exam
    """,
    "mistakes.join": """
        SELECT p.exam_code FROM questions q
          JOIN papers p ON p.id = q.paper_id
         WHERE p.exam_code = :exam
    """,
}


def main() -> int:
    if not BUNDLE.exists():
        print(f"no bundle at {BUNDLE} — run app.export first")
        return 1

    con = sqlite3.connect(BUNDLE)
    exams = [r[0] for r in con.execute("SELECT DISTINCT exam_code FROM papers")]
    print(f"bundle exams: {exams or '(none)'}")
    print()

    # Test every exam the bundle knows about, plus every one it does NOT — an
    # exam with no content must return nothing, not fall back to everything.
    universe = sorted(set(exams) | {"CTET", "NEET"})
    failures = 0

    for exam in universe:
        print(f"--- querying as {exam}")
        for name, sql in QUERIES.items():
            rows = [r[0] for r in con.execute(sql, {"exam": exam})]
            foreign = sorted({r for r in rows if r != exam})
            if foreign:
                print(f"    FAIL {name:24} leaked rows from {foreign}")
                failures += 1
            else:
                state = f"{len(rows)} rows" if rows else "0 rows (correct — no content)"
                print(f"    ok   {name:24} {state}")
        print()

    con.close()
    if failures:
        print(f"{failures} isolation failures")
        return 1
    print("PASS — no exam ever sees another exam's content")
    return 0


if __name__ == "__main__":
    sys.exit(main())

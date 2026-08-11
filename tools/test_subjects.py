"""
Every subject in the shipped bundle must be a real CTET syllabus name.

WHY THIS TEST EXISTS
--------------------
The old parser guessed the subject from any all-caps line, which produced two
kinds of wrong value that both looked plausible in a database dump:

    ACF-26-I              the booklet code, printed in the page footer
    (1) XXV (2) LXXII     option text — isupper() is True, Python ignores digits

Every one of the 369 shipped questions carried one of these. Nothing crashed;
the Learn tab simply listed booklet codes as subjects to study.

The guard is now positive rather than negative: a subject must be a member of
the syllabus enum. A new failure mode we have not imagined still fails here,
because it will not be in the enum either.

Run: python tools/test_subjects.py
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ctet_syllabus import BLUEPRINT, CANONICAL_SUBJECTS, subject_for

BUNDLE = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "assets" / "content" / "studymate.db"


def main() -> int:
    if not BUNDLE.exists():
        print(f"no bundle at {BUNDLE} — run app.export first")
        return 1

    con = sqlite3.connect(BUNDLE)
    rows = list(
        con.execute(
            """SELECT p.paper_type, q.part, q.number, q.subject
                 FROM questions q JOIN papers p ON p.id = q.paper_id"""
        )
    )
    con.close()

    if not rows:
        print("bundle has no questions — nothing to check")
        return 1

    unknown: list[tuple] = []      # not a syllabus name at all
    misfiled: list[tuple] = []     # a syllabus name, but not the one for this part

    for paper_type, part, number, subject in rows:
        if subject not in CANONICAL_SUBJECTS:
            unknown.append((paper_type, part, number, subject))
            continue
        expected = subject_for(paper_type, part, number)
        # A paper type absent from the blueprint (a future exam) is not a
        # misfiling — there is simply nothing to check it against yet.
        if expected is not None and subject != expected:
            misfiled.append((paper_type, part, number, subject, expected))

    print(f"checked {len(rows)} questions across {len({r[0] for r in rows})} paper types")
    print(f"blueprint covers: {', '.join(sorted(BLUEPRINT))}")
    print()

    for paper_type, part, number, subject in unknown[:10]:
        print(f"  UNKNOWN  {paper_type} part {part} Q{number}: {subject!r}")
    for paper_type, part, number, subject, expected in misfiled[:10]:
        print(f"  MISFILED {paper_type} part {part} Q{number}: {subject!r} should be {expected!r}")

    if unknown or misfiled:
        print(f"\nFAIL — {len(unknown)} unknown, {len(misfiled)} misfiled")
        return 1

    print("PASS — every subject is a syllabus name, filed under the right part")
    return 0


if __name__ == "__main__":
    sys.exit(main())

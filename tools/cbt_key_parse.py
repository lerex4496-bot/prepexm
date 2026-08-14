"""
Decoder for the COMPUTER-BASED-TEST answer keys (December 2021, December 2022).

WHY THESE NEED THEIR OWN PARSER
-------------------------------
CTET ran as a CBT for those two sessions, and the keys look nothing like the
OMR ones. There is no booklet SET — every candidate got a randomised paper — so
the key is published per exam DATE and SHIFT instead:

    OMR (2018-2019, 2024, 2026)     CBT (2021, 2022)
    Set :- O                         Exam date : 28.12.2022
    PAPER-II-Social Science          Exam Shift : Morning
    | QNO ANS | QNO ANS |            Qno  key  Question Description
                                     001  4    CDP

`tools/verify_keys.py` keys everything on the set code, so it found zero
sections in these files and reported them as holding no answers. That reads as
"nothing to check" rather than "this format is not understood" — the same class
of silent gap that hid the section-label change between 2024 and 2026.

WHAT THIS UNLOCKS
-----------------
The December 2022 sitting includes 19 dates whose booklet is
`ctet ss l1 hindi l2 english p2.pdf` — Social Science, Paper II, Hindi as
Language I. That is exactly the paper the student sits, in the medium she sits
it in, and it is the largest source of Hindi-medium Social Studies questions we
have. All of it is unusable without a key.

A BONUS THE OMR KEYS DO NOT GIVE US
-----------------------------------
Every row carries its own subject ("CDP", "MATHS", "SST", "HINDI", ...). The
OMR keys carry none, which is why subjects have to be recovered from a printed
blueprint. Here the board states it per question, so the blueprint can be
CHECKED against the key rather than merely trusted.

DECEMBER 2021 IS DELIBERATELY NOT SUPPORTED
-------------------------------------------
Its keys use a third layout again ("PAPER-II -(MAT)", "Med: Eng", multi-key
written as "1,2"), and they decode to nothing here. That is intentional, not an
oversight: CBSE's December 2021 question-paper page carries no file links at
all, so the papers those keys would mark cannot be obtained. A parser for them
would be dead code.

If the papers ever surface, the layout is tractable and better labelled than
December 2022 — it states the paper, the subject stream and the medium on every
page.

Deterministic throughout. No model is involved in reading an answer key.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
KEYS = ROOT / "content" / "raw" / "ctet" / "keys"

DATE_RE = re.compile(r"Exam\s*date\s*:\s*([\d.\-/]+)", re.I)
SHIFT_RE = re.compile(r"Exam\s*Shift\s*:\s*(\w+)", re.I)

# A row is three consecutive tokens: 3-digit question number, single-digit
# answer, subject word. Matched as a triple rather than by column position,
# because the extractor emits one token per line and column geometry is not
# preserved.
ROW = re.compile(r"^(\d{3})$")
ANS = re.compile(r"^([1-4])$")
SUBJ = re.compile(r"^([A-Z][A-Z /&.\-]{1,30})$")


@dataclass(frozen=True)
class Sitting:
    date: str
    shift: str
    paper: int  # 1-based index within this date+shift, NOT the CTET paper number

    def __str__(self) -> str:
        return f"{self.date} {self.shift} #{self.paper}"


def decode_cbt(path: Path) -> dict[Sitting, dict[int, tuple[str, str]]]:
    """
    {(date, shift, paper): {question number: (answer, subject)}}

    WHY THE PAPER INDEX EXISTS
    --------------------------
    One date and shift can carry SEVERAL papers, and the header states only the
    date and the shift — there is no paper field anywhere on the page. Both CTET
    papers number their questions 1-150, so keying on (date, shift) alone made
    Paper I's Q31 and Paper II's Q31 the same slot. Whichever was read first
    won, and the rest were dropped: Social Science came out as 68 answers
    instead of roughly 1,380.

    The boundary is recoverable without a header field. Rows run in ascending
    order within a paper, so a number that does not advance means a new paper
    has started:

        p9  001..093   p10 094..126   p11 127..099   p12 100..132
                                          ^^^^^^^^ resets -> new paper
    """
    doc = pymupdf.open(path)
    out: dict[Sitting, dict[int, tuple[str, str]]] = defaultdict(dict)
    # Per (date, shift): which paper we are on, and the last number seen.
    state: dict[tuple[str, str], tuple[int, int]] = {}

    for page in doc:
        text = page.get_text()
        d, s = DATE_RE.search(text), SHIFT_RE.search(text)
        if not (d and s):
            # A page with no header cannot be attributed to a sitting. Skipping
            # is correct: inheriting the previous page's identity is how rows
            # end up filed under the wrong exam.
            continue
        date, shift = d.group(1).strip(), s.group(1).strip()

        rows: list[tuple[int, str, str]] = []
        tokens = [t.strip() for t in text.splitlines() if t.strip()]
        for i in range(len(tokens) - 2):
            m_no, m_ans, m_subj = (
                ROW.match(tokens[i]),
                ANS.match(tokens[i + 1]),
                SUBJ.match(tokens[i + 2]),
            )
            if not (m_no and m_ans and m_subj):
                continue
            number = int(m_no.group(1))
            if 1 <= number <= 150:
                rows.append((number, m_ans.group(1), m_subj.group(1).strip()))
        if not rows:
            continue

        paper, last = state.get((date, shift), (1, 0))
        for number, answer, subject in rows:
            if number <= last:
                paper += 1
            last = number
            sitting = Sitting(date, shift, paper)
            # First reading wins; a number decoded twice within one paper means
            # the layout was misread and must not be silently overwritten.
            out[sitting].setdefault(number, (answer, subject))
        state[(date, shift)] = (paper, last)

    doc.close()
    return dict(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", help="a single key PDF; default: every CBT key held")
    ap.add_argument("--subject", help="only count rows for this subject, e.g. SST")
    args = ap.parse_args()

    if args.key:
        files = [Path(args.key)]
    else:
        files = sorted(
            p for p in KEYS.glob("*.pdf")
            if re.search(r"dec20(21|22)", p.name, re.I)
        )
    if not files:
        print("no CBT key files found")
        return 1

    grand = 0
    for path in files:
        table = decode_cbt(path)
        if not table:
            if "dec2021" in path.name.lower():
                print(f"—  {path.name}: December 2021 layout, not supported by design "
                      f"(its question papers are not published — see module docstring)")
            else:
                print(f"!  {path.name}: no sittings decoded — layout not recognised")
            continue
        total = sum(len(v) for v in table.values())
        grand += total
        subjects: dict[str, int] = defaultdict(int)
        for answers in table.values():
            for _n, (_a, subj) in answers.items():
                subjects[subj] += 1
        print(f"{path.name}")
        print(f"    {len(table)} sittings · {total} answers")
        top = sorted(subjects.items(), key=lambda kv: -kv[1])
        print("    subjects: " + ", ".join(f"{s}={n}" for s, n in top[:8]))
        if args.subject:
            want = args.subject.upper()
            per = [
                (str(sit), sum(1 for _n, (_a, s) in ans.items() if s.upper() == want))
                for sit, ans in sorted(table.items(), key=lambda kv: str(kv[0]))
            ]
            per = [p for p in per if p[1]]
            print(f"    {want}: {sum(n for _s, n in per)} answers across {len(per)} sittings")
            for label, n in per[:6]:
                print(f"       {label:28} {n}")
    print(f"\ntotal decoded: {grand} answers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

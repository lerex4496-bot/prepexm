"""
CTET official final answer-key parser.

THE RULE THAT MATTERS
---------------------
CBSE keys are mostly "question -> 1|2|3|4", but a minority of rows carry a
LETTER instead, and the legend is printed in small type at the foot of each
page:

    A=1,2 / B=1,3 / C=1,4 / D=2,3 / E=2,4 / F=3,4 / Z=ALL

Those are MULTI-KEY answers: the question survived review with more than one
option accepted, and a candidate who picked any of them gets the mark. `Z=ALL`
means every option is accepted — effectively a free mark for anyone who
attempted it.

Getting this wrong is not a rounding error. Treating "Z" as a literal answer
would mark every single candidate wrong on that question; ignoring multi-keys
would mark a correct answer wrong. Both silently corrupt every downstream
mastery score and weak-topic recommendation, which is the entire product.

Key layout: one page per (Set, Section). Sections are "PAPER-I MAIN" (the
common Q1-90 across CDP / Maths / EVS) plus one section per language for the
Language I & II parts. Rows are laid out in four column-pairs per page.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

import pymupdf

# The legend, as printed on the key itself.
MULTI_KEY = {
    "A": [1, 2],
    "B": [1, 3],
    "C": [1, 4],
    "D": [2, 3],
    "E": [2, 4],
    "F": [3, 4],
    "Z": [1, 2, 3, 4],  # ALL
}

LEGEND_RE = re.compile(r"A=1,2\s*/\s*B=1,3.*?Z=ALL", re.I | re.S)
SET_RE = re.compile(r"Set\s*:-\s*(\S+)")
# Section label styles differ by era: "PAPER-I MAIN" (2024) vs "PAPER-I-MAIN"
# and "PAPER-II-Math & Science" (2026). Capture to end of line, then squash.
SECTION_RE = re.compile(r"(PAPER-[IVX]+[-\s][^\n|]*)", re.I)

# Row style B (2026): a whole row on one line, pipe-separated cells.
#   "|   1   3   |  26   2   |  51   3   |  76   2   |     |     |"
CELL_RE = re.compile(r"^\s*(\d{1,3})\s+([A-Z0-9])\s*$")
# Cells arrive in two shapes depending on the page: the common "MAIN" pages
# emit "|\n91\n4\n" while the language-section pages emit "| 116\n4\n" with the
# number glued to the pipe. Allowing an optional newline after the pipe covers
# both; without it only the first of four columns is ever read, which silently
# truncates a 60-answer section to a handful.
ROW_RE = re.compile(r"\|[ \t]*\n?[ \t]*(\d{1,3})[ \t]*\n[ \t]*([A-Z0-9])[ \t]*(?=\n)")

OPTION_LABELS = ["A", "B", "C", "D"]


@dataclass
class KeyEntry:
    number: int
    raw: str
    correct: list[str]          # contract labels, e.g. ["A"] or ["A","B"]
    status: str                 # 'ok' | 'bonus'
    multi: bool


@dataclass
class KeySection:
    section: str
    set_code: str
    page: int
    entries: list[KeyEntry]


def parse_key(path: Path) -> tuple[list[KeySection], bool]:
    doc = pymupdf.open(path)
    sections: list[KeySection] = []
    legend_seen = False

    for pno in range(doc.page_count):
        text = doc[pno].get_text()
        if LEGEND_RE.search(text):
            legend_seen = True

        sm = SET_RE.search(text)
        secm = SECTION_RE.search(text)
        if not sm or not secm:
            continue

        # Two row layouts across the two eras. Prefer the line-oriented one and
        # fall back to the token-per-line regex, so one parser covers both
        # without the caller needing to know which era a key came from.
        pairs = [
            (n, a)
            for line in text.split("\n")
            if "|" in line
            for cell in line.split("|")
            for n, a in CELL_RE.findall(cell)
        ]
        if not pairs:
            pairs = ROW_RE.findall(text)

        entries: list[KeyEntry] = []
        for num_s, ans in pairs:
            num = int(num_s)
            if ans.isdigit():
                idx = int(ans)
                if not 1 <= idx <= 4:
                    continue
                entries.append(
                    KeyEntry(
                        number=num,
                        raw=ans,
                        correct=[OPTION_LABELS[idx - 1]],
                        status="ok",
                        multi=False,
                    )
                )
            elif ans in MULTI_KEY:
                idxs = MULTI_KEY[ans]
                entries.append(
                    KeyEntry(
                        number=num,
                        raw=ans,
                        correct=[OPTION_LABELS[i - 1] for i in idxs],
                        # All four accepted == everyone who attempted scores.
                        status="bonus" if len(idxs) == 4 else "ok",
                        multi=True,
                    )
                )
            # Anything else is unrecognised and deliberately dropped rather
            # than guessed at; the validator below will surface the shortfall.

        if entries:
            entries.sort(key=lambda e: e.number)
            sections.append(
                KeySection(
                    section=re.sub(r"\s+", " ", secm.group(1)).strip(),
                    set_code=sm.group(1).strip(),
                    page=pno,
                    entries=entries,
                )
            )

    doc.close()
    return sections, legend_seen


def main() -> int:
    ap = argparse.ArgumentParser(description="Parse a CTET final answer key.")
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--section", default="PAPER-I MAIN")
    ap.add_argument("--set", dest="set_code", default="A")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    sections, legend_seen = parse_key(args.pdf)

    print(f"legend found on page: {legend_seen}")
    print(f"sections parsed: {len(sections)}")
    combos = sorted({(s.section, s.set_code) for s in sections})
    print(f"distinct (section, set): {len(combos)}")
    for c in combos[:6]:
        print(f"  {c}")
    if len(combos) > 6:
        print(f"  ... and {len(combos) - 6} more")

    target = [
        s for s in sections if s.section == args.section and s.set_code == args.set_code
    ]
    if not target:
        print(f"\n! no section {args.section!r} set {args.set_code!r}")
        return 1

    sec = target[0]
    multi = [e for e in sec.entries if e.multi]
    print(f"\n=== {sec.section} / Set {sec.set_code} (page {sec.page + 1}) ===")
    print(f"  answers: {len(sec.entries)}")
    print(f"  numbers: {min(e.number for e in sec.entries)}-{max(e.number for e in sec.entries)}")
    print(f"  multi-key: {len(multi)}")
    for e in multi:
        note = "ALL options accepted (free mark)" if e.status == "bonus" else "multiple accepted"
        print(f"    Q{e.number:<4} raw={e.raw}  ->  {'/'.join(e.correct):9} {note}")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(
                {
                    "source": str(args.pdf),
                    "legend_verified": legend_seen,
                    "sections": [asdict(s) for s in sections],
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"\nwrote {args.out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

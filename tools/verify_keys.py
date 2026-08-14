"""
Independent verification of the answer keys that shipped.

WHY THIS IS NOT ctet_key_parse.py RUN TWICE
-------------------------------------------
Re-running the importer's own parser would agree with itself no matter how
wrong it was. That is not a check, it is an echo. So this decodes the official
key PDFs by a genuinely different route:

    ctet_key_parse.py   regexes over the text stream  (ROW_RE, CELL_RE)
    this file           word COORDINATES, clustered into rows and columns

The two share no pattern, no assumption about pipes or newlines, and no idea of
how many column-pairs a page has. Where they agree, the answer is almost
certainly right. Where they disagree, one of them is broken and the question is
which — which is exactly what we want to be told.

WHY IT MATTERS ON THIS PROJECT
------------------------------
This has already gone wrong once here: a row-offset in key decoding silently
corrupted 71 answers. Nothing about a wrong answer key looks wrong. The app
renders it confidently, marks her correct answer as a mistake, files the topic
as a weakness, and builds tomorrow's plan around fixing something she already
knew. Every downstream feature inherits the error.

Her exam is close enough that a wrong key has no time to be discovered by
accident, so it gets checked deliberately.

NO MODEL IS INVOLVED
--------------------
Answer-key interpretation is deterministic here and stays that way. A language
model asked to "read the answer key" would produce something plausible for every
row including the ones it could not see, which is the single worst failure mode
available.

Usage:
    python tools/verify_keys.py
    python tools/verify_keys.py --db apps/mobile/assets/content/studymate.db
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
KEYS = ROOT / "content" / "raw" / "ctet" / "keys"
DEFAULT_DB = ROOT / "apps" / "mobile" / "assets" / "content" / "studymate.db"

# The legend as printed at the foot of each key page. Multi-key rows mean the
# question survived review with more than one option accepted.
MULTI_KEY = {
    "A": [1, 2], "B": [1, 3], "C": [1, 4],
    "D": [2, 3], "E": [2, 4], "F": [3, 4],
    "Z": [1, 2, 3, 4],
}

# Which key file covers which paper type. Set code is read from the PDF, not
# assumed, so a paper whose set is absent from its key is reported rather than
# silently matched against the wrong column.
KEY_FILES = {
    "CTET_P1": "mar2026_p1_key.pdf",
    "CTET_P2_MATHSCI": "mar2026_p2_key.pdf",
    "CTET_P2_SOCSCI": "mar2026_p2_key.pdf",
}

# For --parsed: the official key for each exam DATE. Keyed on the date rather
# than the folder because content/raw/ctet/feb-2026/ holds three separate
# examinations, each with its own key.
KEY_BY_DATE = {
    ("2024-07-07", True): "july2024_p1_key.pdf",
    ("2024-07-07", False): "july2024_p2_key.pdf",
    ("2024-12-14", True): "dec2024_p1_key.pdf",
    ("2024-12-14", False): "dec2024_p2_key.pdf",
    ("2024-12-15", True): "dec2024_p1_key.pdf",
    ("2024-12-15", False): "dec2024_p2_key.pdf",
    ("2026-02-07", True): "feb2026_07feb_p1_key.pdf",
    ("2026-02-07", False): "feb2026_07feb_p2_key.pdf",
    ("2026-02-08", True): "feb2026_08feb_p1_key.pdf",
    ("2026-02-08", False): "feb2026_08feb_p2_key.pdf",
    ("2026-03-01", True): "mar2026_p1_key.pdf",
    ("2026-03-01", False): "mar2026_p2_key.pdf",
}

# The core section of each paper, covering Q1-90. The Maths and Science section
# is a different paper from Social Science and must never mark it.
#
# Section labels are not stable across eras, so each paper carries the set of
# spellings CBSE has actually used rather than one guessed pattern:
#
#     2026:  "PAPER-II-Social Science"   "PAPER-II-Math & Science"   "PAPER-I-MAIN"
#     2024:  "PAPER-II (MAIN SOS)"       "PAPER-II (MAIN MATH)"      "PAPER-I (MAIN)"
#
# "SOS" is CBSE's own abbreviation for Social Studies. Matching only the 2026
# spelling silently found zero Social Science sections in both 2024 keys —
# which reads exactly like "no answers to check" rather than like a bug.
SECTION_FOR = {
    "CTET_P1": ("MAIN",),
    "CTET_P2_MATHSCI": ("MATH",),
    "CTET_P2_SOCSCI": ("SOCIAL", "SOS"),
}

# The paper numeral a section belongs to, so a Paper I "MAIN" can never be
# matched against a Paper II paper even if both keys were somehow loaded.
PAPER_NUMERAL = {"CTET_P1": "PAPER-I", "CTET_P2_MATHSCI": "PAPER-II", "CTET_P2_SOCSCI": "PAPER-II"}

# "PAPER-II 02-HINDI" and "PAPER-II-02-Hindi" both mean the Hindi language
# section. Captures the language name after the two-digit index.
LANG_SECTION_RE = re.compile(r"\d{2}[-\s]+([A-Z]+)")

# Q91-150 are the two language parts, and the key prints one section PER
# LANGUAGE — English, Hindi, Sanskrit, Bengali, Marathi, Urdu — all numbered
# 91-150 with different answers.
#
# Which one applies depends on the languages the candidate sat, and that is NOT
# recorded in the bundle. Guessing would be the exact mistake this file exists
# to catch: pick wrong and every language answer reads as a mismatch, or worse,
# a wrong key "verifies" clean.
#
# So the language is IDENTIFIED FROM THE DATA — each language section is scored
# against what we hold, and a section is only accepted as the right one if it
# agrees at or above this threshold. Anything lower is reported as unidentified
# rather than forced to a best guess.
LANGUAGE_MATCH_MIN = 0.95


@dataclass
class Row:
    """One decoded key row, with where it was found for error reporting."""
    set_code: str
    section: str
    number: int
    raw: str
    page: int


def rows_from_page(page: pymupdf.Page, page_no: int) -> tuple[str, str, list[Row]]:
    """
    Decode one key page geometrically.

    Words are clustered into lines by their vertical midpoint, then read left to
    right. A (number, answer) pair is any integer token immediately followed by
    a single-character token — which is what a QNO/ANS column pair looks like
    regardless of how many pairs the page happens to carry or how the pipes fall.
    """
    words = page.get_text("words")  # (x0, y0, x1, y1, text, block, line, word)
    if not words:
        return "", "", []

    # Header: "Set :- O" and the section label, read from the same word list so
    # a page whose header failed to extract yields nothing rather than
    # inheriting the previous page's identity.
    flat = [w[4] for w in words]
    set_code = ""
    for i, tok in enumerate(flat):
        if tok == ":-" and i + 1 < len(flat) and len(flat[i + 1]) <= 2:
            set_code = flat[i + 1]
            break

    section = ""
    for i, tok in enumerate(flat):
        if tok.upper().startswith("PAPER-I"):
            section = " ".join(flat[i : i + 3])
            break

    # Cluster into visual lines. 3pt tolerance: rows are ~11pt apart here, so
    # this cannot merge two rows, and it survives sub-point baseline jitter.
    lines: dict[int, list[tuple[float, str]]] = defaultdict(list)
    for x0, y0, _x1, y1, text, *_ in words:
        lines[round((y0 + y1) / 2 / 3)].append((x0, text))

    out: list[Row] = []
    for key in sorted(lines):
        toks = [t for _x, t in sorted(lines[key])]
        for i in range(len(toks) - 1):
            num, ans = toks[i], toks[i + 1]
            if not num.isdigit():
                continue
            n = int(num)
            if not (1 <= n <= 150):
                continue
            if len(ans) != 1:
                continue
            if ans not in "1234" and ans not in MULTI_KEY:
                continue
            out.append(Row(set_code, section, n, ans, page_no))
    return set_code, section, out


def decode(path: Path) -> dict[tuple[str, str], dict[int, str]]:
    """{(set, section): {question number: raw answer}} for a whole key PDF."""
    doc = pymupdf.open(path)
    table: dict[tuple[str, str], dict[int, str]] = defaultdict(dict)
    for i, page in enumerate(doc):
        set_code, section, rows = rows_from_page(page, i)
        if not set_code or not rows:
            continue
        for r in rows:
            bucket = table[(set_code, section.upper())]
            # A number decoded twice on one page with two different answers
            # means the geometry was misread; keep the first and let the
            # comparison surface it rather than silently overwriting.
            bucket.setdefault(r.number, r.raw)
    return table


def core_section(table: dict, set_code: str, paper_type: str) -> dict[int, str]:
    """The Q1-90 section belonging to one paper, across label eras."""
    wanted = SECTION_FOR[paper_type]
    numeral = PAPER_NUMERAL[paper_type]
    merged: dict[int, str] = {}
    for (s, section), answers in table.items():
        if s != set_code:
            continue
        head = section.upper()
        # Numeral must match exactly: "PAPER-II" startswith "PAPER-I" is true,
        # so a substring test alone would let Paper II sections mark Paper I.
        if not head.split()[0].startswith(numeral) or (
            numeral == "PAPER-I" and head.split()[0].startswith("PAPER-II")
        ):
            continue
        if LANG_SECTION_RE.search(head):
            continue  # a language section, handled separately
        if any(w in head for w in wanted):
            merged.update(answers)
    return merged


def language_sections(table: dict, set_code: str) -> dict[str, dict[int, str]]:
    """Every per-language section for this set, keyed by language name."""
    out: dict[str, dict[int, str]] = {}
    for (s, section), answers in table.items():
        if s != set_code:
            continue
        m = LANG_SECTION_RE.search(section.upper())
        if m:
            out[m.group(1)] = answers
    return out


def identify_language(
    ours: dict[int, str], candidates: dict[str, dict[int, str]]
) -> tuple[str | None, float, dict[int, str]]:
    """
    Work out which language section our questions were marked from.

    Returns (name, agreement, answers). Name is None when nothing clears
    LANGUAGE_MATCH_MIN — reported honestly rather than snapped to the best of a
    bad set.
    """
    best_name, best_rate, best = None, 0.0, {}
    for name, answers in candidates.items():
        shared = [n for n in ours if n in answers]
        if not shared:
            continue
        agree = sum(1 for n in shared if ours[n] == answers[n]) / len(shared)
        if agree > best_rate:
            best_name, best_rate, best = name, agree, answers
    if best_rate < LANGUAGE_MATCH_MIN:
        return None, best_rate, best
    return best_name, best_rate, best


def verify_parsed(paper_type: str | None) -> int:
    """
    Verify PARSED papers before they are imported.

    The shipped bundle is verified elsewhere in this file; this covers the far
    larger set of papers that have been parsed but not yet imported, so a key
    error is caught BEFORE it reaches the review queue rather than after.

    Same independent geometric decode, same refusal to guess: a paper whose set
    or section is absent from its official key is reported, never approximated.
    """
    import json

    parsed_dir = ROOT / "content" / "parsed"
    decoded: dict[str, dict] = {}
    grand_checked = grand_bad = 0

    for path in sorted(parsed_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        paper = data.get("paper") or {}
        ptype, held, set_code = paper.get("paperType"), paper.get("heldOn"), paper.get("setCode")
        if not (ptype and held and set_code):
            continue
        if paper_type and ptype != paper_type:
            continue

        is_p1 = ptype == "CTET_P1"
        fname = KEY_BY_DATE.get((held, is_p1))
        if not fname or not (KEYS / fname).exists():
            print(f"!  {path.stem[:52]:54} no official key held for {held}")
            continue
        if fname not in decoded:
            decoded[fname] = decode(KEYS / fname)

        official = core_section(decoded[fname], set_code, ptype)
        if not official:
            print(f"!  {path.stem[:52]:54} set {set_code} absent from {fname}")
            continue

        ours_lang = {
            q["number"]: (q.get("keyRaw") or "").strip()
            for q in data.get("questions") or []
            if q.get("number") not in official and (q.get("keyRaw") or "").strip()
        }
        _name, _rate, lang_answers = identify_language(
            ours_lang, language_sections(decoded[fname], set_code)
        )
        if lang_answers:
            official = {**official, **lang_answers}

        checked = bad = skipped = 0
        details: list[str] = []
        for q in data.get("questions") or []:
            n, raw = q.get("number"), (q.get("keyRaw") or "").strip()
            if n not in official or not raw:
                skipped += 1
                continue
            checked += 1
            if raw != official[n]:
                bad += 1
                if len(details) < 5:
                    details.append(f"Q{n} ours={raw!r} official={official[n]!r}")

        grand_checked += checked
        grand_bad += bad
        flag = "OK " if bad == 0 else "BAD"
        print(f"{flag} {path.stem[:52]:54} {checked:>4} checked, {bad} mismatched, {skipped} unkeyed")
        for d in details:
            print(f"      {d}")

    print()
    print(f"parsed papers: checked {grand_checked} answers · {grand_bad} mismatches")
    return 1 if grand_bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--parsed", action="store_true",
                    help="verify content/parsed/*.json instead of the shipped bundle")
    ap.add_argument("--paper-type", help="e.g. CTET_P2_SOCSCI")
    args = ap.parse_args()

    if args.parsed:
        return verify_parsed(args.paper_type)

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    papers = db.execute(
        "SELECT id, paper_type, set_code, session_label, held_on FROM papers"
    ).fetchall()

    decoded: dict[str, dict] = {}
    total_checked = total_bad = total_unmatched = 0

    for p in papers:
        ptype, set_code = p["paper_type"], p["set_code"]
        # The bundle now spans many sittings, so the key is chosen by EXAM DATE.
        # KEY_FILES maps only the March 2026 papers and would have marked a
        # July 2024 paper against a March 2026 key — every answer "wrong", or
        # worse, a coincidental match.
        fname = KEY_BY_DATE.get((p["held_on"], ptype == "CTET_P1")) or KEY_FILES.get(ptype)
        if not fname or not (KEYS / fname).exists():
            print(f"! {ptype} set {set_code}: no key file held — cannot verify")
            continue

        if fname not in decoded:
            decoded[fname] = decode(KEYS / fname)
        official = core_section(decoded[fname], set_code, ptype)
        if not official:
            print(f"! {ptype} set {set_code}: set/section absent from {fname}")
            continue

        questions = db.execute(
            """SELECT q.number, q.key_raw, q.multi_key,
                      group_concat(o.label || '=' || o.is_correct) AS opts
                 FROM questions q
                 JOIN options o ON o.question_id = q.id
                WHERE q.paper_id = ?
             GROUP BY q.id
             ORDER BY q.number""",
            (p["id"],),
        ).fetchall()

        # Q91-150: work out which language section marked these, from the data.
        ours_lang = {
            q["number"]: (q["key_raw"] or "").strip()
            for q in questions
            if q["number"] not in official and (q["key_raw"] or "").strip()
        }
        lang_name, lang_rate, lang_answers = identify_language(
            ours_lang, language_sections(decoded[fname], set_code)
        )
        if ours_lang:
            if lang_name:
                print(
                    f"    language part identified as {lang_name.title()} "
                    f"({lang_rate:.0%} agreement over {len(ours_lang)} answers)"
                )
                official = {**official, **lang_answers}
            else:
                print(
                    f"    ! language part UNIDENTIFIED — best section agreed only "
                    f"{lang_rate:.0%}; leaving {len(ours_lang)} answers unverified"
                )

        bad: list[str] = []
        unmatched = 0
        for q in questions:
            n = q["number"]
            if n not in official:
                unmatched += 1
                continue
            total_checked += 1

            ours, theirs = (q["key_raw"] or "").strip(), official[n]
            if ours != theirs:
                bad.append(f"    Q{n:>3}  bundle={ours!r}  official key={theirs!r}")
                continue

            # Internal consistency: the stored letter must match the option
            # actually flagged correct. A right key attached to the wrong
            # option is just as wrong on screen.
            expected = MULTI_KEY.get(theirs, [int(theirs)] if theirs.isdigit() else [])
            flagged = sorted(
                int(part.split("=")[0].strip("ABCD") or 0) or "ABCD".index(part.split("=")[0]) + 1
                for part in (q["opts"] or "").split(",")
                if part.endswith("=1")
            )
            if flagged and sorted(expected) != flagged:
                bad.append(
                    f"    Q{n:>3}  key={theirs!r} but option(s) {flagged} flagged correct"
                )

        total_bad += len(bad)
        total_unmatched += unmatched
        status = "OK " if not bad else "BAD"
        print(
            f"{status} {ptype:16} set {set_code}  "
            f"{len(questions) - unmatched}/{len(questions)} checked against {fname}"
        )
        if unmatched:
            print(f"    ({unmatched} not present in the key section — reported, not assumed)")
        for line in bad:
            print(line)

    print()
    print(f"checked {total_checked} answers · {total_bad} mismatches · {total_unmatched} unmatched")
    if total_bad:
        print("MISMATCHES FOUND — do not ship until each is explained.")
    return 1 if total_bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

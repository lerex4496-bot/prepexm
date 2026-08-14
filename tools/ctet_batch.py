"""
Batch-assemble every downloaded CTET paper and report pipeline accuracy.

This is the measurement that decides whether the parser is trustworthy enough
to put in front of a student. It reports, per paper, how many of the 150
questions came through clean AND carry an official answer — anything less is
work for the Content Review queue.
"""

from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ctet_assemble import build  # noqa: E402
from ctet_key_parse import parse_key  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "content" / "raw" / "ctet"
OUT = ROOT / "content" / "parsed"

# A sitting: which booklets exist, and which official key marks them.
#
# Only the facts that cannot be derived live here — the directory, the two key
# files, the date and the label. Section labels are NOT listed, because they
# change between sittings and are discovered from the key itself (see
# find_section). Set codes are not listed either; they come from the booklet
# the board printed (see set_code_for).
#
# Every key referenced here is the OFFICIAL FINAL key from
# ctet.nic.in/previous-year-final-answer-key.
@dataclass(frozen=True)
class Sitting:
    directory: str          # under content/raw/ctet/
    prefix: str             # booklet sub-directory prefix this sitting owns
    p1_key: str | None
    p2_key: str | None
    held_on: str
    label: str


# A SITTING IS A DAY, NOT A FOLDER.
#
# content/raw/ctet/feb-2026/ holds three separate examinations — 07 February,
# 08 February and 01 March — each with its own official key and its own
# questions. Treating the folder as one sitting marked all six booklets with
# the March key, and since a set letter from one day does not appear in
# another day's key, four of them were skipped without ever saying why.
#
# Matching on the booklet directory prefix keeps each day tied to the key that
# actually marks it.
SITTINGS = [
    Sitting("july-2024", "paper1", "july2024_p1_key.pdf", None, "2024-07-07", "July 2024"),
    Sitting("july-2024", "paper2", None, "july2024_p2_key.pdf", "2024-07-07", "July 2024"),
    Sitting("dec-2024", "paper1", "dec2024_p1_key.pdf", None, "2024-12-14", "December 2024"),
    Sitting("dec-2024", "paper2_14Dec", None, "dec2024_p2_key.pdf", "2024-12-14", "December 2024"),
    Sitting("dec-2024", "paper2_15Dec", None, "dec2024_p2_key.pdf", "2024-12-15", "December 2024"),
    Sitting("feb-2026", "p1_07Feb", "feb2026_07feb_p1_key.pdf", None, "2026-02-07", "February 2026"),
    Sitting("feb-2026", "p2_07Feb", None, "feb2026_07feb_p2_key.pdf", "2026-02-07", "February 2026"),
    Sitting("feb-2026", "p1_08Feb", "feb2026_08feb_p1_key.pdf", None, "2026-02-08", "February 2026"),
    Sitting("feb-2026", "p2_08Feb", None, "feb2026_08feb_p2_key.pdf", "2026-02-08", "February 2026"),
    Sitting("feb-2026", "p1_01March", "mar2026_p1_key.pdf", None, "2026-03-01", "March 2026"),
    Sitting("feb-2026", "p2_01March", None, "mar2026_p2_key.pdf", "2026-03-01", "March 2026"),
]


NUMERAL_RE = re.compile(r"^\s*PAPER[-\s]*(I+)")


def numeral_of(head: str) -> str | None:
    """
    "PAPER-I-01-ENGLISH" -> PAPER-I ; "PAPER-II (MAIN SOS)" -> PAPER-II

    Anchored and word-bounded on purpose. Splitting on whitespace worked for
    the 2024 labels and silently failed for every 2026 one, where the whole
    label is a single hyphenated token — which read as "the key has no English
    section" for papers whose key plainly did.
    """
    m = NUMERAL_RE.match(head)
    return f"PAPER-{m.group(1)}" if m else None


@lru_cache(maxsize=None)
def key_sections(key_pdf: str) -> tuple[tuple[str, str], ...]:
    """Every (section label, set code) a key actually contains, cached."""
    sections, _legend = parse_key(Path(key_pdf))
    return tuple(sorted({(s.section, s.set_code) for s in sections}))


def find_section(key_pdf: Path, set_code: str, numeral: str, *words: str) -> str | None:
    """
    Find the exact section label for a set, by what the key actually says.

    The labels are NOT stable across sittings — "PAPER-I (MAIN)" in December
    2024, "PAPER-I MAIN" in July 2024, "PAPER-I-MAIN" in 2026, and Social
    Studies is "SOS" in 2024 but "Social Science" in 2026. Hardcoding them
    meant a label that had changed found zero answers, and zero answers reads
    as "nothing to do" rather than as a bug.

    So the label is discovered instead: the key is asked which sections it has,
    and the one matching this paper's numeral and subject words wins. New
    spellings are picked up without editing a table.
    """
    want = [w.upper() for w in words]
    for label, code in key_sections(str(key_pdf)):
        if code != set_code:
            continue
        head = label.upper()
        if numeral_of(head) != numeral:
            continue
        if any(w in head for w in want):
            return label
    return None


def find_language_section(key_pdf: Path, set_code: str, numeral: str) -> str | None:
    """The English language section (Q91-150) for this set."""
    for label, code in key_sections(str(key_pdf)):
        if code != set_code:
            continue
        head = label.upper()
        if numeral_of(head) == numeral and LANG_RE.search(head):
            return label
    return None


LANG_RE = re.compile(r"01[-\s]*ENGLISH")

# The regional languages CTET prints supplements for. A file named after one of
# these carries only that language's Q91-150 and none of the subject questions,
# so it is never the main paper. "English" and "Hindi" are absent on purpose —
# the main booklet is the bilingual English+Hindi one.
LANGUAGE_SUPPLEMENT = re.compile(
    r"(?i)\b(assamese|bengali|garo|gujarati|kannada|khasi|malayalam|manipuri|"
    r"marath\w*|mizo|nepali|odia|oriya|punjabi|sanskrit|tamil|telugu|tibetan|urdu)\b"
)

# "SET-1_PAPER-I_ACF-26-I-K" -> K ; "SED-24-I Eng+Hin HHHH" -> H
SET_FROM_FILE = [
    re.compile(r"-([A-Z])$"),
    re.compile(r"\b([A-Z])\1{2,}$"),
]

# A Paper II booklet physically carries BOTH subject streams, so it yields two
# papers. Part I is Child Development, Part II Maths & Science, Part III Social
# Science, Parts IV and V the languages.
P2_STREAMS = {
    "CTET_P2_MATHSCI": ("I", "II", "IV", "V"),
    "CTET_P2_SOCSCI": ("I", "III", "IV", "V"),
}


def main_booklet(pdir: Path) -> list[Path]:
    """
    The bilingual English+Hindi booklet — the one that IS the paper.

    Every booklet folder also contains a supplement per regional language
    (Assamese, Bengali, Marathi, Sanskrit, Urdu...), which carry only that
    language's Q91-150 and none of the subject questions.

    There is deliberately NO "any PDF" fallback. An earlier version fell back to
    the first PDF alphabetically, which for December's 15 Dec folder meant
    parsing `Assamese-L.pdf` as if it were the whole paper. It yielded zero
    questions there and looked like an empty booklet — but on a folder where it
    had yielded something, it would have loaded a language supplement's contents
    under the main paper's name and nothing downstream would have noticed.
    Returning nothing and saying so is the only safe answer.

    Naming is not consistent across sittings — "...Eng+Hin GGGG.pdf",
    "Main-W.pdf", "main_L.pdf", "SET-1_PAPER-II_ACF-26-II-O.pdf" — and some
    folders nest the PDFs one level deeper, so both levels are searched.

    A folder may hold SEVERAL sets (March keeps all four in one directory), so
    this returns a list and every entry is parsed as its own paper.
    """
    everything = sorted(pdir.glob("*.pdf")) + sorted(pdir.glob("*/*.pdf"))
    if not everything:
        return []

    # Named spellings first, when the sitting used one.
    named = [p for p in everything if "eng+hin" in p.stem.lower() or "main" in p.stem.lower()]
    if named:
        return named

    # Otherwise: anything that is not a regional-language supplement.
    return [p for p in everything if not LANGUAGE_SUPPLEMENT.search(p.stem)]


def set_code_for(dirname: str, booklet: Path) -> str | None:
    """
    The booklet's set letter.

    Preferred from the directory ("paper2_15Dec_set_L" -> L), but several
    directories carry no set marker at all ("p1_01March"), and for those the
    letter is in the FILENAME the board printed:

        SET-1_PAPER-I_ACF-26-I-K.pdf   -> K
        SED-24-I Eng+Hin HHHH.pdf      -> H

    Taking the first letter of the directory name when there is no marker is
    what produced set "P" for p1_01March — a set that key does not contain, so
    the paper was skipped with a message about the section rather than about
    the set.
    """
    if re.search(r"[Ss]et", dirname):
        tail = re.split(r"[Ss]et", dirname)[-1].strip("_- ")
        if tail[:1].isalpha():
            return tail[:1].upper()

    stem = booklet.stem.strip()
    for pattern in SET_FROM_FILE:
        m = pattern.search(stem)
        if m:
            return m.group(1).upper()
    return None


def stats(data: dict) -> dict:
    qs = data["questions"]
    return {
        "parsed": len(qs),
        "four_opts": sum(1 for q in qs if len(q["options"]) == 4),
        "keyed": sum(1 for q in qs if any(o["isCorrect"] for o in q["options"])),
        "flagged": sum(1 for q in qs if q["warnings"]),
        "bonus": len(data["report"]["bonus_questions"]),
        "multi": len(data["report"]["multi_key_questions"]),
    }


def run_one(
    booklet: Path, key_pdf: Path, set_code: str, sitting: Sitting, language: str,
    paper_type: str, main_section: str, keep_parts: tuple[str, ...] | None,
    out_name: str, rows: list,
) -> None:
    """Parse one booklet into one paper, recording either stats or the reason."""
    try:
        data = build(
            booklet, key_pdf, set_code, language, sitting.label,
            paper_type, sitting.held_on, main_section=main_section,
            keep_parts=keep_parts,
        )
    except SystemExit as e:
        rows.append((out_name, None, str(e)))
        return
    except Exception as e:  # noqa: BLE001 - one bad booklet must not stop the batch
        rows.append((out_name, None, f"{type(e).__name__}: {e}"))
        return

    out = OUT / f"ctet_{out_name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    rows.append((out_name, stats(data), None))


def main() -> int:
    rows: list = []
    for sitting in SITTINGS:
        session_dir = RAW / sitting.directory
        if not session_dir.exists():
            continue

        for pdir in sorted(session_dir.glob("*/")):
            name = pdir.name
            if not name.lower().startswith(sitting.prefix.lower()):
                continue
            booklets = main_booklet(pdir)
            if not booklets:
                rows.append((f"{sitting.directory}_{name}", None, "no main booklet found"))
                continue

            is_p1 = "paper1" in name.lower() or name.lower().startswith("p1")
            numeral = "PAPER-I" if is_p1 else "PAPER-II"
            key_name = sitting.p1_key if is_p1 else sitting.p2_key
            if not key_name or not (RAW / "keys" / key_name).exists():
                rows.append((f"{sitting.directory}_{name}", None, "no official key held"))
                continue
            key_pdf = RAW / "keys" / key_name

            # A folder can hold every set of the sitting, each its own paper.
            for booklet in booklets:
                do_booklet(
                    booklet, pdir, name, sitting, is_p1, numeral, key_pdf, rows
                )

    return report(rows)


def do_booklet(
    booklet: Path, pdir: Path, name: str, sitting: Sitting, is_p1: bool,
    numeral: str, key_pdf: Path, rows: list,
) -> None:
    set_code = set_code_for(name, booklet)
    label = f"{sitting.directory}_{name}"
    if set_code and len(main_booklet(pdir)) > 1:
        label = f"{label}_set{set_code}"
    if not set_code:
        rows.append((label, None, "could not determine set code"))
        return

    language = find_language_section(key_pdf, set_code, numeral)
    if not language:
        rows.append((label, None, f"key has no English section for set {set_code}"))
        return

    if is_p1:
        main = find_section(key_pdf, set_code, numeral, "MAIN")
        if not main:
            rows.append((label, None, f"key has no MAIN section for set {set_code}"))
            return
        run_one(booklet, key_pdf, set_code, sitting, language, "CTET_P1",
                main, None, label, rows)
        return

    # One Paper II booklet, two papers — she sits only one of them.
    for paper_type, keep in P2_STREAMS.items():
        is_math = "MATHSCI" in paper_type
        main = find_section(
            key_pdf, set_code, numeral,
            *(("MATH",) if is_math else ("SOS", "SOCIAL")),
        )
        suffix = "mathsci" if is_math else "socsci"
        if not main:
            rows.append((f"{label}_{suffix}", None,
                         f"key has no {suffix} section for set {set_code}"))
            continue
        run_one(booklet, key_pdf, set_code, sitting, language, paper_type,
                main, keep, f"{label}_{suffix}", rows)


def report(rows: list) -> int:
    print(f"{'paper':16} {'parsed':>7} {'4opts':>6} {'keyed':>6} {'flagged':>8} {'bonus':>6} {'multi':>6}")
    print("-" * 62)
    total_q = total_clean = 0
    for name, r, err in rows:
        if r is None:
            print(f"{name:16}   skipped — {err}")
            continue
        print(
            f"{name:16} {r['parsed']:>7} {r['four_opts']:>6} {r['keyed']:>6} "
            f"{r['flagged']:>8} {r['bonus']:>6} {r['multi']:>6}"
        )
        total_q += r["parsed"]
        total_clean += r["parsed"] - r["flagged"]

    if total_q:
        print("-" * 62)
        print(f"{'TOTAL':16} {total_q:>7} questions, {total_clean} clean "
              f"({100 * total_clean / total_q:.1f}%), {total_q - total_clean} to review")
    return 0


if __name__ == "__main__":
    sys.exit(main())

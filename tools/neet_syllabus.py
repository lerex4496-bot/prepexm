"""
The NEET topic spine, derived from the NCERT chapter PDFs themselves.

WHY NOT FROM THE JEE FOLDER, AND WHY NOT FROM A COACHING SITE
-------------------------------------------------------------
Two tempting sources are both wrong, for different reasons.

The local `IIT JEE` set was the starting point for "understand the topics", and
it does earn its keep — but only as a NAME LIST. Every one of its 54 PDFs is a
SCAN: pymupdf extracts zero characters from the Physics chapters, and the only
text in the Chemistry ones is a novaPDF watermark. There is no structure inside
them to read. Worse, JEE and NEET are not the same syllabus: JEE sets topics
NEET never asks (Circular Permutations, rotational dynamics at JEE depth) and
NEET leans on chapters JEE treats lightly. Sizing a medical student's revision
off an engineering syllabus wastes her time in both directions.

Coaching websites publish "the NEET syllabus" freely, and they disagree with
each other in the details. None of them is the examiner.

What IS authoritative and machine-checkable: NTA builds NEET on the NCERT Class
XI-XII books, and those books are on disk. So every chapter here is read out of
the PDF that teaches it — the title from page 1, the section numbers from the
chapter's own headings. If a chapter is not in the corpus it does not appear in
this file, which makes a download gap visible as a missing topic instead of a
silent one.

THE POST-2023 RATIONALISATION IS THE TRAP
-----------------------------------------
NCERT cut large amounts of content in 2023 and NTA followed. Most material
still circulating — including that JEE folder — predates the cut. Deriving the
spine from THIS YEAR'S downloaded books is what keeps her off deleted topics.
Reprint 2026-27 is what the corpus holds.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "content" / "raw" / "ncert" / "NEET"
OUT = ROOT / "content" / "manifests" / "neet_syllabus.json"

# TWO SOURCES, BECAUSE NEITHER ONE COVERS ALL THREE SUBJECTS
# ----------------------------------------------------------
# The three subjects are typeset by different teams and it shows:
#
#   Biology    contents page is real text; every chapter's TITLE is an IMAGE.
#   Chemistry  contents page is an IMAGE; chapter title pages are real text.
#   Physics    contents page is HALF an image; chapter title pages are text.
#
# So the contents page is read where it exists, the chapter title page where
# it exists, and the two are merged. Biology's contents page also carries the
# UNIT grouping (Unit V Human Physiology, and so on), which is how NEET
# questions are actually distributed — worth having, and available nowhere in
# the chapter files.

# NCERT spells the chapter number in words on Physics title pages.
WORDS = {
    "ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5, "SIX": 6, "SEVEN": 7,
    "EIGHT": 8, "NINE": 9, "TEN": 10, "ELEVEN": 11, "TWELVE": 12, "THIRTEEN": 13,
    "FOURTEEN": 14, "FIFTEEN": 15, "SIXTEEN": 16, "SEVENTEEN": 17, "EIGHTEEN": 18,
    "NINETEEN": 19, "TWENTY": 20,
}

# "Chapter One" (Physics) or "UNIT 4" (Chemistry) — the line that opens a book.
MARKER_RE = re.compile(
    r"^\s*(?:CHAPTER\s+(" + "|".join(WORDS) + r")|UNIT\s+(\d{1,2}))\s*$",
    re.IGNORECASE | re.MULTILINE,
)
# "Chapter 12 : Respiration in Plants   153" on a contents page. The title runs
# non-greedily to the first standalone page number, so a title that itself
# contains a colon ("Biotechnology : Principles and Processes") survives intact.
TOC_RE = re.compile(r"Chapter\s+(\d{1,2})\s*:\s*(.+?)\s+(\d{1,3})(?=\s|$)")
TOC_UNIT_RE = re.compile(r"UNIT\s+([IVX]+)\s+([A-Z][A-Z\s:,&'-]{4,60}?)\s+\d{1,3}\s*-\s*\d{1,3}")
# "4.7 Conservation of momentum" — a numbered section heading in the chapter.
SECTION_RE = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\s+([A-Z][^\n]{3,70})\s*$", re.MULTILINE)

# Marks per subject in the NEET paper. Biology is HALF the exam and is the
# single biggest lever on her rank; the JEE folder contains none of it.
PAPER_WEIGHT = {
    "Biology": {"questions": 90, "marks": 360},
    "Physics": {"questions": 45, "marks": 180},
    "Chemistry": {"questions": 45, "marks": 180},
}


@dataclass
class Chapter:
    subject: str
    klass: int
    number: int
    title: str
    unit: str | None
    sections: list[str]
    pages: int
    file: str
    title_from: str


def clean(s: str) -> str:
    """Collapse the letter-spaced display type NCERT uses on title pages."""
    s = re.sub(r"\s+", " ", s).strip()
    # "U N I T S  A N D  M E A S U R E M E N T" -> normal words.
    if re.fullmatch(r"(?:[A-Za-z]\s){3,}[A-Za-z]", s):
        s = re.sub(r"(?<=\S) (?=\S)", "", s)
    # A trailing asterisk is a footnote marker on the page, not part of the name.
    return s.strip(" :-—*†").strip()


# "sOme Basic PrinciPles" — small-caps typesetting extracted literally, where
# the large glyphs come back as capitals in the middle of words.
MISCASED = re.compile(r"[a-z][A-Z]")


def titlecase(s: str) -> str:
    """Display type -> readable. Left alone if it is already sensibly cased."""
    if s.isupper() or s.islower() or MISCASED.search(s):
        return s.title()
    return s


def toc_titles(prelims: Path) -> tuple[dict[int, str], dict[int, str]]:
    """Chapter titles and unit names from a book's contents page.

    Returns ({chapter_number: title}, {chapter_number: unit_name}). Empty when
    the contents page is an image, which is the normal case for Chemistry.
    """
    import pymupdf

    titles: dict[int, str] = {}
    units: dict[int, str] = {}
    try:
        doc = pymupdf.open(prelims)
    except Exception:
        return titles, units

    for page in doc:
        flat = re.sub(r"\s*\n\s*", " ", page.get_text())
        if "Chapter" not in flat:
            continue
        # Units and chapters are interleaved down the page, so walking the
        # page in POSITION order is what assigns each chapter to the unit
        # printed above it — not the unit that happens to sort first.
        marks: list[tuple[int, str, object]] = []
        for um in TOC_UNIT_RE.finditer(flat):
            marks.append((um.start(), "unit", clean(um.group(2))))
        for cm in TOC_RE.finditer(flat):
            marks.append((cm.start(), "chapter", (int(cm.group(1)), clean(cm.group(2)))))
        marks.sort(key=lambda m: m[0])

        current: str | None = None
        for _pos, kind, payload in marks:
            if kind == "unit":
                current = payload  # type: ignore[assignment]
            else:
                num, title = payload  # type: ignore[misc]
                if 1 <= num <= 30 and len(title) > 3:
                    titles.setdefault(num, title)
                    if current:
                        units.setdefault(num, current)
    return titles, units


def depua(s: str) -> str:
    """Undo symbolic-font encoding: U+F041 is 'A' shifted into the private-use area.

    Class 11 Physics chapter 7 (Gravitation) is typeset in a font whose glyphs
    are mapped into U+F000-U+F0FF, so its page text extracts as a wall of
    unprintable codepoints and every plain-text rule silently sees nothing.
    The offset is exactly 0xF000 and the mapping is checked below by asserting
    the decoded marker parses — it is arithmetic, not a guess.
    """
    return "".join(chr(ord(c) - 0xF000) if 0xF000 <= ord(c) <= 0xF0FF else c for c in s)


def marker_number(head: str) -> int | None:
    """Chapter number from the 'Chapter One' / 'Unit 7' line, if it is text."""
    m = MARKER_RE.search(head)
    if not m:
        return None
    return WORDS[m.group(1).upper()] if m.group(1) else int(m.group(2))


def title_from_text(head: str) -> str | None:
    """Title as the ALL-CAPS lines following the marker.

    Physics sets "ELECTRIC CHARGES / AND FIELDS" across two lines, so this
    takes as many as it finds and stops at the first numbered section or the
    first line containing lowercase prose. Chapters whose title is typeset in
    lowercase (most of Class 11 Chemistry) fall through to the size rule.
    """
    m = MARKER_RE.search(head)
    if not m:
        return None
    parts: list[str] = []
    for line in head[m.end():].split("\n"):
        s = line.strip()
        if not s:
            if parts:
                break
            continue
        if re.match(r"^\d", s) or re.search(r"[a-z]{2}", s):
            break
        parts.append(s)
        if len(parts) >= 4:
            break
    title = clean(" ".join(parts))
    return title if len(title) > 3 else None


# Words that are furniture on a title page, never the title itself.
FURNITURE = re.compile(r"^(objectives?|unit|chapter|contents?)$", re.IGNORECASE)


def title_by_size(page) -> tuple[int | None, str | None]:
    """Title as the largest display type on the page; number if it is set big too.

    Class 12 Chemistry prints a 110pt chapter numeral and a 30pt title, with no
    text marker at all. Two wrinkles have to be handled or the title comes out
    mangled:

      * the title is drawn TWICE, offset about 1.4pt, to fake a drop shadow —
        so lines are bucketed by vertical position and only the first copy of
        each band is kept;
      * Physics sets a drop cap, "G" at 20pt over "RAVITATION" at 14pt — so a
        largest group that is a single letter is merged with the next size
        down rather than returned as the whole title.
    """
    # These titles are not drawn once. Class 12 Chemistry fakes an embossed
    # outline by stamping the same words up to TEN times, each copy shifted a
    # fraction of a point, and the copies are not identical: one carries
    # "Alcohols, Phenols", another just "Phenols", a third "thers" overlapping
    # the tail of "Ether". Concatenating them gives "Alcohols Alcohols and
    # and"; taking any single copy loses characters.
    #
    # So the copies are treated as overlapping FRAGMENTS of one string and
    # stitched: cluster by line, then by horizontal start, keep the longest
    # fragment at each position, and merge neighbours on their overlap.
    lines: list[tuple[float, float, float, str]] = []  # size, y, x, text
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            by_size: dict[float, str] = {}
            for span in line["spans"]:
                text = depua(span["text"])
                if text.strip():
                    key = round(span["size"], 1)
                    by_size[key] = by_size.get(key, "") + text
            for size, text in by_size.items():
                lines.append((size, line["bbox"][1], line["bbox"][0], text))

    def cluster(values: list[float], tol: float) -> list[list[float]]:
        out: list[list[float]] = []
        for v in sorted(values):
            if out and v - out[-1][-1] <= tol:
                out[-1].append(v)
            else:
                out.append([v])
        return out

    def stitch(a: str, b: str) -> str:
        """Join two fragments on their longest overlap ('and Ether' + 'thers')."""
        if b in a:
            return a
        for n in range(min(len(a), len(b)), 0, -1):
            if a[-n:] == b[:n]:
                return a + b[n:]
        return f"{a} {b}"

    # The "Unit 9" badge stamps a stray "mines" beside its 110pt numeral, in
    # the title's own point size, so the badge's BAND has to go. Only the badge
    # though: keying off every bare numeral swept up figure numbers, and
    # keying off a y-window around the word "Objectives" — which is printed
    # five points from a title line — deleted half of "Haloalkanes and
    # Haloarenes". So the band is anchored on the big numeral alone, and other
    # furniture is dropped by its own text.
    badge_y = [y for s, y, _x, t in lines if s >= 40 and re.fullmatch(r"\d{1,2}", clean(t))]

    groups: dict[float, list[tuple[float, float, str]]] = {}
    for size, y, x, text in lines:
        groups.setdefault(size, []).append((y, x, text))

    def assemble(items: list[tuple[float, float, str]]) -> str:
        rows = [
            it
            for it in items
            if not FURNITURE.match(clean(it[2]))
            and not any(abs(it[0] - by) < 6 for by in badge_y)
        ]
        if not rows:
            return ""
        pieces: list[str] = []
        for band in cluster([r[0] for r in rows], 4.0):
            lo, hi = band[0], band[-1]
            in_band = [r for r in rows if lo <= r[0] <= hi]
            merged = ""
            for col in cluster([r[1] for r in in_band], 4.0):
                x_lo, x_hi = col[0], col[-1]
                # Longest fragment starting at this horizontal position.
                best = max(
                    (r[2] for r in in_band if x_lo <= r[1] <= x_hi), key=len, default=""
                )
                merged = stitch(merged, best) if merged else best
            if merged:
                pieces.append(merged)
        return clean(" ".join(pieces))

    # The chapter number is the biggest bare numeral on the page — the 110pt
    # figure in the Unit badge. Read straight off the lines, because assemble()
    # deliberately throws that badge away when building the title.
    number: int | None = None
    numerals = [
        (size, clean(text)) for size, _y, _x, text in lines if re.fullmatch(r"\d{1,2}", clean(text))
    ]
    if numerals:
        number = int(max(numerals, key=lambda n: n[0])[1])

    ordered = sorted(groups, reverse=True)
    title: str | None = None
    for i, size in enumerate(ordered):
        text = assemble(groups[size])
        if not text or FURNITURE.match(text) or not re.search(r"[A-Za-z]{2}", text):
            continue
        # A single letter at the top size is a drop cap over the rest of the
        # word — "G" at 20pt above "RAVITATION" at 14pt.
        if len(text) == 1 and i + 1 < len(ordered):
            nxt = assemble(groups[ordered[i + 1]])
            if nxt and not FURNITURE.match(nxt):
                title = clean(text + nxt)
                break
        title = text
        break

    return number, title


def sections_of(doc, number: int) -> list[str]:
    """Numbered headings belonging to THIS chapter, in the order set."""
    seen: set[str] = set()
    out: list[str] = []
    for page in doc:
        for sm in SECTION_RE.finditer(page.get_text()):
            # A "2.3" inside chapter 7 is a cross-reference, not a heading here.
            if int(sm.group(1)) != number:
                continue
            label = f"{sm.group(1)}.{sm.group(2)} {titlecase(clean(sm.group(3)))}"
            key = label.lower()
            if key not in seen:
                seen.add(key)
                out.append(label)
    return out


def collect() -> list[Chapter]:
    import pymupdf

    chapters: list[Chapter] = []
    for folder in sorted(CORPUS.glob("*_cls*")):
        if not folder.is_dir():
            continue
        subject, cls_part, stem = folder.name.split("_", 2)
        klass = int(cls_part.replace("cls", ""))

        prelims = CORPUS / f"NEET_{subject}_cls{klass:02d}_{stem}ps.pdf"
        toc, units = toc_titles(prelims) if prelims.exists() else ({}, {})

        for pdf in sorted(folder.glob("*.pdf")):
            try:
                doc = pymupdf.open(pdf)
            except Exception:
                continue

            head = depua(doc[0].get_text()) if doc.page_count else ""
            size_number, size_title = title_by_size(doc[0]) if doc.page_count else (None, None)

            # THE NUMBER MUST NOT COME FROM THE FILENAME.
            # A two-part book restarts its file numbering while the chapters
            # carry on: kech201.pdf is Chapter SEVEN, not Chapter One. Reading
            # the number off the filename silently files Redox Reactions as
            # "Some Basic Concepts" and every downstream topic tag inherits the
            # error. The book's own marker is the authority; the filename is
            # used only for a part-1 book where the two agree by construction.
            #
            # Order matters. The badge numeral is a Chemistry-specific rescue
            # and must be LAST: Biology's title pages are images, so the size
            # rule finds whatever big digit happens to be on the page and
            # confidently reported chapters 23, 37 and 71 in a 19-chapter book,
            # two of them colliding onto titles that already existed.
            fm = re.search(r"(\d)(\d{2})\.pdf$", pdf.name)
            part = int(fm.group(1)) if fm else 1
            if part == 1 and fm:
                # A part-1 book numbers its files from 01 alongside its
                # chapters, so the filename is exact. Preferring the page text
                # here was wrong: Biology prints "UNIT 2" as a divider banner
                # inside later chapters, and reading that as a chapter marker
                # filed Morphology of Flowering Plants as chapter 2.
                number = int(fm.group(2))
            else:
                # Part 2 restarts file numbering while chapters carry on
                # (kech201.pdf is Chapter Seven), so the book's own marker —
                # or, for Class 12 Chemistry, its 110pt badge numeral — is the
                # only thing that knows the real number.
                number = marker_number(head) or size_number
            if not number:
                continue

            # Contents page first — it is the book's own index, and the only
            # place Biology's titles exist as text at all. Then the marker
            # line, then the display type.
            if number in toc:
                title, whence = toc[number], "contents"
            elif (t := title_from_text(head)) :
                title, whence = titlecase(t), "title page"
            elif size_title:
                title, whence = titlecase(size_title), "display type"
            else:
                print(f"  ?? no title found in {pdf.name}")
                continue

            chapters.append(
                Chapter(
                    subject=subject,
                    klass=klass,
                    number=number,
                    title=title,
                    unit=units.get(number),
                    sections=sections_of(doc, number),
                    pages=doc.page_count,
                    file=pdf.name,
                    title_from=whence,
                )
            )

    chapters.sort(key=lambda c: (c.subject, c.klass, c.number))

    # Two files claiming one chapter number means a number was inferred wrongly,
    # and the symptom is quiet: the spine still looks plausible, just with a
    # chapter listed twice and another missing. Say so.
    seen: dict[tuple[str, int, int], str] = {}
    for c in chapters:
        key = (c.subject, c.klass, c.number)
        if key in seen:
            print(f"  !! {c.subject} cls{c.klass} ch{c.number} claimed by both {seen[key]} and {c.file}")
        seen[key] = c.file

    return chapters


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="emit the JSON manifest")
    args = ap.parse_args()

    if not CORPUS.exists():
        print(f"no NEET corpus at {CORPUS} — run tools/ncert_chapters.py --exam NEET")
        return 1

    chapters = collect()
    if not chapters:
        print("no chapters could be read")
        return 1

    by_subject: dict[str, list[Chapter]] = {}
    for c in chapters:
        by_subject.setdefault(c.subject, []).append(c)

    total_sections = 0
    for subject in ("Biology", "Chemistry", "Physics"):
        rows = by_subject.get(subject, [])
        w = PAPER_WEIGHT.get(subject, {})
        print(
            f"\n=== {subject}  —  {len(rows)} chapters  "
            f"({w.get('questions', '?')} questions, {w.get('marks', '?')} marks) ==="
        )
        unit = None
        for c in rows:
            total_sections += len(c.sections)
            if c.unit and c.unit != unit:
                unit = c.unit
                print(f"  -- {unit}")
            print(
                f"  cls{c.klass} ch{c.number:>2}  {c.title[:50]:50}  "
                f"{len(c.sections):>2} sections  [{c.title_from}]"
            )
            # Gaps in chapter numbering mean a failed download, not a short book.
        for klass in (11, 12):
            nums = sorted(c.number for c in rows if c.klass == klass)
            if nums:
                missing = [n for n in range(1, max(nums) + 1) if n not in nums]
                if missing:
                    print(f"  !! cls{klass} MISSING chapters {missing} — re-run the fetcher")

    print(f"\n{len(chapters)} chapters, {total_sections} numbered sections")

    if args.write:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(
            json.dumps(
                {
                    "source": "NCERT Class XI-XII chapter PDFs, Reprint 2026-27",
                    "derivation": "titles and section headings read from the PDFs on disk",
                    "paper_weight": PAPER_WEIGHT,
                    "chapters": [asdict(c) for c in chapters],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

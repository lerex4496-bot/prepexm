"""
CTET paper parser.

THE CENTRAL PROBLEM AND HOW THIS SOLVES IT
------------------------------------------
CBSE publishes CTET papers as bilingual PDFs where the English is normal
embedded text but the Hindi uses LEGACY 8-BIT FONTS (Chanakya, Yogesh) whose
ToUnicode CMaps map glyph bytes onto MacRoman-ish Latin code points. So:

    English  ->  extracts perfectly
    Hindi    ->  extracts as  'ÁŸêŸÁ‹ÁπÃ ◊¥ ‚ ∑§ÊÒŸ-‚Ê'   (unusable)

The page RENDERS correctly (the fonts are embedded and fine) — it is only the
text layer that is unrecoverable without a font-specific transliteration table.

We turn that liability into an asset: the font name is a perfect language
discriminator. Any span drawn in a Chanakya/Yogesh face is Hindi; everything
else is English. That is far more robust than the usual positional heuristics
(x/y thresholds, alternating-block guesses), because it does not care how the
publisher laid the page out.

So this parser:
  * extracts the ENGLISH question bank at full fidelity,
  * records the bounding box of each Hindi region so it can be rendered from
    the original PDF later (authentic official Hindi, zero encoding risk),
  * never guesses at Hindi text content.

Output conforms to src/content/contract.ts.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

import pymupdf

from ctet_syllabus import match_banner

# Faces used for Devanagari in CBSE's typesetting. Matched case-insensitively
# on a substring so subset prefixes like "SLPATA+Chanakya" still hit.
HINDI_FONT_MARKERS = ("chanakya", "yogesh", "mitra", "devanagari", "kruti", "shree")

# CTET numbers options (1)-(4); the contract uses A-D.
OPTION_LABELS = ["A", "B", "C", "D"]

QUESTION_RE = re.compile(r"^\s*(\d{1,3})\s*\.\s*$")
OPTION_RE = re.compile(r"^\s*\((\d)\)\s*$")
INLINE_Q_RE = re.compile(r"^\s*(\d{1,3})\s*\.\s+(.*)$", re.S)
INLINE_OPT_RE = re.compile(r"^\s*\((\d)\)\s+(.*)$", re.S)

# Part headers and the subject line beneath. The hyphen is optional because the
# two typesetting eras differ: legacy papers print "PART - I / भाग - I" while
# the Unicode-era papers print "भाग I /PART I". Requiring the hyphen silently
# parsed zero questions out of every March 2026 paper.
PART_RE = re.compile(r"PART\s*-?\s*([IVX]+)\b", re.I)

# Comprehension blocks open with an explicit range:
#
#   "Directions : Read the poem given below and answer the questions that
#    follow (Q. Nos. 91 to 96) by selecting the correct/most appropriate option."
#
# The passage is printed ONCE, above the block, and the questions that follow
# are meaningless without it — "What did the cricket do in summer ?" names no
# poem. Attaching the passage to every question in the range is what lets those
# questions be answered, reviewed and explained from what is actually on the
# page rather than from a model's memory of the source text.
#
# The range is taken from the paper itself, never inferred from position.
DIRECTIONS_RE = re.compile(
    r"Directions?\s*:\s*(?P<body>.{0,200}?)\(\s*Q\.?\s*Nos?\.?\s*(?P<lo>\d+)\s*(?:to|[-–—])\s*(?P<hi>\d+)\s*\)",
    re.I | re.S,
)

# Leading fragment of a wrapped directive sentence, stripped from the first
# chunk of passage text. Anchored and bounded so it can only ever remove the
# tail of an instruction, never a sentence of the passage itself.
DIRECTIVE_TAIL_RE = re.compile(
    r"^[^.]{0,90}?(?:appropriate|correct)\s+options?\s*[.:]\s*",
    re.I,
)


DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")

# Printed rows sit 18-25pt apart, so 6pt cannot merge two rows and still
# absorbs the baseline shift a superscript introduces.
ROW_TOLERANCE = 6.0


def is_hindi_font(font_name: str) -> bool:
    f = font_name.lower()
    return any(m in f for m in HINDI_FONT_MARKERS)


def is_hindi_span(text: str, font_name: str) -> bool:
    """
    Two eras of CTET typesetting, one test.

    Papers up to and including the Feb 2026 sittings set Hindi in legacy 8-bit
    faces (Chanakya / Yogesh / Mitra1) whose text layer is unrecoverable
    without a glyph table — there the FONT NAME is the only usable signal.

    From the 1 March 2026 sitting CBSE moved to real Unicode (Kokila), so the
    Hindi arrives as genuine Devanagari code points and the SCRIPT is the
    signal. Checking script first means new papers work with no font list to
    maintain, while the legacy list keeps the historical archive parsing.
    """
    if DEVANAGARI_RE.search(text):
        return True
    return is_hindi_font(font_name)


@dataclass
class Span:
    text: str
    font: str
    size: float
    bbox: tuple[float, float, float, float]
    page: int
    hindi: bool


@dataclass
class ParsedOption:
    label: str
    text: str


@dataclass
class ParsedQuestion:
    number: int
    stem_en: str
    options_en: list[ParsedOption]
    page: int
    part: str | None = None
    subject: str | None = None
    # Region of the page holding the Hindi rendering of this question, so the
    # authentic official Hindi can be cropped from the source PDF later.
    hindi_bbox: tuple[float, float, float, float] | None = None
    hindi_page: int | None = None
    # Raw Hindi block for this question. Populated only when the source is a
    # Unicode-era paper (1 March 2026 onward, set in Kokila); legacy papers
    # leave this empty and rely on hindi_bbox instead.
    hindi_raw: str = ""
    stem_hi: str = ""
    options_hi: list[str] = field(default_factory=list)
    # Shared reading material for a comprehension block, copied onto every
    # question in the block's declared range. Empty for standalone questions.
    passage_en: str = ""
    passage_hi: str = ""
    warnings: list[str] = field(default_factory=list)


def collect_spans(doc: pymupdf.Document) -> list[Span]:
    """Flatten the document into ordered spans tagged by language."""
    spans: list[Span] = []
    for pno in range(doc.page_count):
        page = doc[pno]
        data = page.get_text("dict")
        for block in data.get("blocks", []):
            for line in block.get("lines", []):
                for s in line.get("spans", []):
                    txt = s.get("text", "")
                    if not txt.strip():
                        continue
                    spans.append(
                        Span(
                            text=txt,
                            font=s.get("font", ""),
                            size=round(s.get("size", 0), 1),
                            bbox=tuple(round(v, 1) for v in s.get("bbox", (0, 0, 0, 0))),
                            page=pno,
                            hindi=is_hindi_span(txt, s.get("font", "")),
                        )
                    )
    return spans


def merge_english_lines(spans: list[Span]) -> list[Span]:
    """
    Join adjacent English spans that sit on the same visual line.

    PDF text is emitted span-by-span whenever styling changes, so a single
    sentence arrives as several fragments ("Both ", "(A)", " and ", "(R)",
    " are true"). Without merging, every bold word looks like a new line and
    the question/option regexes never match.
    """
    out: list[Span] = []
    # The vertical CENTRE of the first span on each merged line, kept alongside
    # `out` and never updated as the line grows.
    #
    # WHY NOT prev.bbox
    # -----------------
    # This compared span TOPS with a 3.5pt tolerance, and a superscript or
    # subscript moves the top by more than that. So "21st February" broke the
    # merge chain at the "st", and the NEXT option marker then merged into the
    # tail of the previous option instead of starting its own:
    #
    #     want:  (1) 21st February | (2) 13th April | (3) ... | (4) ...
    #     got:   "21 st February (2) 13 th April (3) 1 st January (4) ..."
    #
    # one option instead of four, on a question whose options are plain dates.
    #
    # Two things were wrong. Tops move with superscripts where centres barely
    # do, and `prev.bbox` is min()-expanded on every merge, so the reference
    # itself crept upward as the line grew and the comparison drifted. Holding
    # the ORIGINAL centre fixes both, and 6.0 is the tolerance already used for
    # row grouping on rows printed 18-25pt apart.
    #
    # Measured: this recovered 294 questions across the corpus.
    ref_centre: list[float] = []
    for s in spans:
        centre = (s.bbox[1] + s.bbox[3]) / 2
        if s.hindi:
            out.append(s)
            ref_centre.append(centre)
            continue
        if out and not out[-1].hindi and out[-1].page == s.page:
            prev = out[-1]
            same_line = abs(ref_centre[-1] - centre) <= ROW_TOLERANCE
            if same_line:
                gap = s.bbox[0] - prev.bbox[2]
                joiner = " " if gap > 0.8 and not prev.text.endswith(" ") else ""
                prev.text += joiner + s.text
                prev.bbox = (
                    min(prev.bbox[0], s.bbox[0]),
                    min(prev.bbox[1], s.bbox[1]),
                    max(prev.bbox[2], s.bbox[2]),
                    max(prev.bbox[3], s.bbox[3]),
                )
                continue
        out.append(s)
    return out


def clean(text: str) -> str:
    text = text.replace("", "").replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


OPT_SPLIT_RE = re.compile(r"(?=\(\d\)\s)")


def split_option_columns(text: str) -> list[str]:
    """
    CTET lays options out in two columns, so one visual line carries two
    options:

        "(1) Best works portfolio        (2) Growth and learning portfolio"

    Line-merging (which we need, because styling fragments every sentence)
    glues them together. Split them apart again — but ONLY on lines that
    actually begin with an option marker, otherwise a stem that happens to
    contain "(2)" would be torn in half.
    """
    if not re.match(r"^\s*\(\d\)\s", text):
        return [text]
    parts = [p.strip() for p in OPT_SPLIT_RE.split(text)]
    return [p for p in parts if p]


HI_OPT_RE = re.compile(r"\((\d)\)")


def split_hindi_block(raw: str) -> tuple[str, list[str]]:
    """
    Split a question's Hindi block into stem + four options.

    The Hindi rendering repeats the same "(1)".."(4)" markers as the English,
    so the split is structural rather than linguistic — no language knowledge
    and no model involved. Anything that does not yield exactly four options is
    returned as stem-only, so the caller can flag it for review instead of
    silently shipping a half-parsed question.
    """
    raw = clean(raw)
    if not raw:
        return "", []

    marks = [(m.start(), int(m.group(1))) for m in HI_OPT_RE.finditer(raw)]
    # Keep only a strictly ascending 1,2,3,4 run — "(1)" can legitimately occur
    # inside stem prose, and a bare ascending scan avoids latching onto it.
    run: list[tuple[int, int]] = []
    want = 1
    for pos, n in marks:
        if n == want:
            run.append((pos, n))
            want += 1
            if want > 4:
                break
    if len(run) != 4:
        return raw, []

    stem = raw[: run[0][0]].strip()
    opts: list[str] = []
    for i, (pos, _n) in enumerate(run):
        end = run[i + 1][0] if i + 1 < len(run) else len(raw)
        body = raw[pos:end]
        body = HI_OPT_RE.sub("", body, count=1).strip()
        opts.append(body)
    return stem, opts


def parse_questions(spans: list[Span]) -> list[ParsedQuestion]:
    """
    Walk the English span stream and assemble questions.

    State machine: a bare "N." opens a question; "(n)" opens an option; any
    other English text appends to whichever is currently open. Hindi spans are
    not parsed for content — they only extend the current question's Hindi
    bounding box.
    """
    questions: list[ParsedQuestion] = []
    cur: ParsedQuestion | None = None
    cur_opt: ParsedOption | None = None
    part: str | None = None
    subject: str | None = None
    # Set once the current question's Hindi rendering begins. After that point
    # every Latin span still belongs to the Hindi block — the "(1)"-"(4)"
    # option markers and inline terms like "(A)"/"(R)" are drawn in a Latin
    # face even inside Devanagari text. Without this flag those markers get
    # collected as a second set of English options, which is what produced
    # duplicate question numbers and 8-option questions.
    hindi_started = False

    # Open comprehension block, if any: (lo, hi) from the paper's own
    # declared range, plus the English and Hindi text accumulated so far.
    passage_range: tuple[int, int] | None = None
    passage_en_parts: list[str] = []
    passage_hi_parts: list[str] = []
    collecting_passage = False
    # number -> (english, hindi), applied after the walk so a question is
    # never half-built when its passage arrives.
    passages: dict[int, tuple[str, str]] = {}
    # Every range the paper DECLARED, whether or not text was captured for it.
    declared_ranges: list[tuple[int, int]] = []

    def close_passage():
        """Freeze the open block and map it onto every question it covers."""
        nonlocal passage_range, collecting_passage
        if passage_range and (passage_en_parts or passage_hi_parts):
            lo, hi = passage_range
            en = clean(" ".join(passage_en_parts))
            hi_text = clean(" ".join(passage_hi_parts))
            for n in range(lo, hi + 1):
                passages[n] = (en, hi_text)
        passage_range = None
        passage_en_parts.clear()
        passage_hi_parts.clear()
        collecting_passage = False

    def close_option():
        nonlocal cur_opt
        if cur and cur_opt is not None:
            cur_opt.text = clean(cur_opt.text)
            cur_opt = None

    def close_question():
        nonlocal cur, cur_opt, hindi_started
        close_option()
        if cur is not None:
            cur.stem_en = clean(cur.stem_en)
            cur.stem_hi, cur.options_hi = split_hindi_block(cur.hindi_raw)
            questions.append(cur)
            cur = None
        hindi_started = False

    for s in spans:
        # Page 1 is always the cover: a barcode, the booklet code, and a
        # numbered list of exam instructions that mentions "Part IV". Both the
        # numbering and the part reference mimic real content, so the cover is
        # excluded outright rather than filtered heuristically.
        if s.page == 0:
            continue

        raw = s.text
        txt = clean(raw)
        if not txt:
            continue

        # Part headers must be tested BEFORE the language branch. In the
        # Unicode-era papers the banner is bilingual ("भाग I /PART I"), so it
        # is legitimately classified as Hindi — and if the Hindi branch runs
        # first it swallows the banner, `part` never opens, and every question
        # in Parts I-III is silently dropped.
        # A new Directions block ends the previous one and starts collecting
        # the passage that follows. Tested before everything else because the
        # directive line itself must not be mistaken for stem text.
        dm = DIRECTIONS_RE.search(txt)
        if dm:
            close_question()
            close_passage()
            passage_range = (int(dm.group("lo")), int(dm.group("hi")))
            declared_ranges.append(passage_range)
            collecting_passage = True
            continue

        pm = PART_RE.search(txt)
        if pm:
            close_question()
            part = pm.group(1)
            subject = None
            continue

        # The subject banner must ALSO be tested before the language branch,
        # for exactly the reason the part banner is: it is printed bilingually
        # ("MATHEMATICS AND SCIENCE / गणित व विज्ञान"), so the Hindi branch
        # below classifies it as Hindi and swallows it. That is how the booklet
        # code ended up as the subject for all 369 questions.
        #
        # match_banner returns None for anything that is not a real syllabus
        # name, so a footer or an option line leaves `subject` untouched
        # instead of becoming it.
        if part and subject is None:
            banner = match_banner(txt)
            if banner:
                subject = banner
                continue

        # Passage text runs from the directive to the first question number.
        # Both scripts are kept: an English Language paper prints an English
        # passage, a Hindi one prints Hindi, and Language II sections carry
        # whichever language that section is testing.
        if collecting_passage and not QUESTION_RE.match(raw) and not INLINE_Q_RE.match(raw):
            chunk = txt
            # The directive sentence often wraps across two spans, so the span
            # AFTER the one carrying "(Q. Nos. 91 to 96)" starts with its tail —
            # "correct/most appropriate option." — immediately followed by the
            # passage. Left in place that tail becomes the opening words of the
            # reading material, which is both wrong and confusing on screen.
            if not passage_en_parts and not passage_hi_parts:
                chunk = DIRECTIVE_TAIL_RE.sub("", chunk, count=1)
            if chunk:
                (passage_hi_parts if s.hindi else passage_en_parts).append(chunk)
            continue
        if collecting_passage:
            # First question of the block: the passage is complete. Freeze it
            # and fall through so this span still opens the question.
            close_passage()

        if s.hindi:
            hindi_started = True
            if cur is not None:
                cur.hindi_raw += (" " if cur.hindi_raw else "") + txt
            # Extend the Hindi region for the open question.
            if cur is not None:
                if cur.hindi_bbox is None or cur.hindi_page != s.page:
                    if cur.hindi_bbox is None:
                        cur.hindi_page = s.page
                        cur.hindi_bbox = s.bbox
                elif cur.hindi_page == s.page:
                    b = cur.hindi_bbox
                    cur.hindi_bbox = (
                        min(b[0], s.bbox[0]),
                        min(b[1], s.bbox[1]),
                        max(b[2], s.bbox[2]),
                        max(b[3], s.bbox[3]),
                    )
            continue

        # The front cover carries a numbered list of exam instructions and the
        # back cover carries another. Both look exactly like questions. Nothing
        # before the first "PART - I" banner is content.
        if part is None:
            continue

        # A new question number always wins, INCLUDING mid-Hindi: it is the
        # only reliable signal that the previous question has ended, and the
        # next question's English stem is merged onto its number ("2. Assertion
        # (A) : ...") so it arrives as an inline match.
        #
        # Strict monotonicity (exactly +1) is what keeps this safe. It rejects:
        #   - stray numerals inside a Hindi block,
        #   - the Hindi Language-I section restarting at 91 after the English
        #     one ended at 120 (they are different questions; we take one set),
        #   - the back-cover instruction list restarting at 1 after Q150.
        m = QUESTION_RE.match(raw)
        mi = INLINE_Q_RE.match(raw)
        if m or mi:
            num = int((m or mi).group(1))
            if cur is None or num == cur.number + 1:
                close_question()
                cur = ParsedQuestion(
                    number=num,
                    stem_en=mi.group(2) if (mi and not m) else "",
                    options_en=[],
                    page=s.page,
                    part=part,
                    subject=subject,
                )
                continue

        if cur is None:
            continue

        # Everything past the start of the Hindi block belongs to the Hindi
        # rendering, so stop collecting English content for this question.
        if hindi_started:
            # Latin-font fragments inside the Hindi block ("(1)", "(A)", roman
            # numerals) are part of the Hindi rendering and are needed to split
            # its options, so keep them in the raw block rather than dropping.
            cur.hindi_raw += (" " if cur.hindi_raw else "") + txt
            continue

        for piece in split_option_columns(txt):
            mo = OPTION_RE.match(piece)
            moi = INLINE_OPT_RE.match(piece)
            if mo or moi:
                idx = int((mo or moi).group(1))
                if 1 <= idx <= 4 and len(cur.options_en) < 4:
                    close_option()
                    cur_opt = ParsedOption(
                        label=OPTION_LABELS[idx - 1],
                        text=moi.group(2) if moi else "",
                    )
                    cur.options_en.append(cur_opt)
                continue

            if cur_opt is not None:
                cur_opt.text += " " + piece
            else:
                cur.stem_en += " " + piece

    close_question()
    close_passage()

    # Attach shared reading material. Done here rather than inline because a
    # block's range is declared before its questions exist.
    #
    # A question inside a DECLARED range that ends up with no passage is a
    # parser failure, not a paper without one — the booklet said the text is
    # there. It is warned on rather than passed over silently, because the
    # downstream explanation pipeline treats "has a passage" as licence to
    # reason about the text, and a question that slipped through would be
    # explained from the model's memory of the source instead.
    for q in questions:
        found = passages.get(q.number)
        if found:
            q.passage_en, q.passage_hi = found
        elif any(lo <= q.number <= hi for lo, hi in declared_ranges):
            q.warnings.append(
                "inside a declared comprehension range but no passage was captured"
            )

    return questions


def validate(questions: list[ParsedQuestion], expected: int) -> dict:
    """
    Structural checks. These are the auto-flags the Content Review tool
    surfaces in red — a question that trips one of these is never bulk-approved.
    """
    for q in questions:
        if len(q.options_en) != 4:
            q.warnings.append(f"expected 4 options, got {len(q.options_en)}")
        if not q.stem_en:
            q.warnings.append("empty stem")
        for o in q.options_en:
            if not o.text:
                q.warnings.append(f"option {o.label} empty")
        # Parts I-III (CDP, Maths, EVS) are printed bilingually, so a missing
        # Hindi region there means the parse lost something. Parts IV and V are
        # the Language I / Language II sections, which are printed in a single
        # chosen language — absent Hindi there is correct, not a defect.
        if q.hindi_bbox is None and q.part in ("I", "II", "III"):
            q.warnings.append("no Hindi region found")

    numbers = [q.number for q in questions]
    dupes = {n for n in numbers if numbers.count(n) > 1}
    missing = sorted(set(range(1, expected + 1)) - set(numbers)) if expected else []

    return {
        "parsed": len(questions),
        "expected": expected,
        "with_4_options": sum(1 for q in questions if len(q.options_en) == 4),
        "with_hindi_region": sum(1 for q in questions if q.hindi_bbox),
        "clean": sum(1 for q in questions if not q.warnings),
        "flagged": sum(1 for q in questions if q.warnings),
        "duplicate_numbers": sorted(dupes),
        "missing_numbers": missing[:20],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Parse a CTET bilingual paper PDF.")
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--expected", type=int, default=150, help="questions expected (CTET = 150)")
    ap.add_argument("--out", type=Path, help="write parsed JSON here")
    ap.add_argument("--show", type=int, default=2, help="print N sample questions")
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    spans = merge_english_lines(collect_spans(doc))
    questions = parse_questions(spans)
    report = validate(questions, args.expected)
    doc.close()

    print(json.dumps(report, indent=2, ensure_ascii=False))

    for q in questions[: args.show]:
        print(f"\n--- Q{q.number}  [part {q.part} / {q.subject}]  page {q.page + 1}")
        print(f"    {q.stem_en[:160]}")
        for o in q.options_en:
            print(f"      ({o.label}) {o.text[:90]}")
        if q.warnings:
            print(f"    !! {q.warnings}")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps([asdict(q) for q in questions], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"\nwrote {args.out}")

    return 0 if report["flagged"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

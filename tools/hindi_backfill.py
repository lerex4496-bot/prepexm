"""
Recover the Hindi half of the bilingual CTET papers, without touching the parser.

WHY A SEPARATE TOOL AND NOT A CHANGE TO ctet_parse.py
-----------------------------------------------------
The Hindi in these papers is set in Chanakya, a pre-Unicode font that maps
Devanagari glyphs onto Latin codepoints, so it extracts as mojibake and every
one of these papers currently ships with stem_hi empty. tools/legacy_devanagari
decodes it and is proven: 70/70 on its own suite, every code checked
individually, and lines verified against rendered crops of the page.

Wiring that decoder INTO ctet_parse.py was tried twice and regressed twice —
once dropping a paper from 150 questions to 73, once producing fragments like
"(A) : / (R) :". That parser was deliberately built never to hold legacy Hindi
text: it records bounding boxes so the Hindi can be rendered from the PDF
later. Integrating decoded text means reworking that pipeline, and doing it
badly puts WRONG Hindi in front of a Hindi-medium student, which is worse than
English-only.

So this is additive and cannot regress the parser: it reads the same PDFs
independently, decodes, and fills stem_hi ONLY where it is currently empty. The
English stems, the options and the answer keys — all reviewed, all verified
against CBSE's own keys with zero mismatches — are never touched.

THE LAYOUT IT RELIES ON
-----------------------
Every bilingual page is regular, which is what makes this safe:

    4.                              question number, latin, x ~ 42
      According to Lev Vygotsky...  English stem,    latin, x ~ 70
      (1) providing students...     English options, latin, x ~ 99
      ...
      लेव वायगोत्स्की के सिद्धांत...      Hindi stem,   Chanakya, x ~ 70
      (1) छात्रों को ऐसा काम...          Hindi options, Chanakya, x ~ 99

Indentation separates stem from option, and the English block always precedes
the Hindi block. Nothing here guesses which language a run is in — the FONT
says so.

ZERO SILENT CORRUPTION
----------------------
convert_verbose reports any code it could not place. A run with problems is
never written; it is counted and reported so the failure is visible as a gap
rather than as plausible-looking wrong Devanagari. Nothing is written when the
decoder is unhappy, and nothing overwrites Hindi that is already there.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy_devanagari as L  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "apps" / "mobile" / "assets" / "content" / "studymate.db"
OUT = ROOT / "content" / "parsed" / "hindi_backfill.json"

QNUM_RE = re.compile(r"^(\d{1,3})\.$")
OPT_RE = re.compile(r"^\((\d)\)$")

# Indentation, in points. A stem sits at the question's left margin; an option's
# text is indented past its "(n)" marker. Measured from the papers, with a wide
# band because sets differ by a point or two.
STEM_MAX_X = 90.0


@dataclass
class Q:
    number: int
    stem_runs: list[str] = field(default_factory=list)
    options: dict[int, list[str]] = field(default_factory=dict)
    problems: int = 0


def decode_line(spans: list[dict]) -> tuple[str, int]:
    """Decode one line's Chanakya spans. Returns (text, problem_count)."""
    text = ""
    problems = 0
    for s in spans:
        raw = s["text"]
        if not raw.strip():
            text += raw
            continue
        out, probs = L.convert_verbose(raw)
        if probs:
            problems += len(probs)
        text += out
    return text, problems


def is_chanakya(font: str) -> bool:
    return "chanakya" in font.lower()


def extract(pdf: Path, first_page: int = 0) -> tuple[dict[int, Q], int]:
    """Walk the PDF and collect decoded Hindi per question number."""
    # TWO READERS, ONE PER LANGUAGE, AND NEITHER IS INTERCHANGEABLE.
    #
    # The Latin structure — question numbers and "(n)" markers — comes from the
    # ordinary reader, which handles it fine.
    #
    # The Hindi CANNOT come from there. get_text() groups glyphs into blocks and
    # lines, and in these booklets that grouping silently DROPS glyphs: half of
    # a two-piece घ drawn at x=99.1, on a line whose block starts at x=103.2,
    # appears in no span at all. The page still renders it; extraction loses it,
    # and the loss reads as a plausible word (घरेलू -> ारेलू) rather than as an
    # error. Measured on this file: 10 of 99 questions recovered with 129
    # unplaceable codes that way, against 149 of 150 through get_texttrace().
    #
    # iter_legacy_runs is built on get_texttrace(), which reports every glyph
    # the renderer draws, so nothing can go missing.
    import pymupdf

    plain = pymupdf.open(pdf)
    doc = L.open_lossless(str(pdf))

    questions: dict[int, Q] = {}
    total_problems = 0

    for pno in range(first_page, plain.page_count):
        # (y, x, kind, value) events, merged and walked in reading order.
        events: list[tuple[float, float, str, object]] = []

        for block in plain[pno].get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = [s for s in line["spans"] if s["text"].strip()]
                if not spans or any(is_chanakya(s["font"]) for s in spans):
                    continue
                flat = "".join(s["text"] for s in spans).strip()
                x, y = line["bbox"][0], line["bbox"][1]
                m = QNUM_RE.match(flat)
                if m and x < 60:
                    events.append((y, x, "qnum", int(m.group(1))))
                    continue
                m = OPT_RE.match(flat)
                if m:
                    events.append((y, x, "opt", int(m.group(1))))

        for _p, bbox, codes in L.iter_legacy_runs(doc, [pno]):
            text, problems = L.convert_verbose(bytes(codes))
            if problems:
                total_problems += len(problems)
                continue
            if text.strip():
                events.append((bbox[1], bbox[0], "hi", text.strip()))

        events.sort(key=lambda e: (round(e[0], 1), e[1]))

        current: Q | None = None
        current_opt: int | None = None
        for _y, x, kind, value in events:
            if kind == "qnum":
                current = questions.setdefault(int(value), Q(number=int(value)))
                current_opt = None
            elif kind == "opt":
                # The English options come first, then the Hindi ones, so each
                # marker number is seen twice per question. Either way it names
                # the option that any following Hindi run belongs to.
                current_opt = int(value)
            elif current is not None:
                if current_opt is None or x < STEM_MAX_X:
                    current.stem_runs.append(str(value))
                else:
                    current.options.setdefault(current_opt, []).append(str(value))

    return questions, total_problems


def joined(runs: list[str]) -> str:
    """Join wrapped lines into one string.

    Devanagari does not use a hyphen at a line break, so a space is always the
    right joiner; collapsing whitespace afterwards handles the double spaces
    that come from a line ending in one.
    """
    return re.sub(r"\s+", " ", " ".join(runs)).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="*", help="source PDFs (bilingual Eng+Hin sets)")
    ap.add_argument("--paper-id", help="bundle paper id to fill, when applying")
    ap.add_argument("--apply", action="store_true", help="write stem_hi into the bundle")
    ap.add_argument("--min-questions", type=int, default=100,
                    help="refuse to apply if fewer questions decoded (default 100)")
    args = ap.parse_args()

    if not args.pdfs:
        print("give at least one PDF")
        return 1

    all_q: dict[int, Q] = {}
    problems = 0
    for spec in args.pdfs:
        pdf = Path(spec)
        if not pdf.exists():
            print(f"  missing: {pdf}")
            continue
        qs, probs = extract(pdf)
        problems += probs
        for n, q in qs.items():
            all_q.setdefault(n, q)
        print(f"  {pdf.name[:52]:52} {len(qs):3} questions, {probs} decode problems")

    complete = {n: q for n, q in all_q.items() if q.stem_runs}
    print(f"\n{len(all_q)} question numbers seen, {len(complete)} with Hindi stems")
    print(f"{problems} runs could not be decoded and were SKIPPED, not guessed")

    payload = {
        str(n): {
            "stem_hi": joined(q.stem_runs),
            "options_hi": {str(k): joined(v) for k, v in sorted(q.options.items())},
        }
        for n, q in sorted(complete.items())
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT}")

    for n in list(sorted(complete))[:3]:
        print(f"\n  Q{n}: {payload[str(n)]['stem_hi'][:88]}")

    if not args.apply:
        print("\n(dry run — pass --apply with --paper-id to write into the bundle)")
        return 0

    if not args.paper_id:
        print("--apply needs --paper-id")
        return 1

    # THE SET GUARD. This is the one that matters.
    #
    # CBSE prints four shuffled sets of each paper. The Hindi decodes perfectly
    # from any of them, and attaching set A's Hindi to a bundle holding set B
    # produces a paper where every question reads correctly in both languages
    # and they are DIFFERENT QUESTIONS — with the English, the options and the
    # verified answer key all describing one thing and the Hindi another.
    #
    # It nearly shipped: set A's Q1 was written against set B's Q1, which is
    # actually set A's Q6. Nothing about the output looked wrong. A student
    # revising in Hindi would have been answering a question she could not see.
    #
    # The set is in the filename (AAAA/BBBB/...) and in the papers table, so
    # this is checkable exactly rather than by inspection.
    con = sqlite3.connect(BUNDLE)
    row = con.execute("SELECT set_code FROM papers WHERE id = ?", (args.paper_id,)).fetchone()
    paper_set = (row[0] or "").strip().upper() if row else ""
    names = " ".join(Path(p).name.upper() for p in args.pdfs)
    pdf_sets = {m for m in re.findall(r"\b([A-Z])\1{3}\b", names)}
    if paper_set and pdf_sets and paper_set not in pdf_sets:
        con.close()
        print(
            f"\nREFUSING: bundle paper is set {paper_set}, "
            f"but the PDF(s) are set {'/'.join(sorted(pdf_sets))}.\n"
            "The sets are shuffled — this would attach correct Hindi to the wrong questions."
        )
        return 1
    con.close()
    if len(complete) < args.min_questions:
        # A partial decode written into the bundle would leave her with some
        # questions bilingual and some not, for no visible reason.
        print(f"refusing: only {len(complete)} questions decoded (< {args.min_questions})")
        return 1

    con = sqlite3.connect(BUNDLE)
    filled = skipped = 0
    for n, data in payload.items():
        cur = con.execute(
            "SELECT id, stem_hi FROM questions WHERE paper_id = ? AND number = ?",
            (args.paper_id, int(n)),
        ).fetchone()
        if not cur:
            continue
        if cur[1] and cur[1].strip():
            skipped += 1  # never overwrite Hindi that is already there
            continue
        con.execute("UPDATE questions SET stem_hi = ? WHERE id = ?", (data["stem_hi"], cur[0]))
        filled += 1
    con.commit()
    con.close()
    print(f"\nfilled {filled} stems, left {skipped} existing ones alone")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
Find characters the PDFs cannot actually tell us.

THE FAILURE THIS EXISTS TO CATCH
--------------------------------
A CTET booklet renders "90° East". Text extraction returns "908 East".

Nothing about that looks wrong. It is not mojibake, there is no replacement
character, the string is valid ASCII, and it survives every diff — including a
diff against the PDF's own extracted text, because both sides are corrupted
identically. It reached a Social Studies paper, where degrees appear in every
other longitude and temperature question, and the only reason it was noticed at
all was someone rendering the page to an image and looking at it.

The mechanism is precise. A symbol font declares its glyphs in an /Encoding
/Differences array, and declares what they MEAN in a /ToUnicode CMap. When a
code appears in the first and not the second, the extractor has no mapping and
falls back to emitting the raw byte:

    /Differences [ ... 56 /c5243 ... ]      code 56 is some glyph named c5243
    /ToUnicode   <20> <32> <35> <44> <70>   ...but 56 is not in here

so code 56 comes out as its ASCII value, "8", and the degree sign is gone.

WHAT THIS DOES
--------------
Walks every source booklet, and for every font reports the codes that are USED
on the page but have no ToUnicode mapping. Those are exactly the characters
whose extracted value is a guess.

It reads PDFs only — it never edits content, and it makes no attempt to decide
what an unmapped glyph should be. That decision needs a human looking at a
rendered page, and the point of this tool is to tell them which pages to look
at instead of hoping someone stumbles on it.

Usage:
    python tools/font_audit.py
    python tools/font_audit.py --pdf "content/raw/ctet/.../Main-G.pdf"
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "content" / "raw" / "ctet"

# Fonts whose unmapped codes have been checked by rendering the page and are
# known-safe or known-bad. Keyed by the base font name with its subset prefix
# stripped (the "MROOSW+" part changes per file).
# Each entry below was established by RENDERING the page to an image and
# reading it — never by inference from context, which is how a wrong guess
# would get baked in permanently.
KNOWN = {
    # p39, 08 Feb 2026 Paper II: "What will be the time at 90° East ..."
    # extracted as "908 East". 34 occurrences in that booklet alone.
    ("TT286AO00", 0x38): "°",   # DEGREE SIGN            U+00B0
    # p20, same booklet: "if AB∥DC, ∠B=70° and AB=CD" extracted as
    # "if AB??DC, ∠B=708". A geometry question rendered meaningless.
    ("TT286AO00", 0x3F): "∥",   # PARALLEL TO            U+2225
}

BFRANGE = re.compile(rb"beginbfrange(.*?)endbfrange", re.S)
BFCHAR = re.compile(rb"beginbfchar(.*?)endbfchar", re.S)
HEXPAIR = re.compile(rb"<([0-9A-Fa-f]+)>")


def tounicode_codes(doc: pymupdf.Document, font_obj: str) -> set[int] | None:
    """Codes the font's ToUnicode CMap covers, or None if it has no CMap."""
    m = re.search(r"/ToUnicode (\d+) 0 R", font_obj)
    if not m:
        return None
    try:
        raw = doc.xref_stream(int(m.group(1)))
    except (RuntimeError, ValueError):
        return None
    if not raw:
        return None

    covered: set[int] = set()
    for block in BFCHAR.findall(raw):
        hexes = HEXPAIR.findall(block)
        for i in range(0, len(hexes) - 1, 2):
            covered.add(int(hexes[i], 16))
    for block in BFRANGE.findall(raw):
        hexes = HEXPAIR.findall(block)
        # <lo> <hi> <dst> triples
        for i in range(0, len(hexes) - 2, 3):
            lo, hi = int(hexes[i], 16), int(hexes[i + 1], 16)
            covered.update(range(lo, hi + 1))
    return covered


def differences(doc: pymupdf.Document, font_obj: str) -> dict[int, str]:
    """
    {code: glyph name} from the font's /Encoding /Differences array.

    /Encoding is usually an INDIRECT REFERENCE ("/Encoding 801 0 R"), so the
    Differences array lives in its own object and is not present in the font
    object's own text. Searching only the font object found nothing at all —
    which read as "this PDF is clean" for the one file known to be broken.
    """
    m = re.search(r"/Encoding (\d+) 0 R", font_obj)
    source = font_obj
    if m:
        try:
            source = doc.xref_object(int(m.group(1)))
        except (RuntimeError, ValueError):
            pass

    m = re.search(r"/Differences\s*\[(.*?)\]", source, re.S)
    if not m:
        return {}
    out: dict[int, str] = {}
    code = 0
    for tok in m.group(1).split():
        if tok.isdigit():
            code = int(tok)
        elif tok.startswith("/"):
            out[code] = tok[1:]
            code += 1
    return out


def audit(pdf: Path) -> list[tuple[str, int, str, int, int]]:
    """
    (font, code, glyph name, times the raw byte appears, first page 1-indexed)

    The signature of the failure is a property of the FONT, not of the
    extracted text: a code declared in /Differences but absent from the
    /ToUnicode CMap. For such a code the extractor has nothing to map to and
    emits the raw byte, so `chr(code)` turns up in the text looking like an
    ordinary ASCII character.

    An earlier version of this compared `ord(ch)` of the extracted text against
    the CMap's byte codes. Those are different namespaces — extracted text is
    already Unicode — so every legitimate en-dash, matra and maths symbol was
    reported. 190 findings on a paper that is known clean is not a signal.
    """
    doc = pymupdf.open(pdf)

    findings: list[tuple[str, int, str, int, int]] = []
    seen_fonts: set[str] = set()
    for pno in range(doc.page_count):
        for xref, _ext, _typ, basefont, _name, _enc in doc.get_page_fonts(pno):
            base = basefont.split("+")[-1]
            if base in seen_fonts:
                continue
            seen_fonts.add(base)

            obj = doc.xref_object(xref)
            covered = tounicode_codes(doc, obj)
            if covered is None:
                continue  # no CMap: a standard text font, mapped by encoding
            diffs = differences(doc, obj)
            unmapped = {c: g for c, g in diffs.items() if c not in covered}
            if not unmapped:
                continue

            # Count how often the raw byte actually surfaces in this font's
            # spans — an unmapped glyph that is never used is harmless.
            hits: dict[int, tuple[int, int]] = {}
            for p2 in range(doc.page_count):
                for block in doc[p2].get_text("dict")["blocks"]:
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            if span["font"].split("+")[-1] != base:
                                continue
                            for code in unmapped:
                                n = span["text"].count(chr(code))
                                if n:
                                    prev, first = hits.get(code, (0, p2 + 1))
                                    hits[code] = (prev + n, first)

            for code, glyph in sorted(unmapped.items()):
                count, first = hits.get(code, (0, 0))
                if count:
                    findings.append((base, code, glyph, count, first))
    doc.close()
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", help="audit a single PDF instead of the whole corpus")
    args = ap.parse_args()

    if args.pdf:
        pdfs = [Path(args.pdf)]
    else:
        pdfs = sorted(
            p for p in RAW.rglob("*.pdf")
            if "keys" not in p.parts and p.stat().st_size > 200_000
        )

    total_bad = 0
    for pdf in pdfs:
        try:
            findings = audit(pdf)
        except Exception as e:  # noqa: BLE001 — one unreadable PDF must not stop the sweep
            print(f"!  {pdf.name}: {type(e).__name__}: {e}")
            continue
        if not findings:
            continue
        # A --pdf given as a relative path is not under ROOT as written, and
        # relative_to raises rather than falling back. The name is enough here.
        try:
            shown = pdf.resolve().relative_to(ROOT)
        except ValueError:
            shown = pdf
        print(f"\n{shown}")
        for base, code, glyph, count, first in findings:
            known = KNOWN.get((base, code))
            verdict = f"VERIFIED = {known!r}" if known else f"UNVERIFIED — render p{first} and look"
            print(
                f"    {base:14} code 0x{code:02X} (/{glyph}) extracts as {chr(code)!r:5} "
                f"x{count:<4} first p{first:<4} {verdict}"
            )
            if not known:
                total_bad += 1

    print()
    if total_bad:
        print(f"{total_bad} unmapped glyph(s) with no verified meaning — extraction is guessing.")
    else:
        print("No unmapped glyphs beyond the ones already verified.")
    return 1 if total_bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

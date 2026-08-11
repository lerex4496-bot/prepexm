"""
Build a glyph specimen sheet for a legacy Devanagari font used in a PDF.

WHY THIS EXISTS
---------------
CBSE's CTET papers set Hindi in legacy 8-bit fonts (Chanakya, Yogesh, Mitra1)
whose /Encoding is plain MacRomanEncoding: the font carries NO semantic glyph
names, it simply draws Devanagari shapes at Latin code points. So there is no
programmatic way to learn what byte 0xE6 means — the information exists only in
the glyph outlines.

Off-the-shelf converters do not help: `lipi` targets the ASCII typing-layout
Chanakya, and on these files it transliterates the ENGLISH into Devanagari
while leaving the actual Hindi untouched.

So the mapping has to be read off the glyphs. Rather than re-rasterise a
subsetted CFF (fragile), this crops each glyph from the ORIGINAL page using
per-character bounding boxes, so what lands on the specimen sheet is exactly
what the official renderer draws.

The output is a labelled grid: every distinct byte slot, its hex code, and its
rendered glyph. Reading that grid once produces a deterministic table that then
converts the whole corpus with no per-question inference.
"""

from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ctet_parse import is_hindi_font  # noqa: E402


def char_occurrences(doc: pymupdf.Document, font_filter: str | None, max_pages: int):
    """Per-character bboxes for legacy-font characters, keyed by byte value."""
    occ: dict[int, list[tuple[int, tuple[float, float, float, float], float, str]]] = (
        collections.defaultdict(list)
    )
    pages = min(max_pages, doc.page_count)
    for pno in range(pages):
        raw = doc[pno].get_text("rawdict")
        for block in raw.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    font = span.get("font", "")
                    if not is_hindi_font(font):
                        continue
                    if font_filter and font_filter.lower() not in font.lower():
                        continue
                    size = span.get("size", 0)
                    for ch in span.get("chars", []):
                        c = ch.get("c", "")
                        if not c or c == " ":
                            continue
                        try:
                            b = c.encode("mac_roman")[0]
                        except Exception:
                            continue
                        occ[b].append((pno, tuple(ch["bbox"]), size, font))
    return occ


def build_sheet(
    src: Path, out_pdf: Path, out_png: Path, font_filter: str | None, dpi: int, max_pages: int
):
    doc = pymupdf.open(src)
    occ = char_occurrences(doc, font_filter, max_pages)
    if not occ:
        raise SystemExit("no legacy-font characters found")

    # Prefer the largest rendering of each glyph — bigger type crops cleaner.
    chosen: dict[int, tuple[int, tuple, float, str]] = {}
    for b, lst in occ.items():
        lst.sort(key=lambda t: -t[2])
        chosen[b] = lst[0]

    order = sorted(chosen)
    cols, cell, pad, label_h = 6, 130, 12, 18
    rows = (len(order) + cols - 1) // cols
    W = cols * (cell + pad) + pad
    H = rows * (cell + label_h + pad) + pad + 40

    out = pymupdf.open()
    page = out.new_page(width=W, height=H)
    page.insert_text(
        (pad, 26),
        f"{src.name} — {font_filter or 'all legacy fonts'} — {len(order)} distinct byte slots",
        fontsize=12,
    )

    # Work on a copy so the red target markers are baked into the render at
    # exactly the right place. Context around each glyph is necessary (matras
    # and conjunct halves belong to neighbouring slots), but without a marker
    # it is impossible to tell WHICH glyph in the crop is the one being named.
    marked = pymupdf.open(src)

    for b in order:
        pno, bbox, _size, _font = chosen[b]
        marked[pno].draw_rect(pymupdf.Rect(*bbox), color=(1, 0, 0), width=0.4)

    for i, b in enumerate(order):
        pno, bbox, size, font = chosen[b]

        # Pad the crop so matras above and below the baseline survive — those
        # marks are exactly what distinguishes many of these glyphs, and a
        # tight bbox would clip the very detail the mapping depends on.
        x0, y0, x1, y1 = bbox
        mx, my = (x1 - x0) * 0.9 + 3, (y1 - y0) * 0.35 + 3
        clip = pymupdf.Rect(x0 - mx, y0 - my, x1 + mx, y1 + my)
        sub = marked[pno].get_pixmap(dpi=dpi, clip=clip)
        if not sub.width or not sub.height:
            continue

        r, c = divmod(i, cols)
        cx = pad + c * (cell + pad)
        cy = 40 + pad + r * (cell + label_h + pad)

        page.insert_text((cx, cy + 11), f"0x{b:02X}", fontsize=9)
        rect = pymupdf.Rect(cx, cy + label_h, cx + cell, cy + label_h + cell)
        page.draw_rect(rect, color=(0.85, 0.85, 0.85), width=0.5)
        page.insert_image(rect, pixmap=sub, keep_proportion=True)

    out.save(out_pdf)
    out[0].get_pixmap(dpi=150).save(out_png)
    out.close()
    marked.close()
    doc.close()

    print(f"{len(order)} glyph slots -> {out_pdf}")
    print(f"specimen png       -> {out_png}")
    counts = {b: len(v) for b, v in occ.items()}
    print("most frequent slots:", sorted(counts.items(), key=lambda kv: -kv[1])[:12])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--font", default="Chanakya", help="substring filter, e.g. Chanakya / Yogesh / Mitra")
    ap.add_argument("--dpi", type=int, default=400)
    ap.add_argument("--max-pages", type=int, default=20)
    ap.add_argument("--out", type=Path, required=True, help="output .pdf (png written alongside)")
    args = ap.parse_args()
    build_sheet(args.pdf, args.out, args.out.with_suffix(".png"), args.font, args.dpi, args.max_pages)
    return 0


if __name__ == "__main__":
    sys.exit(main())

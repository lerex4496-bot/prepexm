"""
Render questions whose options are pictures, instead of dropping them.

THE PROBLEM
-----------
A minority of CTET questions typeset their options as raster images rather than
text — stacked fractions, chemical structures, geometry figures. There is no
text layer to extract, so the parser produces empty or marker-only options
("(2)" with nothing after it), validation rejects them, and they never ship.
Twenty questions across the corpus are in that state.

WHY NOT OCR
-----------
OCR is the obvious answer and it is the wrong one here. The options are things
like -7/4 and 13/14, where a dropped minus sign or a swapped numerator produces
a plausible-looking option that is wrong. That failure is silent: nothing
downstream can tell "-7/4" from "7/4", and she would be revising from it three
weeks before the exam. Reading an image and then asserting the text is exactly
the "zero silent corruption" rule this project runs on.

WHAT THIS DOES INSTEAD
----------------------
Crops the question straight out of the source PDF and ships the PICTURE. The
board's own typesetting is displayed, so there is nothing to transcribe and
nothing to get wrong. She still answers by choosing 1/2/3/4, and the official
key still decides correctness — none of that changes.

A useful side effect: the crop spans the full printed width, which on these
bilingual booklets captures the ENGLISH AND THE HINDI version of the question
together. For a Hindi-medium candidate that is better than the text path, which
currently recovers English only.

Usage:
    python tools/option_images.py --dry-run
    python tools/option_images.py --write
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
PARSED = ROOT / "content" / "parsed"

# 3x renders crisply on a phone without bloating the bundle: a typical crop is
# 20-40 KB, and only the handful of affected questions carry one.
ZOOM = 3.0
MARKER_PAD_TOP = 14.0   # stacked fractions sit well above the marker baseline
MARKER_PAD_BOTTOM = 4.0


def needs_image(q: dict) -> bool:
    """True when the option text is missing or is nothing but its own marker."""
    options = q.get("options") or []
    if len(options) != 4:
        return True
    for o in options:
        text = ((o.get("text") or {}).get("en") or "").strip()
        if not text or re.fullmatch(r"\(\s*\d\s*\)", text):
            return True
    return False


def marker_bbox(page: pymupdf.Page, number: int) -> tuple[float, float, float, float] | None:
    """
    The bounding box of the line that starts with "<number>.".

    The trailing content is optional on purpose. Where the STEM is itself an
    image — "39." followed by a picture of an equation — the text line is the
    bare marker with nothing after it. Requiring whitespace after the dot
    failed to find exactly the questions this tool exists to rescue.
    """
    pattern = re.compile(rf"^{number}\.(\s|$)")
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(s["text"] for s in line.get("spans", [])).strip()
            if pattern.match(text):
                return tuple(line["bbox"])
    return None


def render(doc: pymupdf.Document, page_no: int, number: int) -> str | None:
    """Base64 PNG of the whole question, or None if it cannot be located."""
    if not 0 <= page_no < doc.page_count:
        return None
    page = doc[page_no]
    here = marker_bbox(page, number)
    if not here:
        return None

    # The question ends where the next one begins. When the next marker is on
    # the following page this question runs to the foot of this one — stopping
    # short of the footer so the booklet code is not baked into the image.
    following = marker_bbox(page, number + 1)
    bottom = following[1] - MARKER_PAD_BOTTOM if following else page.rect.height - 40

    top = here[1] - MARKER_PAD_TOP
    if bottom <= top:
        return None

    rect = pymupdf.Rect(max(here[0] - 8, 0), max(top, 0), page.rect.width - 6, bottom)
    pixmap = page.get_pixmap(clip=rect, matrix=pymupdf.Matrix(ZOOM, ZOOM))
    return base64.b64encode(pixmap.tobytes("png")).decode("ascii")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default="ctet_*.json")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--write", action="store_true")
    args = ap.parse_args()

    total_needing = total_rendered = 0
    total_bytes = 0

    for path in sorted(PARSED.glob(args.glob)):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        paper = data.get("paper") or {}
        source = paper.get("sourcePdf")
        targets = [q for q in data.get("questions") or [] if needs_image(q)]
        if not targets:
            continue
        total_needing += len(targets)

        if not source or not Path(source).exists():
            print(f"!  {path.name}: source PDF missing, cannot render {len(targets)}")
            continue

        doc = pymupdf.open(source)
        rendered = []
        for q in targets:
            page_no = q.get("sourcePage")
            if page_no is None:
                continue
            png = render(doc, page_no, q.get("number"))
            if not png:
                continue
            if args.write:
                q["renderedPng"] = png
            rendered.append((q.get("number"), len(png)))
            total_bytes += len(png)
        doc.close()

        total_rendered += len(rendered)
        if rendered:
            shown = ", ".join(f"Q{n}" for n, _b in rendered[:8])
            print(f"{path.name[:58]:60} {len(rendered)}/{len(targets)}  {shown}")
        if args.write and rendered:
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    print()
    print(
        f"{total_needing} questions have picture options · "
        f"{total_rendered} rendered · {total_bytes / 1024:.0f} KB of base64"
    )
    if total_needing - total_rendered:
        print(f"{total_needing - total_rendered} could not be located on their page — reported, not faked")
    if args.dry_run:
        print("\ndry run — nothing written. Re-run with --write to embed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

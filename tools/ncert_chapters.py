"""
Download NCERT CHAPTER PDFs — the actual textbook content.

CORRECTION THIS FILE EXISTS TO FIX
----------------------------------
The first pass assumed `<code>ps.pdf` was the complete book. It is not — `ps`
is the PRELIMS: cover, copyright page, foreword, contents. 105 MB of front
matter with no teaching content in it. The manifest "verified" those URLs only
in the sense that they returned real PDFs; it never checked they were books.

The real content lives at `<code><NN>.pdf`, zero-padded chapter numbers:

    fecu102.pdf  ->  Class 6 Science, Chapter 2, "Diversity in the Living World"

Chapter counts are not published anywhere machine-readable, so this probes
upward from 01 and stops after a run of consecutive misses.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "content" / "manifests" / "ncert.json"
OUT = ROOT / "content" / "raw" / "ncert"
BASE = "https://ncert.nic.in/textbook/pdf/{code}{ch:02d}.pdf"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def fetch(url: str, timeout: int) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        return data if data[:4] == b"%PDF" else None
    except (urllib.error.URLError, OSError, TimeoutError):
        return None


def book_chapters(
    book: dict, pause: float, timeout: int, max_ch: int, miss_limit: int
) -> tuple[int, int, int]:
    """Walk chapters until `miss_limit` consecutive misses. Returns (got, skipped, bytes)."""
    # `code` carries the trailing "ps"; chapters use the stem without it.
    stem = book["code"][:-2] if book["code"].endswith("ps") else book["code"]
    folder = OUT / book["exam"] / f"{book['subject']}_cls{book['klass']:02d}_{stem}"
    got = skipped = total = 0
    misses = 0

    for ch in range(1, max_ch + 1):
        dest = folder / f"{stem}{ch:02d}.pdf"
        if dest.exists() and dest.stat().st_size > 20_000:
            skipped += 1
            total += dest.stat().st_size
            misses = 0
            continue

        time.sleep(pause)
        data = fetch(BASE.format(code=stem, ch=ch), timeout)
        if data is None:
            misses += 1
            if misses >= miss_limit:
                break
            continue

        misses = 0
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        got += 1
        total += len(data)

    return got, skipped, total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exam", choices=["CTET", "NEET", "all"], default="CTET")
    ap.add_argument("--subjects", nargs="*", default=None, help="filter, e.g. Science Mathematics EVS")
    ap.add_argument("--min-class", type=int, default=0)
    ap.add_argument("--pause", type=float, default=0.6)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--max-chapters", type=int, default=20)
    ap.add_argument("--miss-limit", type=int, default=3)
    args = ap.parse_args()

    books = [b for b in json.loads(MANIFEST.read_text(encoding="utf-8"))["books"] if b["ok"]]
    if args.exam != "all":
        books = [b for b in books if b["exam"] == args.exam]
    if args.subjects:
        books = [b for b in books if b["subject"] in args.subjects]
    if args.min_class:
        books = [b for b in books if b["klass"] >= args.min_class]

    print(f"fetching chapters for {len(books)} books\n")
    grand = 0
    for b in books:
        got, skipped, size = book_chapters(
            b, args.pause, args.timeout, args.max_chapters, args.miss_limit
        )
        grand += size
        note = f"{got} new" + (f", {skipped} already had" if skipped else "")
        print(
            f"  {b['subject']:12} cls {b['klass']:>2}  {b['code'][:-2]:8} "
            f"{got + skipped:>3} chapters  {size/1_048_576:>6.1f}MB  ({note})"
        )

    print(f"\ntotal on disk for this run: {grand/1_048_576:.0f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

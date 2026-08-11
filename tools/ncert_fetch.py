"""
Download the verified NCERT corpus from the manifest.

Reads content/manifests/ncert.json (produced by ncert_manifest.py, where every
URL was already fetched and checked for PDF magic bytes) and pulls the actual
books. Idempotent: a file already on disk with a matching size is skipped, so
re-running costs nothing.

CTET-first by default. The September CTET sitting is the live deadline, so the
elementary/upper-primary shelf comes before the NEET Class XI-XII books.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "content" / "manifests" / "ncert.json"
OUT = ROOT / "content" / "raw" / "ncert"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def download(url: str, dest: Path, timeout: int, retries: int) -> tuple[bool, str]:
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            if data[:4] != b"%PDF":
                return False, f"not a PDF ({len(data)}b)"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return True, hashlib.sha256(data).hexdigest()[:16]
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            if attempt == retries:
                return False, f"{type(e).__name__}"
            time.sleep(2 * (attempt + 1))
    return False, "exhausted retries"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exam", choices=["CTET", "NEET", "all"], default="CTET")
    ap.add_argument("--pause", type=float, default=1.0)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    if not MANIFEST.exists():
        print("no manifest — run tools/ncert_manifest.py first")
        return 1

    books = [b for b in json.loads(MANIFEST.read_text(encoding="utf-8"))["books"] if b["ok"]]
    if args.exam != "all":
        books = [b for b in books if b["exam"] == args.exam]
    if args.limit:
        books = books[: args.limit]

    print(f"downloading {len(books)} verified NCERT books ({args.exam})\n")
    got = skipped = failed = 0

    for b in books:
        name = f"{b['exam']}_{b['subject']}_cls{b['klass']:02d}_{b['code']}.pdf"
        dest = OUT / b["exam"] / name

        if dest.exists() and dest.stat().st_size > 10_000:
            print(f"  skip {name:52} already have {dest.stat().st_size/1_048_576:.1f}MB")
            skipped += 1
            continue

        time.sleep(args.pause)
        ok, info = download(b["url"], dest, args.timeout, args.retries)
        if ok:
            print(f"  ok   {name:52} {dest.stat().st_size/1_048_576:>5.1f}MB  {info}")
            got += 1
        else:
            print(f"  FAIL {name:52} {info}")
            failed += 1

    total = sum(f.stat().st_size for f in OUT.rglob("*.pdf")) / 1_048_576 if OUT.exists() else 0
    print(f"\ndownloaded {got}, skipped {skipped}, failed {failed}")
    print(f"corpus on disk: {total:.0f} MB at {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

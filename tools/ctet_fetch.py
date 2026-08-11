"""
CTET paper fetcher.

CBSE publishes CTET question papers from ctet.nic.in/archive, but the files
themselves live on Google Drive as ZIPs — each ZIP holding the paper in up to
19 languages (the bilingual English+Hindi main booklet plus one supplement per
regional language).

This walks the official archive pages, resolves the Drive links, downloads and
unpacks them, and writes a manifest. It is idempotent: files are keyed by
SHA-256, so re-running skips anything already present.

Anything the fetcher cannot reach is reported in a gap list; drop those PDFs
into content/raw/_inbox/ by hand and the parser treats them identically.

Usage:
    python tools/ctet_fetch.py --sessions feb-2026 dec-2024 july-2024
    python tools/ctet_fetch.py --list-only
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import zipfile
from dataclasses import dataclass, asdict
from pathlib import Path

import urllib.request
import urllib.error
import http.cookiejar

ARCHIVE = "https://ctet.nic.in/archive/"
SESSION_URL = "https://ctet.nic.in/question-paper-{session}/"
DRIVE_DL = "https://drive.google.com/uc?export=download&id={id}"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "content" / "raw" / "ctet"
MANIFESTS = ROOT / "content" / "manifests"

# Sessions held within the last five years. CTET was NOT conducted in 2025 —
# the gap is real, not a missing entry.
KNOWN_SESSIONS = [
    "feb-2026",
    "dec-2024",
    "july-2024",
    "january-2024",
    "august-2023",
    "december-2022",
    "december-2021",
]

DRIVE_LINK_RE = re.compile(
    r'<a[^>]+href="https://drive\.google\.com/file/d/([^/"]+)[^"]*"[^>]*>(.*?)</a>',
    re.S | re.I,
)


@dataclass
class PaperFile:
    session: str
    label: str
    drive_id: str
    zip_sha256: str | None = None
    zip_bytes: int | None = None
    members: list[str] | None = None
    error: str | None = None


def _opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = [("User-Agent", UA)]
    return op


def get(url: str, op=None, timeout: int = 180) -> bytes:
    op = op or _opener()
    with op.open(url, timeout=timeout) as r:
        return r.read()


def list_session_files(session: str, op=None) -> list[PaperFile]:
    """Scrape one session page for its Drive-hosted paper ZIPs."""
    src = get(SESSION_URL.format(session=session), op).decode("utf-8", "replace")
    out: list[PaperFile] = []
    seen: set[str] = set()
    for m in DRIVE_LINK_RE.finditer(src):
        drive_id = m.group(1)
        if drive_id in seen:
            continue
        seen.add(drive_id)
        label = re.sub(r"<[^>]+>", "", m.group(2))
        label = re.sub(r"\s+", " ", html.unescape(label)).strip()
        out.append(PaperFile(session=session, label=label or drive_id, drive_id=drive_id))
    return out


def safe_name(label: str) -> str:
    n = re.sub(r"[^A-Za-z0-9._-]+", "_", label).strip("_")
    return n[:80] or "paper"


def download(pf: PaperFile, op, dest_dir: Path, pause: float) -> PaperFile:
    dest_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_name(pf.label)
    if stem.lower().endswith(".zip"):
        stem = stem[:-4]
    zip_path = dest_dir / f"{stem}.zip"
    extract_dir = dest_dir / stem

    try:
        if zip_path.exists():
            data = zip_path.read_bytes()
        else:
            time.sleep(pause)  # be a polite client against Drive
            data = get(DRIVE_DL.format(id=pf.drive_id), op)
            if data[:2] != b"PK":
                head = data[:200].decode("utf-8", "replace")
                pf.error = f"not a zip (got {len(data)}b): {head[:120]!r}"
                return pf
            zip_path.write_bytes(data)

        pf.zip_bytes = len(data)
        pf.zip_sha256 = hashlib.sha256(data).hexdigest()

        with zipfile.ZipFile(zip_path) as z:
            pf.members = [i.filename for i in z.infolist()]
            if not extract_dir.exists():
                z.extractall(extract_dir)
    except (urllib.error.URLError, zipfile.BadZipFile, OSError) as e:
        pf.error = f"{type(e).__name__}: {e}"
    return pf


def main() -> int:
    ap = argparse.ArgumentParser(description="Fetch official CTET papers.")
    ap.add_argument("--sessions", nargs="*", default=["feb-2026", "dec-2024", "july-2024"])
    ap.add_argument("--list-only", action="store_true", help="enumerate without downloading")
    ap.add_argument("--pause", type=float, default=2.0, help="seconds between downloads")
    ap.add_argument("--limit", type=int, default=0, help="max files per session (0 = all)")
    ap.add_argument(
        "--match",
        default=None,
        help="regex over the file label; booklet sets are the same questions "
        "reordered, so one set per sitting is enough for a unique question bank",
    )
    args = ap.parse_args()

    op = _opener()
    all_files: list[PaperFile] = []

    for session in args.sessions:
        if session not in KNOWN_SESSIONS:
            print(f"! unknown session {session!r} (known: {', '.join(KNOWN_SESSIONS)})")
        try:
            files = list_session_files(session, op)
        except Exception as e:
            print(f"! {session}: could not list ({e})")
            continue

        if args.match:
            pat = re.compile(args.match, re.I)
            files = [f for f in files if pat.search(f.label)]
        if args.limit:
            files = files[: args.limit]
        print(f"\n=== {session}: {len(files)} files ===")

        for pf in files:
            if args.list_only:
                print(f"  {pf.drive_id[:18]:20} {pf.label}")
                all_files.append(pf)
                continue

            pf = download(pf, op, RAW / session, args.pause)
            if pf.error:
                print(f"  FAIL {pf.label}: {pf.error[:90]}")
            else:
                pdfs = sum(1 for m in (pf.members or []) if m.lower().endswith(".pdf"))
                print(f"  ok   {pf.label:28} {pf.zip_bytes:>10,}b  {pdfs} PDFs")
            all_files.append(pf)

    MANIFESTS.mkdir(parents=True, exist_ok=True)
    man = MANIFESTS / "ctet.json"
    man.write_text(
        json.dumps([asdict(f) for f in all_files], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    ok = sum(1 for f in all_files if not f.error and not args.list_only)
    bad = [f for f in all_files if f.error]
    print(f"\nmanifest: {man}")
    print(f"downloaded {ok} / {len(all_files)}")
    if bad:
        print(f"gaps ({len(bad)}) — drop these into content/raw/_inbox/ manually:")
        for f in bad:
            print(f"  {f.session} {f.label}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

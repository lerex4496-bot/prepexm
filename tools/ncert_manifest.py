"""
Discover and VERIFY the NCERT textbook corpus, then emit a download manifest.

NCERT encodes each complete-book PDF as
    https://ncert.nic.in/textbook/pdf/<class><medium><subject><part>ps.pdf
e.g. lebo1ps.pdf = class XII (l), English medium (e), Biology (bo), part 1.

The code scheme is regular but NOT uniform: some subjects use two parts, some
one; some codes differ from the obvious abbreviation; and a link that looks
right can still 404. So nothing here is asserted from the pattern alone —
every candidate is fetched and only entries that return a real PDF (magic
bytes checked, not just a 200) enter the manifest. Everything else is reported
as a gap for manual resolution.

Licensing note, recorded deliberately in the manifest itself: NCERT PDFs are
free to download but carry "All Rights Reserved". That is fine for a private
two-student app using them as a reference corpus; it is NOT a licence to
redistribute their text inside a public product.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

BASE = "https://ncert.nic.in/textbook/pdf/{code}.pdf"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "content" / "manifests"

# Windows consoles default to cp1252, which cannot encode Devanagari — printing
# a Hindi book title killed the whole run with a UnicodeEncodeError *after* the
# network work was done. In an app built for a Hindi-medium student, tooling
# that falls over on Hindi is a bug, not a display quirk. Unmappable characters
# degrade to a replacement rather than raising.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

CLASS_CODE = {
    1: "a", 2: "b", 3: "c", 4: "d", 5: "e", 6: "f",
    7: "g", 8: "h", 9: "i", 10: "j", 11: "k", 12: "l",
}
MEDIUM_CODE = {"en": "e", "hi": "h", "ur": "u"}


@dataclass
class Book:
    exam: str          # NEET | CTET | BOTH
    tier: str          # CORE | SUPPLEMENTARY | REFERENCE
    subject: str
    klass: int
    medium: str
    part: int
    code: str
    url: str
    ok: bool = False
    bytes: int = 0
    note: str = ""


# (exam, tier, subject, class, subject-code, parts)
# NEET: only XI+XII Physics/Chemistry/Biology are core — deliberately NOT the
# whole I-XII shelf.
NEET_CORE = [
    ("Biology", 11, "bo", 1), ("Biology", 12, "bo", 1),
    ("Physics", 11, "ph", 2), ("Physics", 12, "ph", 2),
    ("Chemistry", 11, "ch", 2), ("Chemistry", 12, "ch", 2),
]

# CTET is built around the elementary / upper-primary teaching range, so the
# class I-VIII shelf genuinely is the corpus here.
#
# IMPORTANT: NCERT's code is derived from the BOOK TITLE, not the subject, and
# NEP 2020 replaced most primary titles. So "class 6 Maths" is not `femh1` any
# more — it is `fegp1` (Ganita Prakash). Guessing from the subject 404s. These
# codes were each verified by fetching the PDF and checking its magic bytes.
# (medium, subject, class, code, title)
CTET_BOOKS = [
    ("en", "Mathematics", 1, "aejm1ps", "Joyful Mathematics"),
    ("en", "Mathematics", 2, "bejm1ps", "Joyful Mathematics"),
    ("en", "Mathematics", 3, "cemm1ps", "Math Mela"),
    ("en", "Mathematics", 5, "eemh1ps", "Math-Magic"),
    ("en", "Mathematics", 6, "fegp1ps", "Ganita Prakash"),
    ("en", "Mathematics", 7, "gegp1ps", "Ganita Prakash"),
    ("en", "Mathematics", 8, "hemh1ps", "Mathematics"),
    ("en", "EVS", 3, "ceev1ps", "Looking Around"),
    ("en", "EVS", 4, "deev1ps", "Looking Around"),
    ("en", "EVS", 5, "eeev1ps", "Looking Around"),
    ("en", "Science", 6, "fecu1ps", "Curiosity"),
    ("en", "Science", 7, "gecu1ps", "Curiosity"),
    ("en", "Science", 8, "hesc1ps", "Science"),
    ("hi", "Hindi", 1, "ahsr1ps", "Sarangi"),
    ("hi", "Hindi", 2, "bhsr1ps", "Sarangi"),
    ("hi", "Hindi", 6, "fhml1ps", "Malhar"),
    ("hi", "Hindi", 7, "ghml1ps", "Malhar"),
    ("hi", "Hindi", 7, "ghvs1ps", "Vasant"),
    ("en", "English", 1, "aemr1ps", "Mridang"),
    ("en", "English", 2, "bemr1ps", "Mridang"),
    ("en", "English", 3, "cesa1ps", "Santoor"),
    ("en", "English", 5, "eeen1ps", "Marigold"),
    # ── Social Science, classes 6-8 ────────────────────────────────────────
    #
    # The subject CTET Paper II examines as "Social Studies / Social Science",
    # 60 of its 150 marks — and until now the one subject with no textbook in
    # the corpus at all. Every Social Studies answer the tutor gave was
    # therefore ungrounded, and every generated explanation unverifiable.
    #
    # NEP 2020 replaced the old three-book split (Our Pasts / geography /
    # Social and Political Life) with one integrated title, so `hs` and `sp`
    # codes now 404 — probing found no class 6-8 History or Civics book left on
    # the site. The replacement is "Exploring Society: India and Beyond", code
    # `es`, and it exists for all three classes in BOTH media.
    #
    # HINDI MATTERS HERE: she sits the paper in Hindi, so the Hindi editions
    # are the primary source and the English ones the parallel. Every code
    # below was verified by fetching the PDF and confirming chapter files
    # resolve, not inferred from the pattern.
    ("hi", "Social Science", 6, "fhes1ps", "समाज का अध्ययन: भारत और उससे आगे"),
    ("hi", "Social Science", 7, "ghes1ps", "समाज का अध्ययन: भारत और उससे आगे"),
    ("hi", "Social Science", 8, "hhes1ps", "समाज का अध्ययन: भारत और उससे आगे"),
    ("en", "Social Science", 6, "fees1ps", "Exploring Society: India and Beyond"),
    ("en", "Social Science", 7, "gees1ps", "Exploring Society: India and Beyond"),
    ("en", "Social Science", 8, "hees1ps", "Exploring Society: India and Beyond"),
]


def candidates() -> list[Book]:
    books: list[Book] = []

    for subject, klass, subj_code, parts in NEET_CORE:
        for part in range(1, parts + 1):
            code = f"{CLASS_CODE[klass]}{MEDIUM_CODE['en']}{subj_code}{part}ps"
            books.append(Book("NEET", "CORE", subject, klass, "en", part, code,
                              BASE.format(code=code)))

    for medium, subject, klass, code, title in CTET_BOOKS:
        b = Book("CTET", "CORE", subject, klass, medium, 1, code, BASE.format(code=code))
        b.note = title
        books.append(b)

    return books


def verify(b: Book, pause: float, timeout: int) -> Book:
    """Fetch the first bytes and confirm it is genuinely a PDF, not a 200-with-HTML."""
    req = urllib.request.Request(b.url, headers={"User-Agent": UA, "Range": "bytes=0-1023"})
    try:
        time.sleep(pause)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            head = r.read(1024)
            ctype = r.headers.get("Content-Type", "")
            total = r.headers.get("Content-Range", "")
            if head[:4] != b"%PDF":
                b.note = f"not a PDF (content-type {ctype})"
                return b
            b.ok = True
            if "/" in total:
                try:
                    b.bytes = int(total.rsplit("/", 1)[1])
                except ValueError:
                    pass
    except urllib.error.HTTPError as e:
        b.note = f"HTTP {e.code}"
    except Exception as e:  # timeouts, TLS, DNS
        b.note = f"{type(e).__name__}"
    return b


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pause", type=float, default=0.7)
    ap.add_argument("--timeout", type=int, default=45)
    ap.add_argument("--retries", type=int, default=2)
    args = ap.parse_args()

    books = candidates()
    print(f"probing {len(books)} candidate NCERT complete-book PDFs\n")

    for b in books:
        for attempt in range(args.retries + 1):
            verify(b, args.pause, args.timeout)
            if b.ok:
                break
        flag = "ok  " if b.ok else "MISS"
        size = f"{b.bytes/1_048_576:.1f}MB" if b.bytes else "?"
        print(f"  {flag} {b.exam:5} {b.subject:12} cls {b.klass:>2} {b.medium} "
              f"{b.code:10} {size:>8} {b.note}")

    ok = [b for b in books if b.ok]
    gaps = [b for b in books if not b.ok]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "NCERT official textbook PDFs (ncert.nic.in)",
        "licence_note": (
            "NCERT PDFs are free to download but carry 'All Rights Reserved'. "
            "Usable as a private reference corpus for this two-student app. "
            "NOT redistributable inside a public product — a public StudyMate "
            "would need licensed content or official-source links instead."
        ),
        "verified": len(ok),
        "gaps": len(gaps),
        "books": [asdict(b) for b in books],
    }
    (OUT_DIR / "ncert.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    with (OUT_DIR / "ncert.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(asdict(books[0]).keys()))
        w.writeheader()
        for b in books:
            w.writerow(asdict(b))

    total_mb = sum(b.bytes for b in ok) / 1_048_576
    print(f"\nverified {len(ok)} / {len(books)}  (~{total_mb:.0f} MB)")
    if gaps:
        print(f"gaps ({len(gaps)}) — code guess wrong or book not published under that code:")
        for b in gaps:
            print(f"  {b.exam:5} {b.subject:12} cls {b.klass:>2} {b.medium}  {b.code:10} {b.note}")
    print(f"\nmanifest: {OUT_DIR / 'ncert.json'}")
    print(f"          {OUT_DIR / 'ncert.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
Ingest downloaded NCERT PDFs into the searchable corpus.

Same discipline as the question pipeline: nothing is asserted, everything is
measured. A book whose text layer will not extract is reported as a gap rather
than silently contributing empty chunks — the Hindi books in particular may use
legacy fonts, exactly like the CTET papers did, and a corpus full of mojibake
would poison every retrieval.

Run:  python -m app.corpus_ingest            (ingest everything downloaded)
      python -m app.corpus_ingest --probe    (report extractability, write nothing)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pymupdf
from sqlalchemy import delete, func, select, text as sqltext

from .corpus import FTS_SQL, CorpusChunk, chunk_pages
from .db import Base, SessionLocal, engine

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "content" / "raw" / "ncert"

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
# Chapter files live at
#   content/raw/ncert/<EXAM>/<Subject>_cls<NN>_<stem>/<stem><CC>.pdf
# so the metadata comes from the FOLDER, not the filename. The old flat
# `<EXAM>_<Subject>_cls<NN>_<code>ps.pdf` shape was prelims-only and is ignored.
DIR_RE = re.compile(r"^(?P<subject>.+?)_cls(?P<klass>\d{2})_(?P<stem>\w+)$")
CHAPTER_RE_FILE = re.compile(r"^(?P<stem>\w+?)(?P<ch>\d{2})\.pdf$")


def latin_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.isascii()) / len(letters)


def probe(path: Path) -> dict:
    """
    Decide whether a book's text layer is usable BEFORE ingesting it.

    Two failure modes matter. An image-only scan yields almost no characters.
    A legacy-font book yields plenty of characters that are not real script —
    the exact trap the CTET papers set, where Hindi extracted as Latin
    gibberish. Both are caught here rather than discovered in a bad answer.
    """
    doc = pymupdf.open(path)
    pages = min(doc.page_count, 40)
    sample = "".join(doc[i].get_text() for i in range(pages))
    total = doc.page_count
    doc.close()

    chars = len(sample.strip())
    per_page = chars / max(1, pages)
    deva = len(DEVANAGARI.findall(sample))
    expects_hindi = "Hindi" in path.parent.name

    usable = True
    reason = ""
    if per_page < 200:
        usable, reason = False, f"almost no text ({per_page:.0f} chars/page) — likely a scan"
    elif expects_hindi and deva == 0:
        usable, reason = False, "Hindi book with zero Devanagari — legacy font encoding"

    return {
        "pages": total,
        "chars_per_page": round(per_page),
        "devanagari": deva,
        "latin_ratio": round(latin_ratio(sample), 2),
        "usable": usable,
        "reason": reason,
    }


def ingest(path: Path, db, title_lookup: dict[str, str]) -> tuple[int, str]:
    d = DIR_RE.match(path.parent.name)
    f = CHAPTER_RE_FILE.match(path.name)
    if not d or not f:
        return 0, "not a chapter file"

    exam = path.parent.parent.name
    subject = d.group("subject")
    klass = int(d.group("klass"))
    stem = d.group("stem")
    chapter_no = int(f.group("ch"))
    code = f"{stem}{chapter_no:02d}"
    medium = "hi" if len(stem) > 1 and stem[1] == "h" else "en"

    doc = pymupdf.open(path)
    pages = [doc[i].get_text() for i in range(doc.page_count)]
    doc.close()

    chunks = chunk_pages(pages)
    if not chunks:
        return 0, "no chunks produced"

    # Replace this chapter wholesale so re-running never duplicates passages.
    db.execute(delete(CorpusChunk).where(CorpusChunk.book_code == code))

    for c in chunks:
        db.add(
            CorpusChunk(
                exam=exam,
                subject=subject,
                klass=klass,
                book_code=code,
                book_title=title_lookup.get(f"{stem}ps", subject),
                medium=medium,
                page_from=c.page_from,
                page_to=c.page_to,
                chapter=c.chapter or f"Chapter {chapter_no}",
                seq=c.seq,
                content=c.content,
                chars=len(c.content),
            )
        )
    db.commit()
    return len(chunks), ""


def load_titles() -> dict[str, str]:
    import json

    man = ROOT / "content" / "manifests" / "ncert.json"
    if not man.exists():
        return {}
    return {
        b["code"]: (b.get("note") or b["subject"])
        for b in json.loads(man.read_text(encoding="utf-8"))["books"]
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="report extractability, write nothing")
    ap.add_argument("--exam", default=None)
    args = ap.parse_args()

    # Only chapter files; the flat prelims PDFs are skipped by the folder rule.
    pdfs = sorted(p for p in RAW.rglob("*.pdf") if DIR_RE.match(p.parent.name))
    if args.exam:
        pdfs = [p for p in pdfs if p.parent.parent.name == args.exam]
    if not pdfs:
        print(f"no PDFs under {RAW} — run tools/ncert_fetch.py first")
        return 1

    print(f"{'chapter':52} {'pages':>6} {'c/pg':>6} {'deva':>7}  status")
    print("-" * 88)

    usable, gaps = [], []
    for p in pdfs:
        info = probe(p)
        flag = "ok" if info["usable"] else "SKIP"
        print(
            f"{(p.parent.name + '/' + p.name)[:52]:52} {info['pages']:>6} {info['chars_per_page']:>6} "
            f"{info['devanagari']:>7}  {flag} {info['reason']}"
        )
        (usable if info["usable"] else gaps).append(p)

    if args.probe:
        print(f"\nusable {len(usable)} / {len(pdfs)}   (probe only, nothing written)")
        return 0

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        db.execute(sqltext(FTS_SQL))
        db.commit()

        total = 0
        print()
        for p in usable:
            n, err = ingest(p, db, load_titles())
            if err:
                print(f"  ! {p.name}: {err}")
            else:
                print(f"  + {(p.parent.name + '/' + p.name)[:52]:52} {n:>4} chunks")
                total += n

        count = db.scalar(select(func.count(CorpusChunk.id)))
        chars = db.scalar(select(func.sum(CorpusChunk.chars))) or 0

    print(f"\ningested {total} chunks this run; corpus now {count} chunks, {chars/1_000_000:.1f}M chars")
    if gaps:
        print(f"\nskipped {len(gaps)} unusable books (see SKIP above) — these need OCR or font recovery:")
        for g in gaps:
            print(f"  {g.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

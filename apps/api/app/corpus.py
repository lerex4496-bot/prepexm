"""
Reference corpus: NCERT books -> chapters -> chunks -> searchable index.

RETRIEVAL STRATEGY, AND WHY IT STARTS WITHOUT EMBEDDINGS
-------------------------------------------------------
Vector search needs an embedding model, which needs an API key, which is not
set. Rather than block the whole corpus on that, this starts with PostgreSQL
full-text search (tsvector + ts_rank), which needs no key, no model download
and no GPU — and on a curated, well-written textbook corpus it is genuinely
good, because the student's vocabulary and the book's vocabulary largely match.

The schema keeps a `embedding` column reserved so the same chunks gain vector
search later without re-ingesting: add pgvector, backfill embeddings, and the
retrieval function switches to hybrid. Nothing here has to be redone.

PROVENANCE IS NON-NEGOTIABLE
----------------------------
Every chunk records its book, class, subject, page and character offsets. A
tutor answer that cannot say WHICH page of WHICH NCERT book it came from is not
allowed to ship — the whole point of grounding is that she can go and check.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class CorpusChunk(Base):
    """One retrievable passage of an official textbook."""

    __tablename__ = "corpus_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    exam: Mapped[str] = mapped_column(String(8), index=True)      # CTET | NEET
    subject: Mapped[str] = mapped_column(String(64), index=True)
    klass: Mapped[int] = mapped_column(Integer, index=True)
    book_code: Mapped[str] = mapped_column(String(32), index=True)
    book_title: Mapped[str] = mapped_column(String(128))
    medium: Mapped[str] = mapped_column(String(4))                # en | hi

    # Provenance — every field here exists so an answer can be checked.
    page_from: Mapped[int] = mapped_column(Integer)
    page_to: Mapped[int] = mapped_column(Integer)
    chapter: Mapped[str | None] = mapped_column(String(256), nullable=True)
    seq: Mapped[int] = mapped_column(Integer)

    content: Mapped[str] = mapped_column(Text)
    chars: Mapped[int] = mapped_column(Integer)

    # Reserved for pgvector. Left NULL until an embedding key exists; adding it
    # later is a backfill, not a re-ingest.
    embedding_model: Mapped[str | None] = mapped_column(String(64), nullable=True)


Index("idx_corpus_lookup", CorpusChunk.exam, CorpusChunk.subject, CorpusChunk.klass)


# Full-text index. Created separately because SQLAlchemy has no portable
# tsvector expression index, and it must exist before search is any use.
FTS_SQL = """
CREATE INDEX IF NOT EXISTS idx_corpus_fts
  ON corpus_chunks
  USING GIN (to_tsvector('english', content));
"""


@dataclass
class Chunk:
    content: str
    page_from: int
    page_to: int
    chapter: str | None
    seq: int


# NCERT chapter headings: "Chapter 3", "CHAPTER 12", sometimes with the title
# on the same line.
CHAPTER_RE = re.compile(r"^\s*(?:CHAPTER|Chapter)\s+(\d{1,2})\b[^\n]{0,80}", re.M)

# Page furniture that adds noise to every chunk and helps no retrieval.
NOISE = [
    re.compile(r"Reprint\s*20\d\d[-–]\d\d", re.I),
    re.compile(r"^\s*\d{1,3}\s*$", re.M),          # bare page numbers
    re.compile(r"Rationalised\s+20\d\d[-–]\d\d", re.I),
]


def clean_page(text_: str) -> str:
    for rx in NOISE:
        text_ = rx.sub(" ", text_)
    text_ = re.sub(r"[ \t]+", " ", text_)
    text_ = re.sub(r"\n{3,}", "\n\n", text_)
    return text_.strip()


def chunk_pages(
    pages: list[str],
    *,
    target_chars: int = 1400,
    overlap_chars: int = 200,
) -> list[Chunk]:
    """
    Split a book into overlapping passages that respect page and paragraph
    boundaries.

    Overlap matters: a definition split across a chunk boundary is invisible to
    retrieval otherwise, and definitions are exactly what a student searches
    for. Paragraph-aware splitting keeps passages readable, because these are
    shown to her verbatim as a citation, not just fed to a model.
    """
    chunks: list[Chunk] = []
    buf: list[str] = []
    buf_len = 0
    start_page = 0
    chapter: str | None = None
    seq = 0

    def flush(end_page: int) -> None:
        nonlocal buf, buf_len, start_page, seq
        body = "\n".join(buf).strip()
        if len(body) < 200:  # too short to be a useful citation
            buf, buf_len = [], 0
            return
        chunks.append(
            Chunk(content=body, page_from=start_page + 1, page_to=end_page + 1,
                  chapter=chapter, seq=seq)
        )
        seq += 1
        # Carry a tail forward so the next chunk overlaps this one.
        tail = body[-overlap_chars:] if overlap_chars else ""
        buf = [tail] if tail else []
        buf_len = len(tail)
        start_page = end_page

    for pno, raw in enumerate(pages):
        page = clean_page(raw)
        if not page:
            continue

        m = CHAPTER_RE.search(page)
        if m:
            if buf_len:
                flush(pno)
            chapter = re.sub(r"\s+", " ", m.group(0)).strip()
            start_page = pno

        for para in re.split(r"\n\s*\n", page):
            para = para.strip()
            if not para:
                continue
            if buf_len + len(para) > target_chars and buf_len:
                flush(pno)
            buf.append(para)
            buf_len += len(para)

    if buf_len:
        flush(len(pages) - 1)
    return chunks


SEARCH_SQL = text(
    """
    SELECT id, exam, subject, klass, book_title, book_code, chapter,
           page_from, page_to, content,
           ts_rank(to_tsvector('english', content),
                   websearch_to_tsquery('english', :q)) AS rank
      FROM corpus_chunks
     WHERE to_tsvector('english', content) @@ websearch_to_tsquery('english', :q)
       -- Explicit casts: Postgres cannot infer a bare NULL parameter's type,
       -- and these filters are optional, so they are NULL most of the time.
       AND (CAST(:exam AS text) IS NULL OR exam = CAST(:exam AS text))
       AND (CAST(:subject AS text) IS NULL OR subject = CAST(:subject AS text))
     ORDER BY rank DESC
     LIMIT :limit
    """
)


# `websearch_to_tsquery` ANDs every term, which is right for a two-word query
# and fatal for a longer one: "cell structure function explanation" matched
# ZERO chunks while "cell" alone matched 63. Any question phrased as a sentence
# — or any query produced by translating one — retrieved nothing and was
# refused as ungrounded, while the corpus held the answer the whole time.
#
# This ORs the terms and lets ts_rank do the work. A chunk containing all four
# terms still outranks one containing a single term, so precision comes from
# the ORDER rather than from an all-or-nothing filter.
SEARCH_ANY_SQL = text(
    """
    SELECT id, exam, subject, klass, book_title, book_code, chapter,
           page_from, page_to, content,
           ts_rank(to_tsvector('english', content), to_tsquery('english', :q)) AS rank
      FROM corpus_chunks
     WHERE to_tsvector('english', content) @@ to_tsquery('english', :q)
       AND (CAST(:exam AS text) IS NULL OR exam = CAST(:exam AS text))
       AND (CAST(:subject AS text) IS NULL OR subject = CAST(:subject AS text))
     ORDER BY rank DESC
     LIMIT :limit
    """
)


def or_tsquery(terms: str) -> str:
    """
    Build a safe OR tsquery from free text.

    `to_tsquery` takes operator syntax rather than plain words, so anything the
    user (or a translation) produced has to be reduced to bare alphanumeric
    tokens first — a stray ':' or '&' is a syntax error that would surface as a
    500 rather than as no results.
    """
    import re as _re

    tokens = _re.findall(r"[A-Za-z0-9]+", terms or "")
    # Deduplicate while keeping order, and cap it. Models asked for keywords
    # sometimes repeat themselves or trail into scaffolding tokens; past about
    # eight terms the extra ones only add noise to the ranking.
    seen: set[str] = set()
    kept: list[str] = []
    for t in tokens:
        low = t.lower()
        if len(low) < 3 or low in seen:
            continue
        seen.add(low)
        kept.append(low)
        if len(kept) >= 8:
            break
    return " | ".join(kept)

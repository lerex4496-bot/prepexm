"""
Uploading her own notes, and searching them alongside the textbooks.

WHY UPLOADED DOCUMENTS ARE KEPT APART FROM NCERT
------------------------------------------------
The tutor's whole claim is that an answer can be traced to a page of an
official textbook. That claim survives exactly as long as a citation means one
specific thing. The moment a PDF someone messaged her can be cited under the
same badge, "[2] Class 7 Science, page 41" and "[2] coaching notes someone
typed" look identical, and she has no way to tell which one she is revising
from.

So: separate table, separate retrieval, separate label. Her documents are
searched and cited, and they are always marked as hers.

WHY A SCANNED PDF IS REFUSED
----------------------------
A photographed or scanned handout has no text layer. PyMuPDF returns empty
strings for every page, chunking produces nothing, and the upload "succeeds"
with a document that can never match a query — the failure surfaces days later
as "why does it never use my notes?". Extractability is measured at upload and
a document that yields almost no text is rejected then and there, with the
reason, and pointed at the photo path instead.
"""

from __future__ import annotations

import hashlib
import io
import re

import pymupdf
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .corpus import chunk_pages
from .models import UserDocChunk, UserDocument

#: Below this share of pages yielding real text, the document is a scan.
MIN_EXTRACTABILITY = 0.35

#: A page needs more than a header and a page number to count as extracted.
_MIN_PAGE_CHARS = 120


class UploadRejected(ValueError):
    """The document cannot be used, with a reason the student can act on."""


def _page_texts(data: bytes) -> list[str]:
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        return [doc[i].get_text() or "" for i in range(doc.page_count)]
    finally:
        doc.close()


def extractability(pages: list[str]) -> float:
    if not pages:
        return 0.0
    usable = sum(1 for p in pages if len(p.strip()) >= _MIN_PAGE_CHARS)
    return usable / len(pages)


def ingest_pdf(db: Session, *, data: bytes, filename: str, title: str | None = None,
               exam: str | None = None) -> UserDocument:
    """
    Store an uploaded PDF as searchable chunks.

    Re-uploading the same file returns the existing document rather than a
    duplicate: she will do this, and two copies of a document means the same
    passage cited twice as if it were corroboration.
    """
    digest = hashlib.sha256(data).hexdigest()
    existing = db.scalar(select(UserDocument).where(UserDocument.sha256 == digest))
    if existing:
        return existing

    try:
        pages = _page_texts(data)
    except Exception as e:  # pymupdf raises a variety of things on bad input
        raise UploadRejected(f"could not open this as a PDF ({type(e).__name__})") from e

    if not pages:
        raise UploadRejected("this PDF has no pages")

    ratio = extractability(pages)
    if ratio < MIN_EXTRACTABILITY:
        raise UploadRejected(
            f"only {ratio:.0%} of pages have selectable text — this looks like a scan or "
            f"photographs. Nothing could be searched from it. Use the camera option to "
            f"ask about a specific page instead."
        )

    chunks = chunk_pages(pages)
    if not chunks:
        raise UploadRejected("no readable text could be extracted")

    doc = UserDocument(
        title=(title or re.sub(r"\.pdf$", "", filename, flags=re.I))[:200],
        filename=filename[:255],
        kind="pdf",
        exam=exam,
        pages=len(pages),
        chars=sum(len(c.content) for c in chunks),
        extractability=round(ratio, 3),
        sha256=digest,
    )
    db.add(doc)
    db.flush()

    for i, c in enumerate(chunks):
        db.add(
            UserDocChunk(
                document_id=doc.id,
                seq=i,
                page_from=c.page_from,
                page_to=c.page_to,
                content=c.content,
                chars=len(c.content),
            )
        )
    db.commit()
    db.refresh(doc)
    return doc


# Mirrors the NCERT search so ranking behaves the same way across both sources.
SEARCH_DOCS_SQL = text(
    """
    SELECT c.id, c.document_id, c.page_from, c.page_to, c.content,
           d.title, d.filename,
           ts_rank(to_tsvector('english', c.content),
                   websearch_to_tsquery('english', :q)) AS rank
      FROM user_doc_chunks c
      JOIN user_documents d ON d.id = c.document_id
     WHERE to_tsvector('english', c.content) @@ websearch_to_tsquery('english', :q)
     ORDER BY rank DESC
     LIMIT :limit
    """
)

SEARCH_DOCS_ANY_SQL = text(
    """
    SELECT c.id, c.document_id, c.page_from, c.page_to, c.content,
           d.title, d.filename,
           ts_rank(to_tsvector('english', c.content), to_tsquery('english', :q)) AS rank
      FROM user_doc_chunks c
      JOIN user_documents d ON d.id = c.document_id
     WHERE to_tsvector('english', c.content) @@ to_tsquery('english', :q)
     ORDER BY rank DESC
     LIMIT :limit
    """
)


def public_document(d: UserDocument) -> dict:
    return {
        "id": d.id,
        "title": d.title,
        "filename": d.filename,
        "pages": d.pages,
        "chars": d.chars,
        "extractability": d.extractability,
        "chunks": len(d.chunks),
        "uploadedAt": d.created_at.isoformat() if d.created_at else None,
    }

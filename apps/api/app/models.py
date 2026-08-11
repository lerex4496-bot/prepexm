"""
Authoring-plane schema.

The boundary this enforces:

    SOURCE -> EXTRACT -> VALIDATE -> HUMAN REVIEW -> APPROVED -> APP

`review_status` is the gate. The export that builds the app's SQLite bundle
filters on `approved` in the query itself, so nothing can reach a student
straight from the parser, an OCR pass, a converter or an LLM.

Every question carries its full provenance chain: which PDF, which page, which
bounding box, how the text was obtained, what the official key said, and the
complete audit history of any human edit.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


REVIEW_PENDING = "pending"
REVIEW_APPROVED = "approved"
REVIEW_REJECTED = "rejected"

EXTRACTION_METHODS = (
    "EXACT",
    "CONVERTED",
    "OCR_HIGH_CONFIDENCE",
    "OCR_LOW_CONFIDENCE",
    "TRANSLATED_FALLBACK",
)


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    exam_code: Mapped[str] = mapped_column(String(16))
    paper_type: Mapped[str] = mapped_column(String(32))
    session_label: Mapped[str] = mapped_column(String(64))
    held_on: Mapped[str] = mapped_column(String(16))
    set_code: Mapped[str] = mapped_column(String(8))

    source_pdf: Mapped[str] = mapped_column(Text)
    key_pdf: Mapped[str] = mapped_column(Text)
    key_legend_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    total_questions: Mapped[int] = mapped_column(Integer, default=0)
    duration_min: Mapped[int] = mapped_column(Integer, default=150)
    source_type: Mapped[str] = mapped_column(String(24), default="PYQ")
    review_status: Mapped[str] = mapped_column(String(16), default=REVIEW_PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    questions: Mapped[list["Question"]] = relationship(
        back_populates="paper", cascade="all, delete-orphan"
    )


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (UniqueConstraint("paper_id", "number", name="uq_paper_number"),)

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[str] = mapped_column(String(48))
    number: Mapped[int] = mapped_column(Integer, index=True)

    part: Mapped[str | None] = mapped_column(String(8), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(128), nullable=True)

    stem_en: Mapped[str] = mapped_column(Text, default="")
    stem_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Reading material shared by a comprehension block, copied onto every
    # question in it. Without this a stem like "What did the cricket do in
    # summer ?" is unanswerable from the record, and anything that tried to
    # explain it was recalling the source text rather than reading it.
    passage_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    passage_hi: Mapped[str | None] = mapped_column(Text, nullable=True)

    # How each language's text was obtained. NULL = not extracted yet.
    extraction_en: Mapped[str | None] = mapped_column(String(24), nullable=True)
    extraction_hi: Mapped[str | None] = mapped_column(String(24), nullable=True)

    # Traceability back to the exact pixels on the exact page.
    source_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hindi_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hindi_bbox: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Official answer key, verbatim, plus its decoded meaning.
    key_raw: Mapped[str | None] = mapped_column(String(4), nullable=True)
    multi_key: Mapped[bool] = mapped_column(Boolean, default=False)
    # 'ok' | 'bonus' — bonus means the key accepted every option.
    status: Mapped[str] = mapped_column(String(16), default="ok")

    topic_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    difficulty: Mapped[str] = mapped_column(String(16), default="medium")
    explanation_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    explanation_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Gujarati is the NEET student's medium. The two-stage pipeline renders it
    # from the same stage-1 reasoning as Hindi, so it is a column, not a
    # translation performed at read time.
    explanation_gu: Mapped[str | None] = mapped_column(Text, nullable=True)

    source_type: Mapped[str] = mapped_column(String(24), default="PYQ")
    provenance: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    warnings: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Lower = needs a human sooner. Drives the review queue ordering.
    confidence: Mapped[float] = mapped_column(Float, default=1.0)

    review_status: Mapped[str] = mapped_column(String(16), default=REVIEW_PENDING, index=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    paper: Mapped[Paper] = relationship(back_populates="questions")
    options: Mapped[list["Option"]] = relationship(
        back_populates="question", cascade="all, delete-orphan", order_by="Option.label"
    )
    audits: Mapped[list["Audit"]] = relationship(
        back_populates="question", cascade="all, delete-orphan", order_by="Audit.at.desc()"
    )


class Option(Base):
    __tablename__ = "options"
    __table_args__ = (UniqueConstraint("question_id", "label", name="uq_question_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(2))
    text_en: Mapped[str] = mapped_column(Text, default="")
    text_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)

    question: Mapped[Question] = relationship(back_populates="options")


class Audit(Base):
    """
    Append-only history. Every edit, approval and rejection lands here with the
    previous value, so an approved question can always be traced back to what
    the parser originally produced.
    """

    __tablename__ = "audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(String(24))
    field: Mapped[str | None] = mapped_column(String(64), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Holds the full generation chain for LLM-written fields, not just a name.
    actor: Mapped[str] = mapped_column(String(200), default="reviewer")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    question: Mapped[Question] = relationship(back_populates="audits")


class Provider(Base):
    """
    A model endpoint the server may call, and what it is allowed to be used for.

    WHY THIS IS A TABLE AND NOT A DICT IN llm.py
    --------------------------------------------
    Providers were a hardcoded dict keyed to fixed environment variables. Every
    change — a dead key, a deprecated model, a better endpoint — meant editing
    Python and restarting the service. We hit that three times in one week while
    Sarvam deprecated two models underneath us (sarvam-m, then sarvam-30b), and
    each time the app was silently unable to explain anything until someone
    noticed.

    That is the wrong failure mode for software two students depend on and
    neither can debug. A row in a table is a form field in the review tool.

    ON ROLES
    --------
    Routing is by ROLE, not by name, because the jobs are genuinely different
    and the best model differs per job:

      REASON    work out WHY the official answer is right (English, structured)
      LOCALISE  render that reasoning into Hindi/Gujarati — adds no facts
      VISION    read a photographed question
      CHAT      the tutor
      EMBED     vector search, if we ever move off Postgres full-text

    `priority` orders candidates within a role; the first configured, enabled
    one wins, and the rest are fallbacks. Nothing is pinned to a single vendor.

    ON KEYS
    -------
    A key may live in `api_key` (stored here) or be named by `api_key_env` (kept
    in .env and never in the database). Both are supported because the second is
    safer and the first is what makes the tool usable without shell access.

    Either way the key is NEVER serialised back out — the API returns a masked
    hint and a boolean. A settings screen that shows you your own secret is a
    settings screen that leaks it into a screenshot.
    """

    __tablename__ = "providers"
    __table_args__ = (UniqueConstraint("name", "role", name="uq_provider_name_role"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(16), index=True)
    base_url: Mapped[str] = mapped_column(String(255))
    model: Mapped[str] = mapped_column(String(128))

    # Exactly one of these is normally set. api_key_env wins when both are.
    api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_env: Mapped[str | None] = mapped_column(String(64), nullable=True)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Lower runs first. Ties break on id, so seeding order is stable.
    priority: Mapped[int] = mapped_column(Integer, default=100)

    # Reasoning models need far more headroom than a rendering pass: they spend
    # tokens thinking before `content` is filled at all, and running out mid
    # -thought returns a null answer rather than an error.
    max_tokens: Mapped[int] = mapped_column(Integer, default=700)
    temperature: Mapped[float] = mapped_column(Float, default=0.2)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Written by the health check, so the tool can show what actually works
    # rather than what is merely configured.
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class GlossaryTerm(Base):
    """
    A term whose translation is FIXED across the whole app.

    WHY THIS IS NOT LEFT TO THE MODEL
    ---------------------------------
    Asked to render "cell" into Gujarati twice, a model may produce
    કોષ once and કોષિકા the next time. Both are defensible; the drift is the
    problem. A student meeting two words for one concept across two screens has
    to work out whether they are the same thing, and that is cognitive load
    spent on our inconsistency rather than on biology.

    So the mapping is data, injected into the stage-2 prompt, and the same
    English term renders identically everywhere.
    """

    __tablename__ = "glossary_terms"
    __table_args__ = (UniqueConstraint("term_en", name="uq_glossary_term_en"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    term_en: Mapped[str] = mapped_column(String(120), index=True)
    term_hi: Mapped[str | None] = mapped_column(String(160), nullable=True)
    term_gu: Mapped[str | None] = mapped_column(String(160), nullable=True)
    #: Which exam this matters for, or NULL for both.
    exam_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ExplanationRun(Base):
    """
    One pass of the two-stage pipeline, kept in full.

    WHY WE STORE THE INTERMEDIATE
    -----------------------------
    The claim the two-stage design makes is "stage 2 adds no facts". That is
    only a claim unless stage 1's output is retained and comparable — otherwise
    nobody, including us, can check it after the fact. With both halves stored,
    the check is mechanical and repeatable, and a reviewer looking at an odd
    Hindi sentence can see exactly what English it was rendering.

    It also makes a bad batch reversible: if a stage-1 prompt turns out to be
    weak, the runs it produced are identifiable rather than mixed anonymously
    into the question bank.
    """

    __tablename__ = "explanation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True
    )
    lang: Mapped[str] = mapped_column(String(4))

    #: Stage 1: structured English reasoning, as returned.
    stage1_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    stage1_provider: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stage1_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    #: Stage 2: the rendered text actually written onto the question.
    stage2_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage2_provider: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stage2_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    #: 'two_stage' | 'single_stage' — single means a role fell back and the
    #: reason-then-render separation did NOT happen. Never inferred later.
    mode: Mapped[str] = mapped_column(String(16), default="two_stage")

    #: Mechanical checks run on stage 2 against stage 1.
    verification: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UserDocument(Base):
    """
    Something the student uploaded herself — coaching notes, a handout, a PDF a
    teacher shared.

    WHY THIS IS A SEPARATE TABLE FROM corpus_chunks
    -----------------------------------------------
    `corpus_chunks` holds NCERT: official textbooks, the same for everyone,
    vetted before ingest. This holds whatever she happened to upload, which
    could be anything — a good set of notes, a competitor's guide, or something
    with an error in it.

    Mixing the two would destroy the one property that makes the tutor
    trustworthy: that a citation means "this is in your official textbook, page
    41". Once her own PDF can appear under the same badge, that sentence stops
    being true and there is no way for her to tell which kind of source she is
    looking at. So they are separate tables, retrieved separately, and cited
    with different labels.
    """

    __tablename__ = "user_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str] = mapped_column(String(255))
    #: 'pdf' | 'text'
    kind: Mapped[str] = mapped_column(String(8), default="pdf")
    exam: Mapped[str | None] = mapped_column(String(8), nullable=True)
    pages: Mapped[int] = mapped_column(Integer, default=0)
    chars: Mapped[int] = mapped_column(Integer, default=0)
    #: Fraction of pages that yielded usable text. A scanned handout is ~0 and
    #: is rejected rather than stored as a document full of empty chunks.
    extractability: Mapped[float] = mapped_column(Float, default=0.0)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    chunks: Mapped[list["UserDocChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class UserDocChunk(Base):
    """One retrievable passage of an uploaded document."""

    __tablename__ = "user_doc_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("user_documents.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    page_from: Mapped[int] = mapped_column(Integer)
    page_to: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    chars: Mapped[int] = mapped_column(Integer)

    document: Mapped[UserDocument] = relationship(back_populates="chunks")


class Account(Base):
    """
    An optional login, used only to carry progress across a reinstall or a new
    phone.

    It holds no personal data beyond a username of her choosing. No email, no
    phone number, no name — none of it is needed to restore a study history,
    and asking for it would mean holding data we would then have to protect.
    """

    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("username", name="uq_account_username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), index=True)
    #: scrypt, with its parameters stored alongside. Never reversible.
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    snapshot: Mapped["ProgressSnapshot | None"] = relationship(
        back_populates="account", cascade="all, delete-orphan", uselist=False
    )


class ProgressSnapshot(Base):
    """
    The whole of one student's study history, as a single document.

    WHY ONE ROW AND NOT NORMALISED TABLES
    -------------------------------------
    The server never reasons about this data — it does not score it, rank it or
    query inside it. It stores it and gives it back. Modelling attempts,
    responses and mistakes as server tables would duplicate the entire device
    schema, and every future change to the local database would need a matching
    migration here to avoid silently dropping fields on restore.

    A document has the opposite property: a column added on the device round
    -trips without the server knowing it exists.
    """

    __tablename__ = "progress_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True, unique=True
    )
    payload: Mapped[dict] = mapped_column(JSON, default=dict)

    # Counts, so the app can warn before overwriting a bigger snapshot with a
    # smaller one — the shape of "I signed in on a fresh install and wiped my
    # own history".
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    responses: Mapped[int] = mapped_column(Integer, default=0)
    mistakes: Mapped[int] = mapped_column(Integer, default=0)
    #: Which device pushed last, so a second device can say so before replacing.
    device: Mapped[str | None] = mapped_column(String(120), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    account: Mapped[Account] = relationship(back_populates="snapshot")

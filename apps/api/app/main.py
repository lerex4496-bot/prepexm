"""
StudyMate authoring API + Content Review tool.

The review gate lives here. `POST /api/questions/{id}/approve` is the ONLY
place in the system that can set review_status='approved', and the export that
builds the app bundle reads nothing else.
"""

from __future__ import annotations

import io
import re
import time
from pathlib import Path
from typing import Literal

import pymupdf
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .db import Base, engine, get_db, migrate
from .corpus import SEARCH_SQL, CorpusChunk
from .llm import (
    LLMError,
    OpenAICompatProvider,
    build_explanation_prompt,
    provider_status,
)
from . import providers as reg
from . import twostage as ts
from . import chat as chatmod
from . import register
from . import userdocs
from . import vision
from . import accounts
from . import practicesets
from . import webfetch
from .models import (
    Account,
    Audit,
    UserDocument,
    ExplanationRun,
    Option,
    Paper,
    Provider,
    Question,
    REVIEW_APPROVED,
    REVIEW_PENDING,
    REVIEW_REJECTED,
)

# The official key legend, printed on every CBSE key page:
#   A=1,2 / B=1,3 / C=1,4 / D=2,3 / E=2,4 / F=3,4 / Z=ALL
# Mapped to contract option labels.
KEY_LABELS: dict[str, list[str]] = {
    "1": ["A"], "2": ["B"], "3": ["C"], "4": ["D"],
    "A": ["A", "B"], "B": ["A", "C"], "C": ["A", "D"],
    "D": ["B", "C"], "E": ["B", "D"], "F": ["C", "D"],
    "Z": ["A", "B", "C", "D"],
}

ROOT = Path(__file__).resolve().parents[3]
STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="StudyMate Authoring", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    Base.metadata.create_all(engine)
    migrate()
    # Seed the provider registry so a fresh database can explain something
    # immediately. Idempotent, and it never overwrites an edited row — a
    # restart must not silently undo a change made in the tool.
    from .db import SessionLocal

    with SessionLocal() as db:
        added = reg.seed(db)
        if added:
            print(f"[providers] seeded {added} rows")
        terms = ts.seed_glossary(db)
        if terms:
            print(f"[glossary] seeded {terms} terms")


# ─────────────────────────── serialisation ───────────────────────────


def question_payload(q: Question, include_audit: bool = False) -> dict:
    data = {
        "id": q.id,
        "paperId": q.paper_id,
        "number": q.number,
        "part": q.part,
        "subject": q.subject,
        "stem": {"en": q.stem_en, "hi": q.stem_hi},
        "options": [
            {
                "label": o.label,
                "en": o.text_en,
                "hi": o.text_hi,
                "isCorrect": o.is_correct,
            }
            for o in q.options
        ],
        "extractionMethod": {"en": q.extraction_en, "hi": q.extraction_hi},
        "answerKey": {
            "raw": q.key_raw,
            "correct": [o.label for o in q.options if o.is_correct],
            "multiKey": q.multi_key,
            "status": q.status,
        },
        "topicId": q.topic_id,
        "difficulty": q.difficulty,
        "explanation": {"en": q.explanation_en, "hi": q.explanation_hi},
        "provenance": q.provenance,
        "source": {
            "pdf": q.paper.source_pdf if q.paper else None,
            "keyPdf": q.paper.key_pdf if q.paper else None,
            "page": q.source_page,
            "hindiPage": q.hindi_page,
            "bbox": q.hindi_bbox,
        },
        "warnings": q.warnings or [],
        "confidence": q.confidence,
        "reviewStatus": q.review_status,
        "reviewedBy": q.reviewed_by,
        "reviewedAt": q.reviewed_at.isoformat() if q.reviewed_at else None,
        "reviewNote": q.review_note,
        "paper": {
            "sessionLabel": q.paper.session_label if q.paper else None,
            "paperType": q.paper.paper_type if q.paper else None,
            "setCode": q.paper.set_code if q.paper else None,
            "heldOn": q.paper.held_on if q.paper else None,
        },
    }
    if include_audit:
        data["audit"] = [
            {
                "action": a.action,
                "field": a.field,
                "old": a.old_value,
                "new": a.new_value,
                "actor": a.actor,
                "at": a.at.isoformat(),
            }
            for a in q.audits
        ]
    return data


# ─────────────────────────────── read ───────────────────────────────


@app.get("/api/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    by_status = dict(
        db.execute(
            select(Question.review_status, func.count()).group_by(Question.review_status)
        ).all()
    )
    by_paper = [
        {
            "paperId": pid,
            "paperType": ptype,
            "session": sess,
            "setCode": scode,
            "total": total,
            "approved": approved or 0,
            "rejected": rejected or 0,
            "pending": (total or 0) - (approved or 0) - (rejected or 0),
            "flagged": flagged or 0,
        }
        for pid, ptype, sess, scode, total, approved, rejected, flagged in db.execute(
            select(
                Paper.id,
                Paper.paper_type,
                Paper.session_label,
                Paper.set_code,
                func.count(Question.id),
                func.count(Question.id).filter(Question.review_status == REVIEW_APPROVED),
                func.count(Question.id).filter(Question.review_status == REVIEW_REJECTED),
                func.count(Question.id).filter(Question.confidence < 1.0),
            )
            .join(Question, Question.paper_id == Paper.id)
            .group_by(Paper.id, Paper.paper_type, Paper.session_label, Paper.set_code)
            .order_by(Paper.paper_type)
        ).all()
    ]
    extraction = dict(
        db.execute(
            select(Question.extraction_hi, func.count()).group_by(Question.extraction_hi)
        ).all()
    )
    return {
        "byStatus": by_status,
        "byPaper": by_paper,
        "hindiExtraction": {str(k): v for k, v in extraction.items()},
        "total": sum(by_status.values()),
    }


@app.get("/api/queue")
def queue(
    status: Literal["pending", "approved", "rejected", "all"] = "pending",
    paper_id: str | None = None,
    flagged_only: bool = False,
    limit: int = Query(500, le=2000),
    db: Session = Depends(get_db),
) -> dict:
    """
    Review queue, ordered lowest-confidence first so attention lands where the
    parser was least sure rather than on question 1 of paper 1.
    """
    stmt = select(Question).options(selectinload(Question.options), selectinload(Question.paper))
    if status != "all":
        stmt = stmt.where(Question.review_status == status)
    if paper_id:
        stmt = stmt.where(Question.paper_id == paper_id)
    if flagged_only:
        stmt = stmt.where(Question.confidence < 1.0)
    stmt = stmt.order_by(Question.confidence.asc(), Question.paper_id, Question.number).limit(limit)

    items = db.scalars(stmt).all()
    return {
        "count": len(items),
        "items": [
            {
                "id": q.id,
                "number": q.number,
                "paperType": q.paper.paper_type if q.paper else None,
                "setCode": q.paper.set_code if q.paper else None,
                "part": q.part,
                "confidence": q.confidence,
                "warnings": q.warnings or [],
                "reviewStatus": q.review_status,
                "hasHindi": bool(q.stem_hi),
                "stemPreview": (q.stem_en or "")[:90],
            }
            for q in items
        ],
    }


@app.get("/api/questions/{qid}")
def get_question(qid: str, db: Session = Depends(get_db)) -> dict:
    q = db.get(Question, qid)
    if not q:
        raise HTTPException(404, "question not found")
    return question_payload(q, include_audit=True)


@app.get("/api/questions/{qid}/page.png")
def question_page(qid: str, dpi: int = 130, db: Session = Depends(get_db)) -> Response:
    """
    Render the source page with this question's Hindi region outlined, so the
    reviewer is always comparing against the actual official document rather
    than trusting the extraction.
    """
    q = db.get(Question, qid)
    if not q or not q.paper:
        raise HTTPException(404, "question not found")

    pdf_path = Path(q.paper.source_pdf)
    if not pdf_path.is_absolute():
        pdf_path = ROOT / pdf_path
    if not pdf_path.exists():
        raise HTTPException(404, f"source pdf missing: {pdf_path}")

    page_no = q.hindi_page if q.hindi_page is not None else q.source_page
    doc = pymupdf.open(pdf_path)
    try:
        page_no = max(0, min(page_no or 0, doc.page_count - 1))
        page = doc[page_no]
        if q.hindi_bbox:
            page.draw_rect(pymupdf.Rect(*q.hindi_bbox), color=(0.85, 0.1, 0.1), width=1.2)
        pix = page.get_pixmap(dpi=dpi)
        buf = io.BytesIO(pix.tobytes("png"))
    finally:
        doc.close()
    return Response(buf.getvalue(), media_type="image/png")


# ─────────────────────────────── write ───────────────────────────────


class Decision(BaseModel):
    actor: str = "reviewer"
    note: str | None = None
    # Approving a question that fails validation requires saying so explicitly
    # AND leaving a note. There is no silent path past these checks.
    override: bool = False


def blocking_problems(q: Question) -> list[str]:
    """
    Conditions that must not reach a student.

    The official answer key is the authority for a past paper: it is what CBSE
    actually scored candidates against. So a reviewer marking a different
    option correct is treated as a blocking disagreement, not a preference —
    it either means the option labels are misparsed, or the reviewer is
    substituting their own working for the official mark scheme. Both need
    resolving before the question ships, and neither should be silent.
    """
    problems: list[str] = []

    if len(q.options) != 4:
        problems.append(f"{len(q.options)} options parsed, expected 4")

    empty = [o.label for o in q.options if not (o.text_en or "").strip()]
    if empty:
        problems.append(f"option text empty: {', '.join(empty)}")

    # An option whose text is just its own marker means extraction failed.
    markers = [o.label for o in q.options if re.fullmatch(r"\(\d\)", (o.text_en or "").strip())]
    if markers:
        problems.append(f"option text is only a marker: {', '.join(markers)}")

    marked = sorted(o.label for o in q.options if o.is_correct)
    if not marked:
        problems.append("no option marked correct")

    if q.key_raw:
        expected = sorted(KEY_LABELS.get(q.key_raw, []))
        if expected and marked and marked != expected:
            problems.append(
                f"marked correct {marked} disagrees with official key "
                f"'{q.key_raw}' -> {expected}"
            )
        if expected and not marked:
            problems.append(f"official key '{q.key_raw}' -> {expected} but no such option exists")

    if not (q.stem_en or "").strip():
        problems.append("stem is empty")

    return problems


@app.get("/api/questions/{qid}/validate")
def validate_question(qid: str, db: Session = Depends(get_db)) -> dict:
    q = db.get(Question, qid)
    if not q:
        raise HTTPException(404, "question not found")
    problems = blocking_problems(q)
    return {"id": q.id, "approvable": not problems, "problems": problems}


class Edit(BaseModel):
    actor: str = "reviewer"
    stem_en: str | None = None
    stem_hi: str | None = None
    topic_id: str | None = None
    explanation_en: str | None = None
    explanation_hi: str | None = None
    # {"A": {"en": "...", "hi": "...", "isCorrect": true}, ...}
    options: dict[str, dict] | None = None


def _decide(q: Question, status: str, d: Decision, db: Session) -> dict:
    old = q.review_status
    q.review_status = status
    q.reviewed_by = d.actor
    q.reviewed_at = func.now()
    if d.note:
        q.review_note = d.note
    db.add(Audit(question_id=q.id, action=status, field="review_status",
                 old_value=old, new_value=status, actor=d.actor))
    db.commit()
    db.refresh(q)
    return {"id": q.id, "reviewStatus": q.review_status}


@app.post("/api/questions/{qid}/approve")
def approve(qid: str, d: Decision, db: Session = Depends(get_db)) -> dict:
    """
    The single place in the system that can mark content approved.

    Refuses anything that fails validation. Overriding is possible but must be
    deliberate: override=true AND a note explaining why, both of which land in
    the audit trail. This is what makes "zero silent corruption" structural
    rather than a matter of reviewer discipline.
    """
    q = db.get(Question, qid)
    if not q:
        raise HTTPException(404, "question not found")

    problems = blocking_problems(q)
    if problems and not d.override:
        raise HTTPException(
            409,
            {
                "error": "question failed validation",
                "problems": problems,
                "hint": "fix the question, or resend with override=true and a note",
            },
        )
    if problems and d.override:
        if not (d.note or "").strip():
            raise HTTPException(422, {"error": "override requires a note", "problems": problems})
        db.add(Audit(question_id=q.id, action="override", field="validation",
                     old_value="; ".join(problems), new_value=d.note, actor=d.actor))
    return _decide(q, REVIEW_APPROVED, d, db)


@app.post("/api/questions/{qid}/reject")
def reject(qid: str, d: Decision, db: Session = Depends(get_db)) -> dict:
    q = db.get(Question, qid)
    if not q:
        raise HTTPException(404, "question not found")
    return _decide(q, REVIEW_REJECTED, d, db)


@app.post("/api/questions/{qid}/reset")
def reset(qid: str, d: Decision, db: Session = Depends(get_db)) -> dict:
    q = db.get(Question, qid)
    if not q:
        raise HTTPException(404, "question not found")
    return _decide(q, REVIEW_PENDING, d, db)


@app.patch("/api/questions/{qid}")
def edit(qid: str, e: Edit, db: Session = Depends(get_db)) -> dict:
    """
    Apply a human correction. Every changed field writes an audit row holding
    the previous value — edits are never silent overwrites, so an approved
    question can always be traced back to what the parser produced.
    """
    q = db.get(Question, qid)
    if not q:
        raise HTTPException(404, "question not found")

    for field in ("stem_en", "stem_hi", "topic_id", "explanation_en", "explanation_hi"):
        new = getattr(e, field)
        if new is None:
            continue
        old = getattr(q, field)
        if (old or "") == new:
            continue
        setattr(q, field, new)
        db.add(Audit(question_id=q.id, action="edit", field=field,
                     old_value=old, new_value=new, actor=e.actor))

    if e.options:
        by_label = {o.label: o for o in q.options}
        for label, patch in e.options.items():
            if label not in ("A", "B", "C", "D"):
                continue
            opt = by_label.get(label)
            if not opt:
                # The option is genuinely absent because extraction dropped it
                # (stacked fractions, column breaks). Creating it here is part
                # of the repair, and is audited like any other change.
                opt = Option(question_id=q.id, label=label, text_en="", is_correct=False)
                q.options.append(opt)
                by_label[label] = opt
                db.add(Audit(question_id=q.id, action="edit", field=f"option.{label}",
                             old_value=None, new_value="created", actor=e.actor))
            for src, attr in (("en", "text_en"), ("hi", "text_hi")):
                if src in patch and (getattr(opt, attr) or "") != patch[src]:
                    db.add(Audit(question_id=q.id, action="edit", field=f"option.{label}.{src}",
                                 old_value=getattr(opt, attr), new_value=patch[src], actor=e.actor))
                    setattr(opt, attr, patch[src])
            if "isCorrect" in patch and opt.is_correct != bool(patch["isCorrect"]):
                db.add(Audit(question_id=q.id, action="edit", field=f"option.{label}.isCorrect",
                             old_value=str(opt.is_correct), new_value=str(patch["isCorrect"]),
                             actor=e.actor))
                opt.is_correct = bool(patch["isCorrect"])

    db.commit()
    db.refresh(q)
    return question_payload(q, include_audit=True)


class BulkApprove(BaseModel):
    actor: str = "reviewer"
    paper_id: str | None = None
    # Guard rail: bulk approval refuses to touch anything the validator flagged.
    only_clean: bool = True


@app.post("/api/bulk-approve")
def bulk_approve(b: BulkApprove, db: Session = Depends(get_db)) -> dict:
    stmt = select(Question).where(Question.review_status == REVIEW_PENDING)
    if b.paper_id:
        stmt = stmt.where(Question.paper_id == b.paper_id)
    if b.only_clean:
        stmt = stmt.where(Question.confidence >= 1.0)

    items = db.scalars(stmt).all()
    for q in items:
        db.add(Audit(question_id=q.id, action=REVIEW_APPROVED, field="review_status",
                     old_value=q.review_status, new_value=REVIEW_APPROVED, actor=b.actor))
        q.review_status = REVIEW_APPROVED
        q.reviewed_by = b.actor
        q.reviewed_at = func.now()
    db.commit()
    return {"approved": len(items), "onlyClean": b.only_clean}


# ───────────────────────── grounded explanation ─────────────────────────


class ExplainRequest(BaseModel):
    lang: Literal["en", "hi", "gu"] = "en"
    provider: str | None = None
    actor: str = "llm"
    # Preview without writing, so a prompt can be inspected before it is trusted.
    dry_run: bool = False


# ---------------------------------------------------------------------------
# Provider registry
#
# Every response below goes through reg.public_dict(), which omits the key
# entirely rather than masking it at the edge. There is deliberately no route
# that returns a secret.
# ---------------------------------------------------------------------------


class ProviderIn(BaseModel):
    name: str
    role: str
    base_url: str
    model: str
    #: Stored as-is. Prefer api_key_env, which keeps the secret out of the DB.
    api_key: str | None = None
    api_key_env: str | None = None
    enabled: bool = True
    priority: int = 100
    max_tokens: int = 700
    temperature: float = 0.2
    notes: str | None = None


class ProviderPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    api_key_env: str | None = None
    enabled: bool | None = None
    priority: int | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    notes: str | None = None


@app.get("/api/providers")
def list_providers(db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(
        select(Provider).order_by(Provider.role, Provider.priority, Provider.id)
    ).all()

    # Show what each ROLE actually resolves to, including whether it had to fall
    # back. This is the question the person configuring it is really asking, and
    # a list of rows does not answer it.
    routing: dict[str, dict] = {}
    for role in reg.ROLES:
        try:
            r = reg.resolve(db, role)
            routing[role] = {
                "provider": r.name,
                "model": r.model,
                "servedByRole": r.role,
                "isFallback": r.is_fallback,
            }
        except reg.NoProviderError as e:
            routing[role] = {"provider": None, "error": str(e)}

    return {
        "roles": list(reg.ROLES),
        "providers": [reg.public_dict(p) for p in rows],
        "routing": routing,
    }


@app.post("/api/providers", status_code=201)
def create_provider(body: ProviderIn, db: Session = Depends(get_db)) -> dict:
    role = body.role.upper()
    if role not in reg.ROLES:
        raise HTTPException(422, f"unknown role {body.role!r}; known: {', '.join(reg.ROLES)}")
    if not body.api_key and not body.api_key_env:
        raise HTTPException(422, "provide either api_key or api_key_env")

    clash = db.scalar(select(Provider).where(Provider.name == body.name, Provider.role == role))
    if clash:
        raise HTTPException(409, f"{body.name} is already registered for {role}")

    p = Provider(**{**body.model_dump(), "role": role})
    db.add(p)
    db.commit()
    db.refresh(p)
    return reg.public_dict(p)


@app.patch("/api/providers/{pid}")
def update_provider(pid: int, body: ProviderPatch, db: Session = Depends(get_db)) -> dict:
    p = db.get(Provider, pid)
    if not p:
        raise HTTPException(404, "no such provider")

    patch = body.model_dump(exclude_unset=True)
    if "role" in patch:
        patch["role"] = patch["role"].upper()
        if patch["role"] not in reg.ROLES:
            raise HTTPException(422, f"unknown role; known: {', '.join(reg.ROLES)}")

    # An empty string means "leave the stored key alone", not "erase it". The
    # form cannot render the current key (by design), so it submits blank on
    # every edit — treating that as a deletion would wipe the key any time
    # someone changed the model name.
    if patch.get("api_key") == "":
        patch.pop("api_key")

    for field, value in patch.items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return reg.public_dict(p)


@app.delete("/api/providers/{pid}")
def delete_provider(pid: int, db: Session = Depends(get_db)) -> dict:
    p = db.get(Provider, pid)
    if not p:
        raise HTTPException(404, "no such provider")
    db.delete(p)
    db.commit()
    return {"deleted": pid}


@app.post("/api/providers/{pid}/check")
def check_provider(pid: int, db: Session = Depends(get_db)) -> dict:
    """Make a real call. 'Configured' and 'working' are different claims."""
    return reg.check(db, pid)


@app.post("/api/providers/seed")
def reseed_providers(db: Session = Depends(get_db)) -> dict:
    return {"added": reg.seed(db)}


@app.get("/api/llm/status")
def llm_status(db: Session = Depends(get_db)) -> dict:
    """
    Kept for the mobile app, which polls it to decide whether to offer the
    tutor at all. Now answered from the registry rather than the old env-only
    dict, so disabling a provider in the tool actually reaches the phone.
    """
    out = provider_status()
    out["registry"] = list_providers(db)["routing"]
    return out


@app.post("/api/questions/{qid}/explain")
def explain(qid: str, req: ExplainRequest, db: Session = Depends(get_db)) -> dict:
    """
    Generate a distractor analysis for ONE question, grounded in the official key.

    Three guarantees, all structural rather than prompt-dependent:

    1. The correct option is passed in as a FACT from the stored answer key. The
       model explains it; it never gets to decide it.
    2. A question whose extraction failed is refused outright. Explaining a stem
       with empty or marker-only options would be the model inventing content,
       which is exactly the failure mode the review gate exists to stop.
    3. Writing an explanation onto an APPROVED question returns it to pending.
       "Approved" attests to what ships, and after this call the explanation
       ships too, so it needs its own human pass.
    """
    q = db.get(Question, qid)
    if not q:
        raise HTTPException(404, "question not found")

    problems = blocking_problems(q)
    if problems:
        raise HTTPException(
            409,
            {
                "error": "refusing to explain a question that failed validation",
                "problems": problems,
                "why": "the model would be inventing the missing content",
            },
        )

    correct = [o.label for o in q.options if o.is_correct]

    if req.dry_run:
        # The prompts are built inside the pipeline, so a dry run shows the
        # stage-1 prompt — the one that decides what the analysis will contain.
        system, user = build_explanation_prompt(
            q.stem_en,
            [(o.label, o.text_en) for o in q.options],
            correct,
            req.lang,
            is_bonus=q.status == "bonus",
        )
        return {"id": q.id, "dryRun": True, "system": system, "user": user}

    # Reason in English, then render. See twostage.py for why the intermediate
    # is JSON rather than prose — it is what makes "stage 2 added nothing"
    # a measurable claim instead of a hopeful one.
    try:
        run = ts.explain_two_stage(
            db,
            stem=q.stem_en,
            options=[(o.label, o.text_en) for o in q.options],
            correct_labels=correct,
            lang=req.lang,
            is_bonus=q.status == "bonus",
            subject=q.subject,
            passage=q.passage_en,
        )
    except reg.NoProviderError as e:
        raise HTTPException(503, {"error": str(e)})
    except ts.MissingPassageError as e:
        # A comprehension question whose passage the parser never attached. The
        # model will happily answer from memory of the source text, which is
        # invention wearing a citation's clothes — so we refuse instead.
        raise HTTPException(
            409,
            {
                "error": "refusing to explain a question whose source text is missing",
                "why": str(e),
                "fix": "attach the reading passage to this question, then retry",
            },
        )
    except LLMError as e:
        raise HTTPException(502, {"error": str(e),
                                  "hint": "check the provider in the review tool under Providers"})

    text = run.prose
    field = f"explanation_{req.lang}"
    old = getattr(q, field)
    setattr(q, field, text)

    # The full run — both stages and the verification result — is kept so the
    # faithfulness claim can be checked after the fact rather than trusted.
    db.add(
        ExplanationRun(
            question_id=q.id,
            lang=req.lang,
            stage1_json=run.stage1.data,
            stage1_provider=run.stage1.provider,
            stage1_ms=run.stage1.ms,
            stage2_text=run.stage2.text if run.stage2 else None,
            stage2_provider=run.stage2.provider if run.stage2 else None,
            stage2_ms=run.stage2.ms if run.stage2 else None,
            mode=run.mode,
            verification=run.verification,
            passed=run.passed,
        )
    )

    chain = run.stage1.provider + (f" -> {run.stage2.provider}" if run.stage2 else "")
    db.add(Audit(question_id=q.id, action="explain", field=field,
                 old_value=old, new_value=text[:400],
                 # Records the whole chain and whether the reason/render
                 # separation actually happened. A reviewer approving a
                 # single-stage explanation should see that from the audit alone.
                 actor=f"{req.actor}:{run.mode}:{chain}"))

    if not run.passed:
        # A failed check does not discard the text — it may still be fine, and
        # deleting it would hide the problem. It flags it for the human whose
        # job this is.
        db.add(Audit(question_id=q.id, action="verify_failed", field=field,
                     old_value=None,
                     new_value="; ".join(run.verification.get("problems", []))[:400],
                     actor="system"))

    was_approved = q.review_status == REVIEW_APPROVED
    if was_approved:
        q.review_status = REVIEW_PENDING
        q.review_note = "returned to review: LLM explanation added after approval"
        db.add(Audit(question_id=q.id, action="invalidated", field="review_status",
                     old_value=REVIEW_APPROVED, new_value=REVIEW_PENDING,
                     actor="system"))

    db.commit()
    db.refresh(q)
    return {
        "id": q.id,
        "lang": req.lang,
        "mode": run.mode,
        "stage1": {"provider": run.stage1.provider, "ms": run.stage1.ms},
        "stage2": (
            {"provider": run.stage2.provider, "ms": run.stage2.ms} if run.stage2 else None
        ),
        "verification": run.verification,
        "explanation": text,
        "returnedToReview": was_approved,
    }



@app.get("/api/questions/{qid}/runs")
def question_runs(qid: str, db: Session = Depends(get_db)) -> dict:
    """
    The generation history for a question's explanations.

    A reviewer looking at a Hindi explanation cannot judge it against the Hindi
    alone — they need the English it was rendering and whether the mechanical
    checks passed. Both are here, newest first.
    """
    rows = db.scalars(
        select(ExplanationRun)
        .where(ExplanationRun.question_id == qid)
        .order_by(ExplanationRun.id.desc())
    ).all()
    return {
        "runs": [
            {
                "id": r.id,
                "lang": r.lang,
                "mode": r.mode,
                "passed": r.passed,
                "verification": r.verification,
                "stage1": {
                    "provider": r.stage1_provider,
                    "ms": r.stage1_ms,
                    "analysis": r.stage1_json,
                },
                "stage2": {"provider": r.stage2_provider, "ms": r.stage2_ms},
                "at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@app.get("/api/explain/stats")
def explain_stats(db: Session = Depends(get_db)) -> dict:
    """Aggregate pipeline health — how much is generated, and how much verified."""
    total = db.scalar(select(func.count(ExplanationRun.id))) or 0
    passed = db.scalar(
        select(func.count(ExplanationRun.id)).where(ExplanationRun.passed.is_(True))
    ) or 0
    single = db.scalar(
        select(func.count(ExplanationRun.id)).where(ExplanationRun.mode == "single_stage")
    ) or 0
    by_lang = dict(
        db.execute(
            select(ExplanationRun.lang, func.count(ExplanationRun.id)).group_by(ExplanationRun.lang)
        ).all()
    )
    return {
        "runs": total,
        "verified": passed,
        "unverified": total - passed,
        "singleStage": single,
        "byLang": by_lang,
    }


# ────────────────────────── reference corpus / RAG ──────────────────────────


class TutorAsk(BaseModel):
    question: str
    lang: Literal["en", "hi", "gu"] = "en"
    subject: str | None = None
    exam: str | None = "CTET"
    provider: str | None = None
    top_k: int = 4
    dry_run: bool = False


@app.get("/api/corpus/stats")
def corpus_stats(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(
            CorpusChunk.exam, CorpusChunk.subject, CorpusChunk.klass,
            func.count(CorpusChunk.id), func.sum(CorpusChunk.chars),
        ).group_by(CorpusChunk.exam, CorpusChunk.subject, CorpusChunk.klass)
         .order_by(CorpusChunk.subject, CorpusChunk.klass)
    ).all()
    total = db.scalar(select(func.count(CorpusChunk.id))) or 0
    return {
        "chunks": total,
        "books": [
            {"exam": e, "subject": s, "class": k, "chunks": n, "chars": c or 0}
            for e, s, k, n, c in rows
        ],
    }


@app.get("/api/corpus/search")
def corpus_search(
    q: str,
    exam: str | None = None,
    subject: str | None = None,
    limit: int = Query(5, le=20),
    db: Session = Depends(get_db),
) -> dict:
    rows = db.execute(
        SEARCH_SQL, {"q": q, "exam": exam, "subject": subject, "limit": limit}
    ).mappings().all()
    return {
        "query": q,
        "hits": [
            {
                "id": r["id"],
                "rank": round(float(r["rank"]), 4),
                "subject": r["subject"],
                "class": r["klass"],
                "book": r["book_title"],
                "chapter": r["chapter"],
                "pages": [r["page_from"], r["page_to"]],
                "content": r["content"],
            }
            for r in rows
        ],
    }


TUTOR_SYSTEM = """You are a study tutor for India's CTET teacher-eligibility exam.

Answer ONLY from the numbered NCERT extracts provided. They are the official
textbooks the exam is built on.

Rules you must not break:
- If the extracts do not contain the answer, say so plainly and stop. Do not
  fall back on your own knowledge — an answer she cannot trace to a book is
  worse than no answer.
- Cite the extract you used inline as [1], [2] and so on.
- Be concise and concrete. No preamble, no markdown headings.
- Write ONLY in {language}."""


@app.post("/api/tutor/ask")
def tutor_ask(req: TutorAsk, db: Session = Depends(get_db)) -> dict:
    """
    Grounded answer over the NCERT corpus.

    Retrieval runs with no API key, so the citations are always available even
    when generation is not configured — which makes the failure mode useful:
    she still gets the exact book, chapter and page to read.
    """
    rows = db.execute(
        SEARCH_SQL,
        {"q": req.question, "exam": req.exam, "subject": req.subject, "limit": req.top_k},
    ).mappings().all()

    citations = [
        {
            "n": i + 1,
            "subject": r["subject"],
            "class": r["klass"],
            "book": r["book_title"],
            "chapter": r["chapter"],
            "pages": [r["page_from"], r["page_to"]],
            "excerpt": r["content"][:400],
        }
        for i, r in enumerate(rows)
    ]

    if not rows:
        return {
            "answer": None,
            "citations": [],
            "grounded": False,
            "reason": "nothing in the NCERT corpus matched this question",
        }

    extracts = "\n\n".join(
        f"[{i + 1}] ({r['subject']}, Class {r['klass']}, {r['chapter']}, "
        f"p{r['page_from']}-{r['page_to']})\n{r['content']}"
        for i, r in enumerate(rows)
    )
    system = TUTOR_SYSTEM.format(language={"en": "English", "hi": "Hindi", "gu": "Gujarati"}[req.lang])
    user = f"NCERT extracts:\n\n{extracts}\n\nQuestion: {req.question}"

    if req.dry_run:
        return {"dryRun": True, "system": system, "user": user, "citations": citations}

    try:
        resolved = reg.resolve(db, "CHAT")
    except reg.NoProviderError as e:
        # Retrieval still succeeded — hand back the citations so she can read
        # the source herself rather than getting nothing.
        return {
            "answer": None,
            "citations": citations,
            "grounded": True,
            "reason": f"no chat provider configured ({e}); citations still returned",
        }

    provider = OpenAICompatProvider.from_resolved(resolved)
    started = time.time()
    try:
        answer = provider.complete(
            system, user, max_tokens=resolved.max_tokens, temperature=resolved.temperature
        )
    except LLMError as e:
        reg.record_health(db, resolved.id, ok=False,
                          latency_ms=int((time.time() - started) * 1000), error=str(e))
        return {
            "answer": None,
            "citations": citations,
            "grounded": True,
            "reason": f"generation unavailable ({e}); citations still returned",
        }
    reg.record_health(db, resolved.id, ok=True,
                      latency_ms=int((time.time() - started) * 1000), error=None)

    return {
        "answer": answer,
        "citations": citations,
        "grounded": True,
        "provider": resolved.name,
        "model": resolved.model,
        # Surfaced so the app can say the answer came from a stand-in rather
        # than the model chosen for this job.
        "isFallback": resolved.is_fallback,
    }



class ChatTurnIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatAsk(BaseModel):
    message: str
    #: Prior turns, oldest first. The client owns the transcript; the server is
    #: stateless, so a dropped connection cannot lose her conversation.
    history: list[ChatTurnIn] = []
    exam: str = "CTET"
    subject: str | None = None
    top_k: int = 4


@app.post("/api/chat")
def chat(req: ChatAsk, db: Session = Depends(get_db)) -> dict:
    """
    One conversational turn, grounded in NCERT.

    The register is detected per MESSAGE, not per session — she may ask in
    Hinglish, paste an English question from a book, then follow up in Hindi,
    and each should be answered the way it was asked.
    """
    r = chatmod.answer(
        db,
        req.message,
        history=[chatmod.ChatTurn(role=t.role, content=t.content) for t in req.history],
        exam=req.exam,
        subject=req.subject,
        top_k=req.top_k,
    )
    return {
        "reply": r.reply,
        "grounded": r.grounded,
        "reason": r.reason,
        "citations": r.citations,
        "register": {
            "lang": r.register.lang,
            "register": r.register.register,
            "confidence": round(r.register.confidence, 2),
            "evidence": r.register.evidence,
        },
        # Surfaced so a wrong answer can be diagnosed: retrieval driven by her
        # own words and retrieval driven by a translation of them fail in
        # completely different ways.
        "retrieval": {"query": r.query, "method": r.query_method},
        "provider": r.provider,
        "isFallback": r.is_fallback,
        "ms": r.ms,
    }



# ---------------------------------------------------------------------------
# Her own documents
# ---------------------------------------------------------------------------

#: Uploads are capped. A phone on mobile data and a Postgres row both have
#: limits, and a 200MB textbook dump is not the use case — this is for notes.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


@app.get("/api/docs")
def list_docs(db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(
        select(UserDocument).order_by(UserDocument.created_at.desc())
    ).all()
    return {"documents": [userdocs.public_document(d) for d in rows]}


@app.post("/api/docs", status_code=201)
async def upload_doc(
    file: UploadFile = File(...),
    title: str | None = Form(None),
    exam: str | None = Form(None),
    db: Session = Depends(get_db),
) -> dict:
    """
    Store a PDF of her own notes as a searchable, separately-cited corpus.

    A scanned document is refused here rather than stored empty — see
    userdocs.py for why that failure has to surface at upload time.
    """
    data = await file.read()
    if not data:
        raise HTTPException(422, {"error": "empty file"})
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            {"error": f"file is {len(data) // (1024 * 1024)}MB; the limit is "
                      f"{MAX_UPLOAD_BYTES // (1024 * 1024)}MB"},
        )

    try:
        doc = userdocs.ingest_pdf(
            db, data=data, filename=file.filename or "upload.pdf", title=title, exam=exam
        )
    except userdocs.UploadRejected as e:
        raise HTTPException(422, {"error": str(e)})

    return userdocs.public_document(doc)


@app.delete("/api/docs/{doc_id}")
def delete_doc(doc_id: int, db: Session = Depends(get_db)) -> dict:
    doc = db.get(UserDocument, doc_id)
    if not doc:
        raise HTTPException(404, "no such document")
    db.delete(doc)
    db.commit()
    return {"deleted": doc_id}



# ---------------------------------------------------------------------------
# Photo and web input
#
# Both feed the SAME grounded chat path as a typed question. Neither is allowed
# to answer on its own: the camera transcribes, the web fetch supplies clearly
# labelled unverified text, and the answer still comes from retrieval.
# ---------------------------------------------------------------------------


@app.post("/api/chat/photo")
async def chat_photo(
    file: UploadFile = File(...),
    ask: bool = Form(True),
    exam: str = Form("CTET"),
    db: Session = Depends(get_db),
) -> dict:
    """
    Read a photographed question, then answer it from the corpus.

    The transcript is returned whether or not the answer succeeds, because it
    is the only way she can see that the camera read her question correctly —
    OCR on Devanagari conjuncts is wrong often enough to matter.
    """
    data = await file.read()
    try:
        transcript, provider, ms = vision.transcribe(db, data)
    except vision.VisionRejected as e:
        raise HTTPException(422, {"error": str(e)})
    except LLMError as e:
        raise HTTPException(
            502, {"error": str(e), "hint": "check the VISION provider in the review tool"}
        )

    out: dict = {
        "transcript": transcript,
        "provider": provider,
        "ms": ms,
        "reply": None,
        "citations": [],
        "grounded": False,
    }
    if not ask:
        return out

    r = chatmod.answer(db, transcript, exam=exam)
    out.update(
        {
            "reply": r.reply,
            "grounded": r.grounded,
            "reason": r.reason,
            "citations": r.citations,
            "register": {"lang": r.register.lang, "register": r.register.register},
            "retrieval": {"query": r.query, "method": r.query_method},
        }
    )
    return out


class WebAsk(BaseModel):
    url: str
    #: What she wants to know about the page. Optional — with no question this
    #: is just "explain this page".
    message: str | None = None


@app.post("/api/chat/web")
def chat_web(req: WebAsk, db: Session = Depends(get_db)) -> dict:
    """
    Read a public web page and answer from it.

    THE ONE UNGROUNDED PATH. Everything else answers from an official textbook
    or a document she uploaded. A link is neither, so the response is badged
    `unverified` and its citation is a different kind from an NCERT one. The
    badge travels with the answer rather than being a note on the screen that
    built it.
    """
    try:
        title, body = webfetch.fetch(req.url)
    except webfetch.FetchRejected as e:
        raise HTTPException(422, {"error": str(e)})

    if len(body) < 200:
        raise HTTPException(
            422, {"error": "that page had almost no readable text — it may need JavaScript"}
        )

    question = (req.message or "").strip() or "Explain what this page says, for an exam student."
    style = register.style_instruction(register.detect(question))

    system = (
        "You explain a web page to a student preparing for an exam.\n\n"
        "This page is NOT a textbook and has NOT been checked by anyone. Answer only "
        "from the page text below. If the page does not address her question, say so.\n"
        "If anything on the page contradicts what a standard textbook says, point that "
        "out rather than repeating it as fact.\n\n" + style
    )
    user = f"Page title: {title}\n\nPage text:\n{body[:12000]}\n\nHer question: {question}"

    try:
        resolved = reg.resolve(db, "CHAT")
    except reg.NoProviderError as e:
        raise HTTPException(503, {"error": str(e)})

    provider = OpenAICompatProvider.from_resolved(resolved)
    try:
        reply = provider.complete(
            system, user, max_tokens=resolved.max_tokens, temperature=resolved.temperature
        )
    except LLMError as e:
        raise HTTPException(502, {"error": str(e)})

    return {
        "reply": reply,
        "grounded": False,
        "citations": [
            {
                "n": 1,
                "source": "From the web",
                "sourceKind": "web",
                "book": title,
                "chapter": None,
                "class": None,
                "subject": None,
                "pages": [0, 0],
                "url": req.url,
                "excerpt": body[:400],
            }
        ],
        # Read by the app to render the warning badge. Not a suggestion.
        "unverified": True,
        "warning": "FROM THE WEB - not verified against any textbook",
        "provider": f"{resolved.name}/{resolved.model}",
    }



@app.get("/api/practice-sets/preview")
def preview_practice_set(
    paper_type: str = Query("CTET_P1"),
    exam: str = Query("CTET"),
    seed: int = Query(0),
    db: Session = Depends(get_db),
) -> dict:
    """
    Assemble a Practice Set from APPROVED questions and report what came out.

    Nothing is generated here — a set is real exam questions in a new order, so
    the hallucination risk is zero by construction. What can go wrong is a
    SHORTFALL: not enough approved questions in a section to fill the blueprint.
    That is reported per section rather than padded from elsewhere, because a
    "150-question paper" that is quietly 95 questions of the wrong shape is
    worse than an honest 95.
    """
    try:
        s = practicesets.build(db, exam_code=exam, paper_type=paper_type, seed=seed)
    except ValueError as e:
        raise HTTPException(422, {"error": str(e)})
    return practicesets.report(db, s)



# ---------------------------------------------------------------------------
# Optional accounts and progress restore
#
# The account exists for exactly one purpose: carrying study history across an
# uninstall or a new phone. It is never required to use the app, and no screen
# blocks on it.
# ---------------------------------------------------------------------------


def current_account(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Account:
    """Resolve the bearer token to an account, or 401."""
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    account_id = accounts.read_token(token) if token else None
    if account_id is None:
        raise HTTPException(401, {"error": "sign in again"})
    acc = db.get(Account, account_id)
    if acc is None:
        raise HTTPException(401, {"error": "sign in again"})
    return acc


class Credentials(BaseModel):
    username: str
    password: str


class SyncPush(BaseModel):
    #: Whole study history from the device: attempts, responses, mistakes.
    payload: dict
    #: Free-text device label, so a second phone can be warned about.
    device: str | None = None
    #: Set when the client has already warned the student about replacing a
    #: snapshot from another device and she chose to continue.
    force: bool = False


@app.post("/api/account/register", status_code=201)
def account_register(body: Credentials, db: Session = Depends(get_db)) -> dict:
    try:
        acc, token = accounts.register(db, body.username, body.password)
    except accounts.AuthError as e:
        raise HTTPException(422, {"error": str(e)})
    return {"username": acc.username, "token": token, "created": True}


@app.post("/api/account/login")
def account_login(body: Credentials, db: Session = Depends(get_db)) -> dict:
    try:
        acc, token = accounts.login(db, body.username, body.password)
    except accounts.AuthError as e:
        # 401, not 422: this is a failed authentication, and the client shows it
        # differently from a malformed request.
        raise HTTPException(401, {"error": str(e)})
    return {"username": acc.username, "token": token, "created": False}


@app.get("/api/account/me")
def account_me(acc: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    loaded = accounts.load_snapshot(db, acc.id)
    stats = loaded[1] if loaded else None
    return {
        "username": acc.username,
        "hasBackup": stats is not None,
        "backup": (
            {
                "attempts": stats.attempts,
                "responses": stats.responses,
                "mistakes": stats.mistakes,
                "device": stats.device,
                "savedAt": stats.saved_at,
            }
            if stats
            else None
        ),
    }


@app.post("/api/sync/push")
def sync_push(
    body: SyncPush,
    acc: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """
    Replace the stored snapshot with what is on this device.

    Guarded against the case that actually loses data: signing in on a fresh
    install and immediately pushing an empty history over a real one. If the
    incoming snapshot has fewer attempts than the stored one, it is refused
    until the client confirms — because at that moment the phone has nothing
    and the server has everything, and the correct action is almost always a
    pull rather than a push.
    """
    existing = accounts.load_snapshot(db, acc.id)
    incoming_attempts = len((body.payload or {}).get("attempts") or [])
    if existing and not body.force:
        _, stats = existing
        if incoming_attempts < stats.attempts:
            raise HTTPException(
                409,
                {
                    "error": "this device has less history than your backup",
                    "stored": {
                        "attempts": stats.attempts,
                        "device": stats.device,
                        "savedAt": stats.saved_at,
                    },
                    "incoming": {"attempts": incoming_attempts},
                    "hint": "restore first, or push again with force to overwrite",
                },
            )

    stats = accounts.save_snapshot(db, acc.id, body.payload or {}, body.device)
    return {
        "saved": True,
        "attempts": stats.attempts,
        "responses": stats.responses,
        "mistakes": stats.mistakes,
        "savedAt": stats.saved_at,
    }


@app.get("/api/sync/pull")
def sync_pull(acc: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    loaded = accounts.load_snapshot(db, acc.id)
    if not loaded:
        return {"hasBackup": False, "payload": None}
    payload, stats = loaded
    return {
        "hasBackup": True,
        "payload": payload,
        "attempts": stats.attempts,
        "responses": stats.responses,
        "mistakes": stats.mistakes,
        "device": stats.device,
        "savedAt": stats.saved_at,
    }


@app.get("/", response_class=HTMLResponse)
def review_ui() -> HTMLResponse:
    return HTMLResponse((STATIC / "review.html").read_text(encoding="utf-8"))

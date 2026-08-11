"""
Practice Sets: real questions, new order.

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
A Practice Set is built ENTIRELY from questions that appeared on a real exam and
have been through human review. Nothing is generated, rewritten or paraphrased.
The only new thing is the selection and the order.

That makes it the safest possible extra practice: the hallucination risk is
exactly zero, because no model is involved at any point in this file. It is a
different product from an AI Mock, and the two are deliberately kept apart —
mixing invented questions into a set of real ones would destroy the student's
ability to tell which is which, and "was this on a real paper?" is a question
she is entitled to a straight answer to.

WHY IT STILL FOLLOWS THE BLUEPRINT
----------------------------------
A shuffled bag of 150 questions is not practice for CTET. The value of a mock
is that it rehearses the real thing: 30 questions of Child Development, then 30
of Mathematics, in that order, under the same clock. So sets are assembled
against the same section blueprint the real paper uses, and a set that cannot
be filled to blueprint is reported as short rather than quietly padded from
another section.

APPROVED ONLY
-------------
Selection reads `review_status='approved'` in the query itself, the same as the
export. A practice set cannot contain something a human has not signed off,
because it is drawn from the same pool that ships.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import Option, Paper, Question, REVIEW_APPROVED

# Section shape of a generated set, mirroring tools/ctet_syllabus.py. Duplicated
# here rather than imported because the API must not depend on the parser tools
# directory — but the SOURCE of both is the printed booklet cover.
BLUEPRINTS: dict[str, list[tuple[str, int]]] = {
    "CTET_P1": [
        ("Child Development and Pedagogy", 30),
        ("Mathematics", 30),
        ("Environmental Studies", 30),
        ("Language I", 30),
        ("Language II", 30),
    ],
    "CTET_P2_MATHSCI": [
        ("Child Development and Pedagogy", 30),
        ("Mathematics and Science", 60),
        ("Language I", 30),
        ("Language II", 30),
    ],
    "CTET_P2_SOCSCI": [
        ("Child Development and Pedagogy", 30),
        ("Social Studies / Social Science", 60),
        ("Language I", 30),
        ("Language II", 30),
    ],
}

DURATION_MIN = {"CTET_P1": 150, "CTET_P2_MATHSCI": 150, "CTET_P2_SOCSCI": 150}


@dataclass
class SetSection:
    subject: str
    wanted: int
    got: int
    question_ids: list[str] = field(default_factory=list)

    @property
    def short_by(self) -> int:
        return max(0, self.wanted - self.got)


@dataclass
class PracticeSet:
    id: str
    exam_code: str
    paper_type: str
    label: str
    sections: list[SetSection]
    question_ids: list[str]
    warnings: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not any(s.short_by for s in self.sections)

    @property
    def total(self) -> int:
        return len(self.question_ids)


def approved_pool(db: Session, exam_code: str, paper_type: str) -> list[Question]:
    """
    Approved questions for this exam, eligible for a set.

    Comprehension questions are INCLUDED — they now carry their passage, so they
    are answerable out of their original paper. Before that fix they would have
    been unanswerable in a reshuffled set, which is a good illustration of why
    the passage work had to come first.
    """
    return list(
        db.scalars(
            select(Question)
            .options(selectinload(Question.options))
            .join(Paper, Paper.id == Question.paper_id)
            .where(
                Paper.exam_code == exam_code,
                Question.review_status == REVIEW_APPROVED,
            )
        )
    )


def usable(q: Question) -> bool:
    """
    Whether a question can stand on its own in a new paper.

    Stricter than the export gate: a set is assembled outside the context of its
    original booklet, so anything that depends on that context is excluded.
    """
    if not q.stem_en or not q.stem_en.strip():
        return False
    if len(q.options) < 2:
        return False
    if not any(o.is_correct for o in q.options):
        # A bonus question has no single correct option by design; it is
        # excluded from generated sets because a free mark in practice teaches
        # nothing and distorts the score she is trying to read.
        return False
    if len({(o.text_en or "").strip().lower() for o in q.options}) != len(q.options):
        return False  # duplicate options
    return True


def build(
    db: Session,
    *,
    exam_code: str = "CTET",
    paper_type: str = "CTET_P1",
    seed: int | None = None,
    exclude_question_ids: set[str] | None = None,
) -> PracticeSet:
    """
    Assemble one set to blueprint.

    `seed` makes a set reproducible — the same seed yields the same paper, so a
    set can be regenerated for review without being a different paper each time.
    """
    blueprint = BLUEPRINTS.get(paper_type)
    if not blueprint:
        raise ValueError(f"no blueprint for {paper_type}; known: {', '.join(BLUEPRINTS)}")

    rng = random.Random(seed if seed is not None else 0)
    excluded = exclude_question_ids or set()

    pool = [q for q in approved_pool(db, exam_code, paper_type) if usable(q)]
    by_subject: dict[str, list[Question]] = {}
    for q in pool:
        if q.id in excluded:
            continue
        by_subject.setdefault(q.subject or "", []).append(q)

    sections: list[SetSection] = []
    chosen: list[str] = []
    seen_stems: set[str] = set()

    for subject, wanted in blueprint:
        candidates = list(by_subject.get(subject, []))
        rng.shuffle(candidates)

        picked: list[str] = []
        for q in candidates:
            if len(picked) >= wanted:
                break
            # The same question can appear in more than one sitting; two copies
            # in one paper reads as a printing error and wastes a slot.
            fingerprint = hashlib.sha1(q.stem_en.strip().lower().encode()).hexdigest()
            if fingerprint in seen_stems:
                continue
            seen_stems.add(fingerprint)
            picked.append(q.id)

        sections.append(SetSection(subject=subject, wanted=wanted, got=len(picked), question_ids=picked))
        chosen.extend(picked)

    warnings = [
        f"{s.subject}: {s.got}/{s.wanted} — {s.short_by} short"
        for s in sections
        if s.short_by
    ]

    digest = hashlib.sha1(f"{paper_type}|{seed}|{'|'.join(chosen)}".encode()).hexdigest()[:12]
    return PracticeSet(
        id=f"set_{digest}",
        exam_code=exam_code,
        paper_type=paper_type,
        label="Practice Set",
        sections=sections,
        question_ids=chosen,
        warnings=warnings,
    )


def answer_spread(db: Session, question_ids: list[str]) -> dict[str, int]:
    """
    How often each option label is the answer.

    A set where 60% of answers are (C) is guessable in a way the real paper is
    not, and practising against it teaches a habit that will cost marks. This is
    reported rather than corrected: forcing a distribution would mean dropping
    good questions for positional reasons.
    """
    counts: dict[str, int] = {}
    if not question_ids:
        return counts
    rows = db.scalars(
        select(Option).where(Option.question_id.in_(question_ids), Option.is_correct.is_(True))
    )
    for o in rows:
        counts[o.label] = counts.get(o.label, 0) + 1
    return dict(sorted(counts.items()))


def report(db: Session, s: PracticeSet) -> dict:
    spread = answer_spread(db, s.question_ids)
    total = sum(spread.values()) or 1
    skew = max(spread.values()) / total if spread else 0.0
    return {
        "id": s.id,
        "examCode": s.exam_code,
        "paperType": s.paper_type,
        "label": s.label,
        "sourceType": "PRACTICE_SET",
        "badge": "PRACTICE SET · real questions, new order",
        "totalQuestions": s.total,
        "durationMin": DURATION_MIN.get(s.paper_type, 150),
        "complete": s.complete,
        "sections": [
            {"subject": x.subject, "wanted": x.wanted, "got": x.got, "shortBy": x.short_by}
            for x in s.sections
        ],
        "answerSpread": spread,
        "answerSkew": round(skew, 3),
        "warnings": s.warnings
        + (
            [f"answers are {skew:.0%} one option — more guessable than a real paper"]
            if skew > 0.4
            else []
        ),
        "questionIds": s.question_ids,
    }

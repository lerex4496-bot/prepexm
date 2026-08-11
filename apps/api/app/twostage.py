"""
Two-stage explanation generation: reason in English, then render into her
language.

THE PROBLEM THIS SOLVES
-----------------------
One model asked to "explain this CTET question in Hindi" is doing two jobs at
once: working out the pedagogy, and writing fluent Devanagari. Models are rarely
best at both, and the failure is invisible — fluent Hindi prose reads as
authoritative whether or not the reasoning underneath it is sound. The student
cannot tell, and neither can a reviewer skimming.

So the jobs are separated:

    STAGE 1 (REASON)    question + options + OFFICIAL KEY  ->  structured English
    STAGE 2 (LOCALISE)  that structure + glossary          ->  Hindi / Gujarati

WHY STAGE 1 RETURNS JSON AND NOT PROSE
--------------------------------------
This is the load-bearing decision. If stage 1 returned a paragraph, stage 2
would be "translate this paragraph", and a translator that adds a clause is
indistinguishable from one that does not — you would be checking prose against
prose by eye.

Because stage 1 returns a fixed schema (concept, why_correct, one entry per
distractor), stage 2's job is to fill the SAME schema in another language. That
makes "did stage 2 invent something?" a mechanical question:

  * did the set of distractor labels change?           -> structural check
  * did a number appear that stage 1 never mentioned?  -> numeric check
  * did the text triple in length?                     -> padding check

Fluency cannot hide any of those. `verify()` runs all three and stores the
result, so the claim "stage 2 adds no facts" is measured per run rather than
asserted once in a docstring.

WHAT NEITHER STAGE MAY DO
-------------------------
  * Neither chooses the answer. The official CBSE key is passed in as a fact.
    A model that "corrects" the board is producing content that will lose her
    marks in the real exam.
  * Stage 2 may not add, remove or reorder claims. If stage 1 did not say it,
    it cannot appear.
  * Nothing here reaches a student directly. Output lands as pending review.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import providers as reg
from .llm import LLMError, OpenAICompatProvider
from .models import GlossaryTerm

LANG_NAME = {"en": "English", "hi": "Hindi", "gu": "Gujarati"}


class MissingPassageError(LLMError):
    """The question depends on reading material that is not attached to it."""


# ---------------------------------------------------------------------------
# Stage 1 — reasoning
# ---------------------------------------------------------------------------

STAGE1_SYSTEM = """You analyse questions from Indian competitive exams (CTET, NEET).

You are given a question, its options, and THE OFFICIAL CORRECT ANSWER as
published by the examining board. The official answer is a FACT you must accept.
Never contradict it, never argue another option is correct, and never say the
official answer looks wrong. If it seems odd, give the reasoning that supports it.

Reply with ONLY a JSON object, no markdown fence and no commentary:

{
  "concept": "the single idea being tested, one sentence",
  "why_correct": "why the official answer is correct, 2-3 sentences, concrete",
  "distractors": [
    {"label": "A", "why_wrong": "why THIS option is wrong, one or two sentences"}
  ],
  "exam_tip": "how to recognise this trap under time pressure, one sentence"
}

Rules:
- Include one "distractors" entry for EVERY option that is not correct, using the
  exact labels given. Do not include the correct option there.
- Write plain English. No markdown, no headings, no bullet characters.
- Be specific. "Option B is incorrect because it is not related" teaches nothing;
  say what B actually describes and why that is not what the question asked.
- State only what you are confident of. If you are unsure why a distractor is
  wrong, say what it does describe instead of inventing a reason."""

STAGE1_USER = """{passage}Question: {stem}

Options:
{options}

OFFICIAL CORRECT ANSWER (from the board's final answer key): {correct}
{extra}
Return the JSON object."""


# ---------------------------------------------------------------------------
# Stage 2 — localisation
# ---------------------------------------------------------------------------

STAGE2_SYSTEM = """You render an existing English analysis into {language}. You are a
RENDERER, not an author.

You will be given a JSON object in English. Return the SAME JSON object with the
same keys and the same distractor labels, with the text values written in
{language}.

Absolute rules:
- Add NOTHING. If the English does not say it, it must not appear in {language}.
- Remove nothing. Every claim in the English must survive.
- Do not add examples, caveats, encouragement or extra sentences.
- Keep every number, year, percentage and proper noun exactly as given.
- Keep the "label" values exactly as they are (A, B, C, D). Do not translate them.
- Write naturally for a student, not word-for-word. Natural {language} that says
  the same thing is correct; literal translation that reads like a machine is not.
{glossary}
Reply with ONLY the JSON object, no markdown fence and no commentary."""

STAGE2_USER = """English analysis to render into {language}:

{payload}

Return the same JSON with the text values in {language}."""


@dataclass
class StageResult:
    data: dict | None = None
    text: str = ""
    provider: str = ""
    role_used: str = ""
    is_fallback: bool = False
    ms: int = 0


@dataclass
class TwoStageResult:
    lang: str
    stage1: StageResult
    stage2: StageResult | None
    prose: str
    mode: str  # 'two_stage' | 'single_stage'
    verification: dict = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return bool(self.verification.get("ok"))


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.I)


def parse_json_object(raw: str) -> dict:
    """
    Pull a JSON object out of a model reply.

    Models fence JSON in markdown about half the time despite being told not to,
    and occasionally prepend a sentence. Being tolerant here is not sloppiness —
    the alternative is discarding a perfectly good analysis over a code fence.
    But we never "repair" the JSON itself: if it will not parse, that is a failed
    run, not something to guess at.
    """
    text = _FENCE.sub("", (raw or "").strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as e:
            raise LLMError(f"stage output was not valid JSON: {text[:180]}") from e
    raise LLMError(f"stage output contained no JSON object: {text[:180]}")


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

# Devanagari and Gujarati digits, so a number written in Indic script is
# compared against the Latin digits stage 1 used rather than counted as new.
_DIGIT_MAP = str.maketrans(
    "०१२३४५६७८९૦૧૨૩૪૫૬૭૮૯",
    "01234567890123456789",
)

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    normalised = text.translate(_DIGIT_MAP)
    # Strip thousands separators so "1,000" and "1000" are the same number.
    normalised = re.sub(r"(?<=\d),(?=\d)", "", normalised)
    return {n.lstrip("0") or "0" for n in _NUMBER.findall(normalised)}


def _all_text(d: dict) -> str:
    parts = [str(d.get("concept") or ""), str(d.get("why_correct") or ""), str(d.get("exam_tip") or "")]
    for item in d.get("distractors") or []:
        parts.append(str(item.get("why_wrong") or ""))
    return "\n".join(parts)


def verify(stage1: dict, stage2: dict) -> dict:
    """
    Mechanical checks that stage 2 rendered stage 1 rather than rewriting it.

    Deliberately NOT an LLM judging an LLM. Every check below is deterministic
    and reproducible; asking a third model "is this faithful?" would add another
    thing that can be confidently wrong, and could not be re-run to the same
    answer next month.

    These checks cannot prove faithfulness — a renderer could still subtly
    change a claim using no new numbers. They catch the failure modes that
    actually occur: dropped distractors, invented statistics, and padding.
    """
    problems: list[str] = []

    labels1 = [str(d.get("label", "")).strip().upper() for d in (stage1.get("distractors") or [])]
    labels2 = [str(d.get("label", "")).strip().upper() for d in (stage2.get("distractors") or [])]
    if set(labels1) != set(labels2):
        problems.append(f"distractor labels changed: {sorted(labels1)} -> {sorted(labels2)}")

    for key in ("concept", "why_correct"):
        if str(stage1.get(key) or "").strip() and not str(stage2.get(key) or "").strip():
            problems.append(f"{key} was dropped")

    text1, text2 = _all_text(stage1), _all_text(stage2)

    # A number in the rendering that the reasoning never mentioned is the
    # clearest signal of invention — a fabricated year or percentage reads as
    # authoritative and is exactly what a student would memorise.
    invented = _numbers(text2) - _numbers(text1)
    if invented:
        problems.append(f"numbers not present in stage 1: {sorted(invented)}")

    # Indic scripts run longer than English for the same content, so the ceiling
    # is generous. It is here to catch a renderer that started explaining.
    ratio = (len(text2) / len(text1)) if text1 else 0.0
    if text1 and ratio > 2.6:
        problems.append(f"stage 2 is {ratio:.1f}x the length of stage 1 — likely added content")
    if text1 and ratio < 0.45:
        problems.append(f"stage 2 is only {ratio:.1f}x stage 1 — likely dropped content")

    return {
        "ok": not problems,
        "problems": problems,
        "lengthRatio": round(ratio, 2),
        "distractorsIn": sorted(labels1),
        "distractorsOut": sorted(labels2),
        "numbersInvented": sorted(invented),
    }


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def to_prose(d: dict) -> str:
    """
    Flatten the structure into the paragraph the app renders.

    Structure is what the pipeline needs; the student needs prose. Both are
    kept: the JSON in explanation_runs for audit, this text on the question.
    """
    out: list[str] = []
    concept = str(d.get("concept") or "").strip()
    why = str(d.get("why_correct") or "").strip()
    if concept:
        out.append(concept)
    if why:
        out.append(why)
    for item in d.get("distractors") or []:
        label = str(item.get("label", "")).strip()
        reason = str(item.get("why_wrong") or "").strip()
        if label and reason:
            out.append(f"({label}) {reason}")
    tip = str(d.get("exam_tip") or "").strip()
    if tip:
        out.append(tip)
    return "\n\n".join(out)


def glossary_block(db: Session, lang: str, subject: str | None = None) -> str:
    """The fixed-translation terms, as a prompt fragment. Empty when lang is English."""
    if lang not in ("hi", "gu"):
        return ""
    column = GlossaryTerm.term_hi if lang == "hi" else GlossaryTerm.term_gu
    rows = db.scalars(
        select(GlossaryTerm).where(column.is_not(None)).order_by(GlossaryTerm.term_en)
    ).all()
    if subject:
        rows = [r for r in rows if not r.subject or r.subject == subject] or rows
    pairs = [(r.term_en, r.term_hi if lang == "hi" else r.term_gu) for r in rows]
    pairs = [(a, b) for a, b in pairs if b][:60]
    if not pairs:
        return ""
    listing = "\n".join(f"  {en} = {native}" for en, native in pairs)
    return (
        "\nUse EXACTLY these renderings for these terms, every time, so the same\n"
        "concept never appears under two different words across the app:\n"
        f"{listing}\n"
    )



# ---------------------------------------------------------------------------
# Refusing questions whose source material is not in front of us
# ---------------------------------------------------------------------------

# A comprehension question quotes a passage that is printed ONCE above a block
# of questions. The parser attaches that passage to no question, so the stem
# arrives standalone:
#
#     "What did the cricket do in summer ?"
#     "What is the theme of the poem ?"
#
# Asked to explain those, the reasoning model does not refuse — it recognises
# "The Ant and the Cricket" and answers from general knowledge, and for a named
# person it recalls biography that was never on the page. Measured on the March
# 2026 Paper II Language I block, every such explanation passed the stage-1/
# stage-2 checks and every one was reconstructed rather than read: q113/q114
# produced correct-sounding detail about Aimee Mullins that appears nowhere in
# the paper.
#
# That is invention with a citation-shaped surface, which is worse than a
# refusal: the student cannot tell, and the verification cannot either, because
# it only compares stage 2 against stage 1 and stage 1 was already unmoored.
#
# So these are refused until the parser attaches passages to their questions.
_PASSAGE_REF = re.compile(
    r"\b(?:the|this|above|following)\s+"
    r"(?:poem|passage|story|extract|paragraph|text|stanza|lines?|poet|author|"
    r"writer|narrator|essay|article)\b",
    re.I,
)

# Long stems carry their own material, so a reference inside them is fine.
# Comprehension stems are short questions ABOUT text printed elsewhere.
_SELF_CONTAINED_CHARS = 400

# A NOTE ON A GUARD THAT USED TO BE HERE
# --------------------------------------
# Before the parser attached passages, this module refused every Language I/II
# question that lacked a grammar or vocabulary marker. That was the right call
# at the time — the dangerous stems name no passage at all ("What did the
# cricket do in summer ?"), so there was nothing to pattern-match and the safe
# default had to be refusal.
#
# It cost far too much once passages existed: 91 questions, and inspection
# showed almost all of them were Language PEDAGOGY ("In process writing
# approach, pre-writing is :"), which is entirely self-contained. Refusing those
# was not caution, it was noise, and noise in a safety check is how the check
# stops being read.
#
# It is safe to drop because the underlying condition changed. Every
# comprehension block in these papers opens with a directive carrying an
# explicit range — "(Q. Nos. 91 to 96)" — and the parser now attaches the
# passage to every question in it. Verified across both March 2026 papers: four
# ranged directives each, 30 questions each, all attached. The only other
# "Directions :" lines are the generic "Answer the following questions by
# selecting the correct option", which introduce standalone items.
#
# So the remaining guard is the explicit-reference regex above, plus the
# parser-side check that a question inside a declared range actually received
# its passage. If that check ever fires, this refusal is the thing that should
# come back.


def missing_passage_reason(
    stem: str, subject: str | None = None, passage: str | None = None
) -> str | None:
    """
    Why this question cannot be explained from its stem alone, or None.

    Deliberately conservative in one direction only: a false positive costs a
    question its explanation, which a human can add in the review tool. A false
    negative ships invented reading comprehension to a student preparing for a
    real exam, wearing exactly the same confident prose as a sound one.
    """
    # The whole point of the refusal is a missing source text. If the parser
    # attached one, there is nothing missing and the question is answerable
    # from the record — which is exactly the state we want every comprehension
    # question to reach.
    if (passage or "").strip():
        return None

    text = (stem or "").strip()
    if len(text) >= _SELF_CONTAINED_CHARS:
        return None

    m = _PASSAGE_REF.search(text)
    if m:
        return (
            f"stem refers to {m.group(0)!r} but the passage is not attached to the "
            f"question — explaining it would mean recalling the text rather than reading it"
        )

    return None


# ---------------------------------------------------------------------------
# The pipeline
# ---------------------------------------------------------------------------


def _call(
    resolved: reg.ResolvedProvider, system: str, user: str, *, max_tokens: int | None = None
) -> tuple[str, int]:
    client = OpenAICompatProvider.from_resolved(resolved)
    started = time.time()
    text = client.complete(
        system,
        user,
        max_tokens=max_tokens or resolved.max_tokens,
        temperature=resolved.temperature,
    )
    return text, int((time.time() - started) * 1000)


def _call_json(
    resolved: reg.ResolvedProvider, system: str, user: str
) -> tuple[dict, str, int]:
    """
    Call a stage and parse its JSON, retrying ONCE with more headroom.

    Measured over a 20-question batch: 3 of 17 stage-1 calls returned JSON that
    simply stopped mid-object. Re-running the same prompt at the same token
    limit succeeded, so this is not a prompt that needs more tokens in general —
    it is variance in how long the reasoning model thinks before it starts
    writing. A single retry at double the ceiling converts that ~18% loss into
    an occasional slow question.

    The retry is deliberately narrow: we re-ASK, we never repair. Patching up
    truncated JSON would mean inventing whatever was cut off, which is exactly
    the class of thing this pipeline exists to prevent.
    """
    raw, ms = _call(resolved, system, user)
    try:
        return parse_json_object(raw), raw, ms
    except LLMError:
        pass

    raw2, ms2 = _call(resolved, system, user, max_tokens=resolved.max_tokens * 2)
    # A second failure is a real failure. Let it raise.
    return parse_json_object(raw2), raw2, ms + ms2


def run_stage1(
    db: Session,
    *,
    stem: str,
    options: list[tuple[str, str]],
    correct_labels: list[str],
    is_bonus: bool = False,
    subject: str | None = None,
    passage: str | None = None,
    allow_missing_passage: bool = False,
) -> StageResult:
    """
    The reasoning pass. Produces structured ENGLISH, independent of any target
    language.

    Separated from rendering because its output is reusable: the analysis of a
    question does not change based on whether it will be read in Hindi or
    Gujarati. Running it once and rendering N times instead of running the whole
    pipeline N times removes the single largest cost in the job — stage 1 is
    roughly twice the latency of stage 2 and by far the more expensive call.
    """
    if not allow_missing_passage:
        reason = missing_passage_reason(stem, subject, passage)
        if reason:
            raise MissingPassageError(reason)

    extra = ""
    if is_bonus:
        extra = (
            "\nNOTE: the board accepted ALL options, so every candidate who attempted "
            "this was awarded the mark. Say so, and still explain what was being tested.\n"
        )
    elif len(correct_labels) > 1:
        extra = (
            "\nNOTE: the official key accepts more than one option; any of them scores. "
            "Explain why each accepted option is defensible.\n"
        )

    r1 = reg.resolve(db, "REASON")
    data1, raw1, ms1 = _call_json(
        r1,
        STAGE1_SYSTEM,
        STAGE1_USER.format(
            # The passage goes FIRST and is labelled as the only source. A
            # comprehension answer must come from this text, not from the
            # model recognising the poem.
            passage=(
                "Read this passage. Base every claim on it and on nothing else:\n\n"
                f"{(passage or '').strip()}\n\n"
                if (passage or "").strip()
                else ""
            ),
            stem=stem,
            options="\n".join(f"({label}) {text}" for label, text in options),
            correct="/".join(correct_labels) or "unknown",
            extra=extra,
        ),
    )
    return StageResult(
        data=data1,
        text=raw1,
        provider=f"{r1.name}/{r1.model}",
        role_used=r1.role,
        is_fallback=r1.is_fallback,
        ms=ms1,
    )


def render_stage2(
    db: Session, stage1: StageResult, lang: str, subject: str | None = None
) -> TwoStageResult:
    """Render an existing stage-1 analysis into one language."""
    data1 = stage1.data or {}

    # English needs no rendering pass — stage 1 already wrote it.
    if lang == "en":
        return TwoStageResult(
            lang=lang,
            stage1=stage1,
            stage2=None,
            prose=to_prose(data1),
            mode="two_stage" if not stage1.is_fallback else "single_stage",
            verification={"ok": True, "problems": [], "note": "English needs no rendering stage"},
        )

    language = LANG_NAME.get(lang, "English")
    r2 = reg.resolve(db, "LOCALISE")
    system2 = STAGE2_SYSTEM.format(
        language=language, glossary=glossary_block(db, lang, subject)
    )
    user2 = STAGE2_USER.format(
        language=language, payload=json.dumps(data1, ensure_ascii=False, indent=2)
    )

    data2, raw2, ms2 = _call_json(r2, system2, user2)
    checks = verify(data1, data2)

    # Retry ONCE on a failed check.
    #
    # Measured over 180 runs: 2 failed, both the same way — stage 2 returned a
    # single stub entry ("विकल्प C", one label, no content) in place of three
    # real distractor explanations, and in one case labelled the CORRECT option
    # as a distractor. That is a bad roll rather than a bad prompt: the same
    # input renders correctly on a second attempt.
    #
    # The retry is honest about what it is doing. It re-renders from the SAME
    # stage-1 analysis, so nothing new can be invented, and the second result is
    # only used if it actually passes. If it fails too, the ORIGINAL is kept and
    # stays flagged — quietly shipping whichever attempt looked better would
    # turn a visible failure into an invisible one.
    if not checks.get("ok"):
        retry_data, retry_raw, retry_ms = _call_json(r2, system2, user2)
        retry_checks = verify(data1, retry_data)
        ms2 += retry_ms
        if retry_checks.get("ok"):
            data2, raw2 = retry_data, retry_raw
            retry_checks["note"] = "first render failed the checks; this is a re-render"
            checks = retry_checks
        else:
            checks["problems"] = list(checks.get("problems", [])) + [
                "a second render failed the same checks — needs a human"
            ]

    stage2 = StageResult(
        data=data2,
        text=raw2,
        provider=f"{r2.name}/{r2.model}",
        role_used=r2.role,
        is_fallback=r2.is_fallback,
        ms=ms2,
    )
    return TwoStageResult(
        lang=lang,
        stage1=stage1,
        stage2=stage2,
        prose=to_prose(data2),
        # If either role fell back, the reason/render separation did not happen
        # as designed. Recorded, never inferred later.
        mode="two_stage" if not (stage1.is_fallback or r2.is_fallback) else "single_stage",
        verification=checks,
    )


def explain_two_stage(
    db: Session,
    *,
    stem: str,
    options: list[tuple[str, str]],
    correct_labels: list[str],
    lang: str,
    is_bonus: bool = False,
    subject: str | None = None,
    passage: str | None = None,
    allow_missing_passage: bool = False,
) -> TwoStageResult:
    """
    Reason then render, for a single language.

    Raises LLMError if stage 1 fails. Stage 1 failing means there is no analysis
    to render, and rendering nothing would produce a confident empty explanation.
    """
    stage1 = run_stage1(
        db,
        stem=stem,
        options=options,
        correct_labels=correct_labels,
        is_bonus=is_bonus,
        subject=subject,
        passage=passage,
        allow_missing_passage=allow_missing_passage,
    )
    return render_stage2(db, stage1, lang, subject)


def explain_languages(
    db: Session,
    *,
    stem: str,
    options: list[tuple[str, str]],
    correct_labels: list[str],
    langs: list[str],
    is_bonus: bool = False,
    subject: str | None = None,
    passage: str | None = None,
    allow_missing_passage: bool = False,
) -> dict[str, TwoStageResult]:
    """
    Reason ONCE, render into several languages.

    This is the shape batch generation should use. The analysis of a question is
    the same fact regardless of the language it will be read in, so paying for it
    per language is pure waste: measured here, stage 1 runs ~35s and stage 2
    ~16s, so three languages cost 83s this way against 153s the naive way.

    A language whose rendering fails does not abort the others — it is simply
    absent from the returned mapping, and the caller writes what succeeded.
    """
    stage1 = run_stage1(
        db,
        stem=stem,
        options=options,
        correct_labels=correct_labels,
        is_bonus=is_bonus,
        subject=subject,
        passage=passage,
        allow_missing_passage=allow_missing_passage,
    )
    out: dict[str, TwoStageResult] = {}
    for lang in langs:
        try:
            out[lang] = render_stage2(db, stage1, lang, subject)
        except LLMError:
            continue
    return out


# ---------------------------------------------------------------------------
# Glossary seed
# ---------------------------------------------------------------------------

# Terms that recur across CTET pedagogy and NEET biology, where an unstable
# rendering would be most confusing. Small on purpose: every entry is a
# commitment, and a wrong one is worse than an absent one.
GLOSSARY_SEED: list[dict] = [
    {"term_en": "cell", "term_hi": "कोशिका", "term_gu": "કોષ", "subject": "Biology"},
    {"term_en": "tissue", "term_hi": "ऊतक", "term_gu": "પેશી", "subject": "Biology"},
    {"term_en": "enzyme", "term_hi": "एंजाइम", "term_gu": "ઉત્સેચક", "subject": "Biology"},
    {"term_en": "photosynthesis", "term_hi": "प्रकाश संश्लेषण", "term_gu": "પ્રકાશસંશ્લેષણ", "subject": "Biology"},
    {"term_en": "respiration", "term_hi": "श्वसन", "term_gu": "શ્વસન", "subject": "Biology"},
    {"term_en": "velocity", "term_hi": "वेग", "term_gu": "વેગ", "subject": "Physics"},
    {"term_en": "acceleration", "term_hi": "त्वरण", "term_gu": "પ્રવેગ", "subject": "Physics"},
    {"term_en": "valency", "term_hi": "संयोजकता", "term_gu": "સંયોજકતા", "subject": "Chemistry"},
    # CTET pedagogy — the vocabulary of Paper I and II Part I.
    {"term_en": "cognitive development", "term_hi": "संज्ञानात्मक विकास", "term_gu": "સંજ્ઞાનાત્મક વિકાસ"},
    {"term_en": "constructivism", "term_hi": "रचनावाद", "term_gu": "રચનાવાદ"},
    {"term_en": "scaffolding", "term_hi": "पाड़ (स्कैफोल्डिंग)", "term_gu": "સ્કેફોલ્ડિંગ"},
    {"term_en": "inclusive education", "term_hi": "समावेशी शिक्षा", "term_gu": "સમાવેશી શિક્ષણ"},
    {"term_en": "formative assessment", "term_hi": "रचनात्मक आकलन", "term_gu": "રચનાત્મક મૂલ્યાંકન"},
    {"term_en": "summative assessment", "term_hi": "योगात्मक आकलन", "term_gu": "સરવાળારૂપ મૂલ્યાંકન"},
    {"term_en": "critical thinking", "term_hi": "आलोचनात्मक चिंतन", "term_gu": "વિવેચનાત્મક ચિંતન"},
    {"term_en": "socialization", "term_hi": "समाजीकरण", "term_gu": "સમાજીકરણ"},
    {"term_en": "motivation", "term_hi": "अभिप्रेरणा", "term_gu": "અભિપ્રેરણા"},
    {"term_en": "reinforcement", "term_hi": "पुनर्बलन", "term_gu": "પુનર્બળન"},
]


def seed_glossary(db: Session) -> int:
    added = 0
    for row in GLOSSARY_SEED:
        if db.scalar(select(GlossaryTerm).where(GlossaryTerm.term_en == row["term_en"])):
            continue
        db.add(GlossaryTerm(**row))
        added += 1
    if added:
        db.commit()
    return added

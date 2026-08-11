"""
The tutor chat: grounded answers, in whatever register she wrote in.

THE RETRIEVAL PROBLEM
---------------------
The NCERT corpus is English — 2,550 chunks, 12 of which contain any Devanagari
at all. Retrieval is Postgres full-text search over that English text. So:

    "बाल विकास क्या है ?"     -> websearch_to_tsquery('english', ...) -> 0 rows

Every Hindi and Gujarati question would retrieve nothing and be refused as
ungrounded, which is the worst possible outcome: the corpus DOES contain the
answer, and the student is told it does not because of an encoding mismatch she
had no way to know about.

So the SEARCH STRING is always built in English, by two different routes:

  romanised (Hinglish/Gujlish)
      Strip the Hindi/Gujarati function words. What is left is almost always
      the English technical terms she kept — "mujhe critical thinking samjhao"
      becomes "critical thinking". Deterministic, free, no model.

  native script (Hindi/Gujarati)
      There is no English left to strip, so the query is translated. This is a
      model call inside the retrieval path, which deserves justification:

        * It produces a SEARCH STRING, never content. Nothing it emits reaches
          the student, and nothing it emits can become part of an answer.
        * The retrieved chunks are authentic NCERT either way.
        * Its worst failure is a bad query, which retrieves nothing, which
          refuses — the safe direction.

      That is a different thing from letting a model write an answer or repair
      a source text, and it is the only reason it is allowed here.

GROUNDING IS UNCHANGED
----------------------
Whatever the register, the answer is written only from retrieved extracts, with
inline citations, and refuses when retrieval comes back empty. Replying in
Hinglish does not mean replying more loosely.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from . import providers as reg_mod
from .corpus import SEARCH_ANY_SQL, SEARCH_SQL, or_tsquery
from .llm import LLMError, OpenAICompatProvider
from .userdocs import SEARCH_DOCS_ANY_SQL, SEARCH_DOCS_SQL
from .register import Register, detect, style_instruction, _GUJLISH_WORDS, _HINGLISH_WORDS

# Function words to drop when turning a romanised message into a search query.
# The union of both lists plus the English question scaffolding that carries no
# retrieval signal — "what", "explain" and "tell" match half the corpus.
_STOPWORDS = (
    _HINGLISH_WORDS
    | _GUJLISH_WORDS
    | {
        "what", "which", "who", "why", "how", "when", "where", "is", "are", "was",
        "were", "the", "a", "an", "of", "in", "on", "for", "and", "or", "please",
        "explain", "tell", "give", "describe", "define", "about", "some", "any",
        "do", "does", "did", "can", "could", "would", "should", "i", "you", "it",
        "this", "that", "these", "those", "with", "from", "into", "detail",
        "simple", "example", "answer", "question", "mean", "meaning",
    }
)

# Chat-template scaffolding that leaks into short, low-temperature completions.
# Observed verbatim from sarvam-105b-conversations asked for keywords:
#
#   "photosynthesis process definition arg value arg key assistant think ..."
#
# These are not search terms, and left in they dilute ts_rank badly enough to
# push the genuinely relevant chunk out of the top 4 — the Hindi photosynthesis
# query came back with a passage about bottle gardens.
_SCAFFOLDING = {
    "arg", "args", "value", "values", "key", "keys", "assistant", "system",
    "user", "think", "thought", "tool", "tools", "function", "json", "output",
    "response", "query", "search", "terms", "keywords", "result", "results",
}

TRANSLATE_SYSTEM = """You convert a student's question into an English search query.

Return ONLY the search terms — three to eight English keywords, no sentence, no
punctuation, no explanation. These terms are fed to a full-text search over
NCERT textbooks, so use the vocabulary those books use.

If the question mentions a technical concept, the English name of that concept
is the most important term to include."""


@dataclass
class ChatTurn:
    role: str  # 'user' | 'assistant'
    content: str


@dataclass
class ChatResult:
    reply: str | None
    register: Register
    citations: list[dict] = field(default_factory=list)
    grounded: bool = False
    reason: str | None = None
    query: str = ""
    query_method: str = ""
    provider: str | None = None
    is_fallback: bool = False
    ms: int = 0


def strip_to_terms(message: str) -> str:
    """Drop function words, keep the content terms. No model involved."""
    tokens = re.findall(r"[A-Za-z][A-Za-z\-']*", message.lower())
    kept = [
        t for t in tokens
        if t not in _STOPWORDS and t not in _SCAFFOLDING and len(t) > 2
    ]
    return " ".join(kept)


def build_query(
    db: Session,
    message: str,
    reg: Register,
    history: list[ChatTurn] | None = None,
) -> tuple[str, str]:
    """
    An English search string, plus how it was produced.

    Returning the method matters: a reviewer looking at a bad answer needs to
    know whether retrieval was driven by her own words or by a translation of
    them, because those fail in completely different ways.
    """
    if reg.register in ("en", "hinglish", "gujlish"):
        terms = strip_to_terms(message)
        if terms:
            # A follow-up carries its topic in a pronoun — "aur uska raw
            # material kya hai?" strips to "uska raw material", which has lost
            # the word photosynthesis entirely. Borrowing the terms from her
            # previous question restores it. Done with string handling rather
            # than a rewrite call: a follow-up should not cost a model round
            # trip before the answer has even started.
            if len(terms.split()) <= 4 and history:
                prior = ""
                for turn in reversed(history):
                    if turn.role == "user":
                        prior = strip_to_terms(turn.content)
                        break
                if prior:
                    merged = " ".join(
                        dict.fromkeys((terms + " " + prior).split())
                    )
                    return merged, "stripped function words + prior question"
            return terms, "stripped function words"
        # A romanised message with no English content left — everything was a
        # function word. Fall through to translation rather than searching for
        # nothing.

    # Native script, or a romanised message with nothing left after stripping.
    try:
        resolved = reg_mod.resolve(db, "LOCALISE")
    except reg_mod.NoProviderError:
        # No translator: search the raw message. It will probably retrieve
        # nothing and refuse, which is honest.
        return message, "raw message (no translation provider)"

    client = OpenAICompatProvider.from_resolved(resolved)
    try:
        out = client.complete(TRANSLATE_SYSTEM, message, max_tokens=60, temperature=0.0)
    except LLMError:
        return message, "raw message (translation failed)"

    # Keep only the first few distinct terms. A model asked for keywords will
    # sometimes restate them, and the tail is where scaffolding shows up.
    seen: set[str] = set()
    ordered: list[str] = []
    for t in strip_to_terms(out).split():
        if t in seen:
            continue
        seen.add(t)
        ordered.append(t)
        if len(ordered) >= 6:
            break
    terms = " ".join(ordered)
    if not terms:
        return message, f"translation produced no usable terms ({resolved.name})"
    return terms, f"translated by {resolved.name}"


CHAT_SYSTEM = """You are a study tutor for {exam}, helping one student prepare.

Answer ONLY from the numbered extracts below. Most are NCERT — the official
textbooks the exam is built on. Some may be marked as the student's own
uploaded notes. Both are usable; they are labelled so you can tell them apart.

Rules you must not break:
- If the extracts do not contain the answer, say so plainly and stop. Do not
  fall back on your own knowledge. An answer she cannot trace to a source is
  worse than no answer, because she will revise from it.
- Cite the extract you used inline as [1], [2] and so on.
- Be concise and concrete. No preamble, no markdown headings, no flattery.
- If she asks a follow-up, use the conversation so far for context, but still
  answer only from the extracts.
- Some extracts may be marked as the STUDENT'S OWN NOTES. Those are not official
  textbooks. Use them, but if they disagree with a textbook extract, say so
  plainly and give the textbook's version — she is being examined on the
  textbook, and a quiet merge of the two would hide an error in her notes.

{style}"""


def answer(
    db: Session,
    message: str,
    *,
    history: list[ChatTurn] | None = None,
    exam: str = "CTET",
    subject: str | None = None,
    top_k: int = 4,
    use_documents: bool = True,
) -> ChatResult:
    """One turn of conversation: detect, retrieve, ground, reply."""
    started = time.time()
    reg = detect(message)

    query, method = build_query(db, message, reg, history)

    # Strict first, then relax. websearch_to_tsquery ANDs every term, which is
    # precise for a short query and returns nothing for a long one — so a
    # sentence-shaped question was being refused as ungrounded while the corpus
    # held the answer. Falling back to a ranked OR recovers those without
    # giving up precision on the queries that were already working.
    rows = (
        db.execute(
            SEARCH_SQL, {"q": query, "exam": exam, "subject": subject, "limit": top_k}
        )
        .mappings()
        .all()
    )
    if not rows:
        loose = or_tsquery(query)
        if loose:
            rows = (
                db.execute(
                    SEARCH_ANY_SQL,
                    {"q": loose, "exam": exam, "subject": subject, "limit": top_k},
                )
                .mappings()
                .all()
            )
            if rows:
                method += " -> relaxed to any-term"

    # Her own uploads are searched SEPARATELY and cited under their own label.
    # Merging them into the NCERT result set would make "[2]" mean two
    # different kinds of thing, and the citation stops being checkable.
    doc_rows = []
    if use_documents:
        doc_rows = (
            db.execute(SEARCH_DOCS_SQL, {"q": query, "limit": top_k}).mappings().all()
        )
        if not doc_rows:
            loose_docs = or_tsquery(query)
            if loose_docs:
                doc_rows = (
                    db.execute(SEARCH_DOCS_ANY_SQL, {"q": loose_docs, "limit": top_k})
                    .mappings()
                    .all()
                )
        # Keep the textbooks in the majority. Her notes supplement the official
        # source; they do not replace it, and letting an upload crowd out NCERT
        # would quietly invert which one the answer rests on.
        doc_rows = list(doc_rows)[: max(1, top_k // 2)]

    citations = [
        {
            "n": i + 1,
            "source": "NCERT",
            "sourceKind": "official",
            "subject": r["subject"],
            "class": r["klass"],
            "book": r["book_title"],
            "chapter": r["chapter"],
            "pages": [r["page_from"], r["page_to"]],
            "excerpt": r["content"][:400],
        }
        for i, r in enumerate(rows)
    ]
    citations += [
        {
            "n": len(rows) + j + 1,
            "source": "Your notes",
            "sourceKind": "uploaded",
            "subject": None,
            "class": None,
            "book": r["title"],
            "chapter": None,
            "pages": [r["page_from"], r["page_to"]],
            "excerpt": r["content"][:400],
        }
        for j, r in enumerate(doc_rows)
    ]

    if not rows and not doc_rows:
        # Refusal is a first-class outcome, not an error. She gets told what was
        # searched for, because "nothing found" plus a wrong-looking query is
        # actionable and "nothing found" alone is not.
        return ChatResult(
            reply=None,
            register=reg,
            grounded=False,
            reason="nothing in the NCERT corpus matched this question",
            query=query,
            query_method=method,
            ms=int((time.time() - started) * 1000),
        )

    extracts = "\n\n".join(
        f"[{i + 1}] ({r['book_title']}, class {r['klass']}, {r['chapter']})\n{r['content']}"
        for i, r in enumerate(rows)
    )
    if doc_rows:
        # Labelled in the PROMPT, not only in the response. The model needs to
        # know which extracts are official and which are hers, so that when the
        # two disagree it can say so instead of quietly averaging them — a
        # mistake in her notes is exactly the thing she needs surfaced.
        doc_block = "\n\n".join(
            f"[{len(rows) + j + 1}] (STUDENT'S OWN NOTES — not an official textbook: "
            f"{r['title']}, p. {r['page_from']})\n{r['content']}"
            for j, r in enumerate(doc_rows)
        )
        extracts = f"{extracts}\n\n{doc_block}" if extracts else doc_block

    convo = ""
    for turn in (history or [])[-6:]:
        speaker = "Student" if turn.role == "user" else "You"
        convo += f"{speaker}: {turn.content}\n"

    system = CHAT_SYSTEM.format(exam=exam, style=style_instruction(reg))
    user = (
        (f"Conversation so far:\n{convo}\n" if convo else "")
        + f"NCERT extracts:\n\n{extracts}\n\nStudent's question: {message}"
    )

    try:
        resolved = reg_mod.resolve(db, "CHAT")
    except reg_mod.NoProviderError as e:
        return ChatResult(
            reply=None,
            register=reg,
            citations=citations,
            grounded=True,
            reason=f"no chat provider configured ({e}); citations still returned",
            query=query,
            query_method=method,
            ms=int((time.time() - started) * 1000),
        )

    client = OpenAICompatProvider.from_resolved(resolved)
    try:
        reply = client.complete(
            system, user, max_tokens=resolved.max_tokens, temperature=resolved.temperature
        )
    except LLMError as e:
        reg_mod.record_health(
            db, resolved.id, ok=False, latency_ms=int((time.time() - started) * 1000), error=str(e)
        )
        # Retrieval succeeded, so hand back the citations. She can read the book
        # herself, which is more useful than an error.
        return ChatResult(
            reply=None,
            register=reg,
            citations=citations,
            grounded=True,
            reason=f"generation unavailable ({e}); citations still returned",
            query=query,
            query_method=method,
            ms=int((time.time() - started) * 1000),
        )

    reg_mod.record_health(
        db, resolved.id, ok=True, latency_ms=int((time.time() - started) * 1000), error=None
    )
    return ChatResult(
        reply=reply,
        register=reg,
        citations=citations,
        grounded=True,
        query=query,
        query_method=method,
        provider=f"{resolved.name}/{resolved.model}",
        is_fallback=resolved.is_fallback,
        ms=int((time.time() - started) * 1000),
    )

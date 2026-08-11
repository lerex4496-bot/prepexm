"""
Working out what language — and what REGISTER — a message is written in.

WHY THIS IS NOT A MODEL CALL
----------------------------
The obvious implementation is to ask an LLM "what language is this?". That
would cost a round trip on every message, be non-deterministic, and be
untestable — and it would answer the wrong question anyway. "Hindi" and
"Hinglish" are the same language by any classifier's reckoning, and the whole
point here is to tell them apart:

    "बाल विकास क्या है ?"          -> reply in Hindi
    "bal vikas kya hai bhai"       -> reply in Hinglish, not Devanagari
    "What is child development?"   -> reply in English

Replying in formal Devanagari to someone typing romanised Hindi reads as a
correction. She wrote the way she wrote on purpose.

Script counting plus a function-word list does this exactly, in microseconds,
with no network and no variance. Function words are the right signal for
romanised text because they are the highest-frequency tokens in any sentence
and they are what survives transliteration unchanged — "hai", "kya", "chhe",
"kem" appear in almost every casual sentence and almost never in English.

PER MESSAGE, NOT PER SESSION
----------------------------
She may ask in Hinglish, then paste an English question from a book, then
follow up in Hindi. Locking the conversation to whatever the first message was
gets progressively more wrong. Every message is classified on its own.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Scripts
# ---------------------------------------------------------------------------

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_GUJARATI = re.compile(r"[઀-૿]")
_LATIN = re.compile(r"[A-Za-z]")


# ---------------------------------------------------------------------------
# Romanised markers
# ---------------------------------------------------------------------------

# High-frequency Hindi function words as people actually type them, including
# the common spelling variants — nobody agrees on how to romanise ह.
_HINGLISH_WORDS = {
    "hai", "hain", "hai", "he", "tha", "thi", "the", "hoga", "hogi", "hota", "hoti",
    "kya", "kyu", "kyun", "kyon", "kaise", "kaisa", "kaisi", "kab", "kahan", "kaun",
    "kitna", "kitne", "kitni", "konsa", "kaunsa",
    "nahi", "nahin", "nai", "mat", "mujhe", "muje", "mera", "meri", "mere",
    "tum", "tumhe", "aap", "aapko", "hum", "hume", "humein",
    "aur", "lekin", "par", "phir", "abhi", "yeh", "ye", "woh", "wo", "vah",
    "batao", "bata", "samjhao", "samjha", "chahiye", "karo", "karna", "karta",
    "karti", "hona", "raha", "rahi", "rahe", "liye", "wala", "wali", "sakta",
    "sakte", "bohot", "bahut", "thoda", "acha", "accha", "theek", "thik",
    "kuch", "sab", "bhi", "toh", "to", "se", "ka", "ki", "ke", "ko", "me", "mein",
    "bhai", "yaar", "matlab", "samajh", "padhai", "sawal", "jawab", "prashn",
}

# Gujarati equivalents. "chhe" (છે) is the copula and is as diagnostic as "hai".
_GUJLISH_WORDS = {
    "chhe", "che", "chho", "chu", "chhu", "hatu", "hati", "hase", "thay", "thase",
    "shu", "su", "kem", "kya", "kyare", "kon", "ketlu", "ketla", "kevu", "kevi",
    "nathi", "nai", "mane", "maru", "mari", "mara", "tame", "tamne", "ame", "amne",
    "ane", "pan", "pachi", "ave", "aa", "ae", "tya", "ahi",
    "kaho", "samjavo", "joie", "karo", "karvu", "karta", "hovu", "rahyu",
    "ketlu", "badhu", "thodu", "saru", "barabar", "kai", "badha",
    "bhai", "matlab", "samaj", "abhyas", "prashna", "javab",
}

# Words that are common English AND appear in the lists above. Counting them
# would classify "to me" or "the car" as Hinglish, so they only count when the
# message already has other evidence.
_AMBIGUOUS = {"to", "me", "he", "the", "par", "me", "se", "aa", "ae", "pan", "kya"}


@dataclass(frozen=True)
class Register:
    """How a message was written, and how a reply should be written back."""

    #: 'en' | 'hi' | 'gu' — the underlying language, for retrieval and prompts.
    lang: str
    #: 'en' | 'hi' | 'gu' | 'hinglish' | 'gujlish' — how to WRITE the reply.
    register: str
    #: Rough 0-1 confidence, for logging and for deciding when to just use English.
    confidence: float
    #: What the decision was based on, so a wrong classification is debuggable.
    evidence: str

    @property
    def is_romanised(self) -> bool:
        return self.register in ("hinglish", "gujlish")


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z]+", text.lower())


def detect(text: str) -> Register:
    """
    Classify one message.

    Falls back to English rather than guessing when there is no signal: an empty
    message, a bare number or a formula has no register, and answering it in
    Devanagari because the previous message was Hindi is exactly the per-session
    stickiness this avoids.
    """
    raw = (text or "").strip()
    if not raw:
        return Register("en", "en", 0.0, "empty message")

    deva = len(_DEVANAGARI.findall(raw))
    gujr = len(_GUJARATI.findall(raw))
    latn = len(_LATIN.findall(raw))
    total = deva + gujr + latn

    if total == 0:
        return Register("en", "en", 0.0, "no letters — digits or punctuation only")

    # --- native script present -------------------------------------------
    if deva or gujr:
        indic, lang = (deva, "hi") if deva >= gujr else (gujr, "gu")
        share = indic / total
        # A little Latin inside Indic text is normal — technical terms, an
        # option label, an English word she does not have in Hindi. That is
        # still Hindi, not a mixed register.
        if share >= 0.55:
            return Register(lang, lang, min(1.0, share + 0.2), f"{indic} Indic vs {latn} Latin letters")
        # Genuinely mixed scripts: she is code-switching, so reply that way.
        mixed = "hinglish" if lang == "hi" else "gujlish"
        return Register(lang, mixed, 0.7, f"mixed scripts: {indic} Indic, {latn} Latin")

    # --- pure Latin: romanised Indic, or actual English? ------------------
    tokens = _words(raw)
    if not tokens:
        return Register("en", "en", 0.3, "no word tokens")

    strong_hi = sum(1 for w in tokens if w in _HINGLISH_WORDS and w not in _AMBIGUOUS)
    strong_gu = sum(1 for w in tokens if w in _GUJLISH_WORDS and w not in _AMBIGUOUS)

    # Ambiguous words only count once something unambiguous has been seen.
    if strong_hi:
        strong_hi += sum(1 for w in tokens if w in _AMBIGUOUS and w in _HINGLISH_WORDS)
    if strong_gu:
        strong_gu += sum(1 for w in tokens if w in _AMBIGUOUS and w in _GUJLISH_WORDS)

    hits = max(strong_hi, strong_gu)
    if hits == 0:
        return Register("en", "en", 0.9, "no romanised Indic markers")

    share = hits / len(tokens)
    # One marker in a long English sentence is a loanword, not a register.
    # Two, or a high enough density in a short message, is code-switching.
    if hits < 2 and share < 0.25:
        return Register("en", "en", 0.6, f"only {hits} marker in {len(tokens)} words")

    if strong_gu > strong_hi:
        return Register("gu", "gujlish", min(1.0, 0.5 + share), f"{strong_gu} Gujarati markers in {len(tokens)} words")
    return Register("hi", "hinglish", min(1.0, 0.5 + share), f"{strong_hi} Hindi markers in {len(tokens)} words")


# ---------------------------------------------------------------------------
# Prompt fragments
# ---------------------------------------------------------------------------

_STYLE = {
    "en": "Write in English.",
    "hi": "Write in Hindi, in Devanagari script.",
    "gu": "Write in Gujarati, in Gujarati script.",
    "hinglish": (
        "Write in Hinglish — conversational Hindi typed in the ROMAN alphabet, "
        "the way she wrote to you. Do NOT use Devanagari script. Keep technical "
        "and exam terms in English where that is what a student would say "
        "('critical thinking', not a translated coinage)."
    ),
    "gujlish": (
        "Write in Gujlish — conversational Gujarati typed in the ROMAN alphabet, "
        "the way she wrote to you. Do NOT use Gujarati script. Keep technical "
        "and exam terms in English where that is what a student would say."
    ),
}


def style_instruction(reg: Register) -> str:
    """The line appended to a system prompt telling the model how to reply."""
    return _STYLE.get(reg.register, _STYLE["en"])

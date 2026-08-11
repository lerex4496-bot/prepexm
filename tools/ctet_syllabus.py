"""
The official CTET paper structure — the authority on what subject a question
belongs to.

WHY THIS MODULE EXISTS
----------------------
The parser used to guess the subject from the page text:

    if part and subject is None and txt.isupper() and len(txt) > 8 ...

Two things went wrong with that.

1. The real banner is bilingual — "MATHEMATICS AND SCIENCE / गणित व विज्ञान" —
   so the Hindi branch claimed it before the subject test ever ran. (This is the
   same ordering trap already documented for PART_RE.)
2. With the real banner gone, the next all-caps line won instead. That produced
   `ACF-26-I` (the booklet code in the page footer) and, on pages where a roman
   -numeral question came first, `(1) XXV (2) LXXII` — option text.
   `"(1) XXV (2) LXXII".isupper()` is True, because Python ignores digits and
   punctuation when deciding case.

Result: 369 of 369 questions carried a wrong subject, and the Learn tab listed
booklet codes as study areas.

WHY A BLUEPRINT RATHER THAN A BETTER REGEX
------------------------------------------
CTET publishes the part -> subject -> question-number mapping on the cover of
every booklet, and it has been stable across the 2024 and 2026 sittings we hold.
That makes the subject a *known fact about the paper*, not something to be
recovered from page text. Recovering a known fact is how the booklet code got
in.

The banner is still read, but only to CHECK this table — never to populate it.

VERIFIED against the booklet covers, not from memory:
  content/raw/ctet/feb-2026/p1_01March/SET-1_PAPER-I_ACF-26-I-K.pdf   (cover)
  content/raw/ctet/feb-2026/p2_01March/SET-1_PAPER-II_ACF-26-II-O.pdf (cover)
  content/raw/ctet/dec-2024/paper1_set_H/SED-24-I Eng+Hin HHHH.pdf    (banners)
  content/raw/ctet/dec-2024/paper2_14Dec_set_D/Paper II ...DDDD.pdf   (cover)

Note the languages sit at Parts IV and V, NOT at II and III. Several published
summaries of "the CTET pattern" say otherwise; the booklets do not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Canonical subject names. These strings are what reaches the student, so they
# are written the way CTET writes them.
# ---------------------------------------------------------------------------

CHILD_DEVELOPMENT = "Child Development and Pedagogy"
MATHEMATICS = "Mathematics"
ENVIRONMENTAL_STUDIES = "Environmental Studies"
MATHEMATICS_AND_SCIENCE = "Mathematics and Science"
SOCIAL_STUDIES = "Social Studies / Social Science"
LANGUAGE_I = "Language I"
LANGUAGE_II = "Language II"

CANONICAL_SUBJECTS: frozenset[str] = frozenset(
    {
        CHILD_DEVELOPMENT,
        MATHEMATICS,
        ENVIRONMENTAL_STUDIES,
        MATHEMATICS_AND_SCIENCE,
        SOCIAL_STUDIES,
        LANGUAGE_I,
        LANGUAGE_II,
    }
)


@dataclass(frozen=True)
class Section:
    """One part of a booklet: its subject and the questions it covers."""

    part: str
    subject: str
    first: int
    last: int

    def contains(self, number: int) -> bool:
        return self.first <= number <= self.last


# ---------------------------------------------------------------------------
# The blueprint, keyed by the paper_type used throughout the pipeline.
#
# A Paper II booklet physically contains BOTH streams: Part II (Mathematics and
# Science) and Part III (Social Studies) both cover Q31-90, and a candidate sits
# one or the other. ctet_assemble's `keep_parts` splits the booklet into two
# papers, which is why each stream below lists only its own part.
# ---------------------------------------------------------------------------

BLUEPRINT: dict[str, tuple[Section, ...]] = {
    "CTET_P1": (
        Section("I", CHILD_DEVELOPMENT, 1, 30),
        Section("II", MATHEMATICS, 31, 60),
        Section("III", ENVIRONMENTAL_STUDIES, 61, 90),
        Section("IV", LANGUAGE_I, 91, 120),
        Section("V", LANGUAGE_II, 121, 150),
    ),
    "CTET_P2_MATHSCI": (
        Section("I", CHILD_DEVELOPMENT, 1, 30),
        Section("II", MATHEMATICS_AND_SCIENCE, 31, 90),
        Section("IV", LANGUAGE_I, 91, 120),
        Section("V", LANGUAGE_II, 121, 150),
    ),
    "CTET_P2_SOCSCI": (
        Section("I", CHILD_DEVELOPMENT, 1, 30),
        Section("III", SOCIAL_STUDIES, 31, 90),
        Section("IV", LANGUAGE_I, 91, 120),
        Section("V", LANGUAGE_II, 121, 150),
    ),
}


# ---------------------------------------------------------------------------
# Banner recognition — used ONLY to cross-check the blueprint.
# ---------------------------------------------------------------------------

# The printed banner is bilingual and inconsistently spaced:
#   "CHILD DEVELOPMENT AND PEDAGOGY / बाल विकास व शिक्षाशास्त्र"
#   "MATHEMATICS AND SCIENCE / गणित व विज्ञान"
#   "LANGUAGE I"          (then "ENGLISH" on the next line)
# Take the Latin half and normalise whitespace/case before matching.
_BANNER_ALIASES: dict[str, str] = {
    "child development and pedagogy": CHILD_DEVELOPMENT,
    "mathematics": MATHEMATICS,
    "environmental studies": ENVIRONMENTAL_STUDIES,
    "mathematics and science": MATHEMATICS_AND_SCIENCE,
    "social studies": SOCIAL_STUDIES,
    "social science": SOCIAL_STUDIES,
    "social studies social science": SOCIAL_STUDIES,
    "language i": LANGUAGE_I,
    "language ii": LANGUAGE_II,
}

_NON_LATIN = re.compile(r"[^a-z ]+")


def match_banner(text: str) -> str | None:
    """
    Return the canonical subject a printed banner names, or None.

    None means "this line is not a subject banner" — the caller must then leave
    the subject alone rather than falling back to the text. That refusal is the
    entire point: `ACF-26-I` reaching this function returns None, where the old
    heuristic returned `ACF-26-I`.
    """
    latin = text.split("/")[0]
    normalised = _NON_LATIN.sub(" ", latin.lower())
    normalised = " ".join(normalised.split())
    if not normalised:
        return None
    return _BANNER_ALIASES.get(normalised)


def section_for(paper_type: str, part: str | None, number: int) -> Section | None:
    """
    The authoritative section for a question, or None if it cannot be placed.

    Both the part label AND the question number must agree with the blueprint.
    Requiring both is deliberate: if a future sitting moves the languages back to
    Parts II/III, the two signals disagree, this returns None, and the question
    falls back to "Part N" — visibly unhelpful rather than confidently wrong.
    """
    sections = BLUEPRINT.get(paper_type)
    if not sections:
        return None
    for s in sections:
        if s.part == part and s.contains(number):
            return s
    return None


def subject_for(paper_type: str, part: str | None, number: int) -> str | None:
    s = section_for(paper_type, part, number)
    return s.subject if s else None


def expected_total(paper_type: str) -> int:
    sections = BLUEPRINT.get(paper_type)
    if not sections:
        return 0
    return sum(s.last - s.first + 1 for s in sections)

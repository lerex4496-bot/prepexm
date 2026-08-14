"""
Chanakya (legacy 8-bit Devanagari) -> Unicode Devanagari.

WHY THIS EXISTS
---------------
CBSE sets the Hindi half of the CTET booklets in Chanakya, a pre-Unicode
Devanagari font that draws Devanagari shapes at Latin code points. The PDF
carries no way to recover the meaning:

  * the /Encoding is plain /MacRomanEncoding — code 0xB7 is declared to be
    "summation", and it draws क;
  * the /ToUnicode CMap dutifully maps every code to its LATIN meaning, so
    extraction yields `„Ê‹Ê°Á∑§` where the page says `हालाँकि`;
  * the embedded font's /CharSet is Latin glyph names (/Aacute, /Adieresis)
    reused for Devanagari outlines, so there are no semantic names either.

The information exists only in the glyph outlines. So the table below was read
off the glyphs — rendered from the embedded font itself — cross-checked against
the public Chanakya tables (IIT Delhi AssisTech `chanakya.tsv`,
`hindi-font-converter/js/ch.js`), and then verified WORD BY WORD against images
rendered from our own booklets. See --selftest.

That last step is not ceremony. The public tables are wrong in three places for
this font — 0xB8, 0x24 and 0x55/0xA4 — and each error produced fluent, plausible
Hindi (लडक़ों for लड़कों). Only the images caught them.

SCOPE
-----
Verified against every booklet in the corpus that uses Chanakya: July 2024 P1+P2,
14 Dec 2024 P1+P2, 08 Feb 2026 P1+P2 — 18 booklets, ~979k glyphs, all 120 codes
they use individually checked against a rendering.

NOT Chanakya, and NOT handled here: 15 Dec 2024 P2 and both 07 Feb 2026 papers
are set in SHREE-DEV-0708, a different legacy family needing its own table.
01 March 2026 is Kokila/Mangal Unicode and needs nothing. --scan names any
unsupported legacy font it finds so a booklet full of them cannot be mistaken
for one that simply has no Hindi.

THE FAILURE THIS GUARDS AGAINST
-------------------------------
A wrong mapping is silent. `विरासत` and `विरासव` are both well-formed Devanagari;
nothing downstream can tell them apart, and a student revising from a corrupted
question learns the corruption. So this module refuses to emit anything it
cannot fully account for: `convert()` returns None (leave the Hindi out) rather
than a string it is not sure of, and every conversion is checked for residual
Latin, replacement characters, leftover control placeholders and orphan matras.

An unconverted question is fine. A corrupted one is not.

WHAT IS ACTUALLY HARD
---------------------
Not the character table — the ordering. Legacy fonts store glyphs in DRAWING
order, Unicode stores them in LOGICAL order, and three constructs disagree:

  i-matra   ि is drawn to the LEFT of its consonant, so it is stored BEFORE it.
            `0xE7 0xB7` draws कि and must encode as क + ि, never ि + क. It has
            to hop the whole half-form chain: `ि + स् + थ` is स्थि, not स्ि थ.
  reph      र् is drawn as a hook on top and is stored AFTER the whole cluster,
            matras included. `थ 0xFC` is अर्थ's र्थ — the र् moves to the front.
  rakar     ्र is drawn below and IS stored after the consonant, which already
            matches logical order — so it must NOT be moved.

Half-forms are not composed algorithmically; Chanakya has a distinct glyph per
half-form (0x80 = क्) and, in a quirk that trips up naive tables, the FULL
consonant for some letters is the half-form followed by 0xE6 — `0x87` is ण् and
`0x87 0xE6` is ण, not ण + ा.

USAGE
    from legacy_devanagari import convert_span, open_lossless, iter_legacy_runs

    hindi = convert_span(span["text"], span["font"])   # None => leave it alone

Always go through convert_span, never convert() directly on span text: the
font check is the safety property, because Chanakya parks conjuncts on the
ASCII letters and running English through the table yields well-formed
Devanagari nonsense that no check can catch.

For whole documents, open with open_lossless() and walk iter_legacy_runs() —
plain PyMuPDF extraction both drops glyphs and splits words (see those two
functions for what exactly goes wrong).

    python tools/legacy_devanagari.py --selftest
    python tools/legacy_devanagari.py --scan <pdf> [--limit N]
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata

# --------------------------------------------------------------------------
# Fonts this module knows how to decode.
#
# Deliberately a whitelist of exact family names. Anything else — including
# other legacy Devanagari families that ship in the same booklets (Yogesh,
# Mitra1) — is NOT converted, because their tables are different and a wrong
# table is exactly the silent corruption this module exists to prevent.
# --------------------------------------------------------------------------
LEGACY_FONTS = frozenset({"chanakya", "chanakyabold", "chanakyaitalic"})

# Legacy Devanagari families seen in the CTET corpus that this module does NOT
# handle. Reported by --scan so a booklet full of them is not mistaken for one
# that simply has no Hindi.
#
# SHREE-DEV-0708 is the one that matters. It is a different legacy family with
# a different table, and it is what 15 Dec 2024 P2 and BOTH 07 Feb 2026 papers
# are actually set in — those were assumed to be Chanakya and are not. They
# extract to nothing usable and this module cannot help them; they need their
# own table, derived and validated the same way.
UNSUPPORTED_LEGACY_FONTS = frozenset(
    {"yogesh", "yogeshultrabold", "mitra1", "mitra1bold", "mitra1bolditalic"}
)
UNSUPPORTED_LEGACY_PREFIXES = ("shree-dev", "shreedev", "devlys", "krutidev", "walkman")


def _basename(font: str) -> str:
    """Strip the PDF subset tag (`AGKRAV+Chanakya`) and case."""
    return font.split("+")[-1].strip().lower()


def is_legacy_font(font: str) -> bool:
    """True if `font` is a family this module has a verified table for."""
    return _basename(font) in LEGACY_FONTS


def is_unsupported_legacy_font(font: str) -> bool:
    """True for legacy Devanagari families this module deliberately won't touch."""
    name = _basename(font)
    return name in UNSUPPORTED_LEGACY_FONTS or name.startswith(
        UNSUPPORTED_LEGACY_PREFIXES
    )


# --------------------------------------------------------------------------
# Control placeholders.
#
# The two reordering glyphs are carried through the substitution pass as
# private-use characters so the reorder pass can find them unambiguously — a
# literal `ि` inserted early would be indistinguishable from one that is
# already in the right place.
# --------------------------------------------------------------------------
PRE_I = ""  # 0xE7 — i-matra, drawn left of its consonant
REPH = ""  # 0xFC — र्, drawn on top, stored after the cluster
CONTROLS = PRE_I + REPH

# --------------------------------------------------------------------------
# Multi-byte sequences. Tried first, longest match wins.
#
# Two families of these matter:
#   * `half-form + 0xE6` is the FULL consonant, not consonant + ा. This is the
#     single most damaging thing to get wrong, because 0xE6 is the commonest
#     code in the corpus and the naive reading turns ण into ण्ा everywhere.
#   * vowel and matra compositions Chanakya draws as two pieces (ा + े = ो).
# --------------------------------------------------------------------------
SEQUENCES: dict[tuple[int, ...], str] = {
    # independent vowels drawn as अ + a matra piece
    (0xA5, 0xE6, 0xF2): "ऑ",
    (0xA5, 0xE6, 0xF0): "ओ",
    (0xA5, 0xE6, 0xF1): "औ",
    (0xA5, 0xE6): "आ",
    (0xA7, 0xFC): "ई",
    (0xB0, 0xF0): "ऐ",
    # matras drawn as ा + a second piece
    (0xE6, 0xF0): "ो",
    (0xE6, 0xF1): "ौ",
    (0xE6, 0xF2): "ॉ",
    # half-form + 0xE6 == full consonant
    (0x82, 0xE6): "ग",
    (0x83, 0xE6): "घ",
    (0x86, 0xE6): "ञ",
    (0x87, 0xE6): "ण",
    (0x8B, 0xE6): "न",
    (0x93, 0xE6): "च्च",
    (0x95, 0xE6): "ज़",
    (0x98, 0xE6): "त्र",
    (0x99, 0xE6): "ज्ञ",
    (0x9E, 0xE6): "त्त",
    (0x9F, 0xE6): "श्र",
    (0xB3, 0xE6): "श",
    (0xDB, 0xE6): "झ",
    (0xE0, 0xE6): "श",
    (0xF3, 0xE6): "न्न",
    (0xFF, 0xE6): "क्ष",
    # NOTE: published Chanakya tables list 0xB8 as the FIRST half of nukta
    # digraphs — (0xB8, 0xC7) = ड़ and so on. That is wrong for this font. Here
    # 0xB8 is an ordinary post-base nukta: in all 114 occurrences in the corpus
    # it follows ड or ढ, never precedes them. Encoding it as a lead byte made
    # लड़कों come out as लडक़ों and पढ़ने as पढऩे — real Devanagari, wrong word,
    # exactly the silent failure this module exists to prevent. 0xB8 is a plain
    # single below, and _NUKTA_PAIRS precomposes ड + ़ into ड़.
    # consonant + rakar ligatures drawn as one glyph pair
    (0xC5, 0xFE): "ट्र",
    (0xC7, 0xFE): "ड्र",
    (0xC9, 0xFE): "ढ्र",
    # doubled quotes
    (0xD2, 0xD2): "“",
    (0xD3, 0xD3): "”",
}

# --------------------------------------------------------------------------
# Single-byte table.
#
# 0x55 and 0xA4 deserve a note. Public Chanakya tables call them apostrophes.
# In THIS font they are non-drawing: rendering them from the embedded font
# produces no ink, and they occur only as trailing spacers after stemless or
# narrow glyphs (0x55 after र ट ठ ड छ; 0xA4 after क फ and the े matra) — 10% of
# all codes in the corpus, which is far too many to be quotation marks. They
# are typesetter kerning, and they decode to nothing. Treating them as
# apostrophes would pepper every page with stray quotes.
# --------------------------------------------------------------------------
SINGLES: dict[int, str] = {
    0x20: " ",
    # --- punctuation that Chanakya leaves at its ASCII position ---
    0x21: "!",
    0x28: "(",
    0x29: ")",
    0x2B: "+",
    0x2C: ",",
    0x2D: "-",
    0x2E: ".",
    0x2F: "/",
    0x3A: ":",
    0x3B: ";",
    0x3F: "?",
    0x5B: "[",
    0x5D: "]",
    # --- Devanagari digits sit on the ASCII digits ---
    0x30: "०",
    0x31: "१",
    0x32: "२",
    0x33: "३",
    0x34: "४",
    0x35: "५",
    0x36: "६",
    0x37: "७",
    0x38: "८",
    0x39: "९",
    # --- Latin digits are displaced to v..~ ---
    0x76: "1",
    0x77: "2",
    0x78: "3",
    0x79: "4",
    0x7A: "5",
    0x7B: "6",
    0x7C: "7",
    0x7D: "8",
    0x7E: "9",
    0xAE: "0",
    # --- conjuncts parked on ASCII letters/symbols ---
    0x23: "प्त",
    0x25: "त्न",
    0x40: "ञ्च",
    0x41: "्र",
    0x42: "क्च",
    0x43: "ष्ट",
    0x44: "ष्ठ",
    0x45: "श्व",
    0x46: "स्न",
    0x47: "त्र",
    0x48: "॥",
    0x49: "ढ्ढ",
    0x4A: "छ्व",
    0x4B: "्य",
    0x4C: "रु",
    0x4D: "रू",
    0x4E: "हृ",
    0x4F: "ह्र",
    0x50: "क्क",
    0x51: "क्त",
    0x52: "क्र",
    0x53: "स्",
    0x54: "ञ्ज",
    0x56: "ङ्क",
    0x57: "ङ्ख",
    0x58: "ङ्ग",
    0x59: "ङ्घ",
    0x5E: "ट्ट",
    0x5F: "ट्ठ",
    0x60: "क्व",
    0x61: "ड्ड",
    0x62: "ड्ढ",
    0x63: "ष्",
    0x64: "स्र",
    0x65: "द्ग",
    0x66: "द्घ",
    0x67: "द्द",
    0x68: "द्ध",
    0x69: "द्ब",
    0x6A: "द्भ",
    0x6B: "द्म",
    0x6C: "द्य",
    0x6D: "द्व",
    0x6E: "ठ्ठ",
    0x6F: "श",
    0x70: "श्च",
    0x71: "ह्न",
    0x72: "ह्म्",
    0x73: "ह्य",
    0x74: "ह्ल",
    0x75: "ह्व",
    # --- half-forms (consonant + virama) ---
    0x80: "क्",
    0x81: "ख्",
    0x82: "ग्",
    0x83: "घ्",
    0x84: "ल्ल",
    0x85: "ज्",
    0x86: "ञ्",
    0x87: "ण्",
    0x88: "त्",
    0x89: "थ्",
    0x8A: "ध्",
    0x8B: "न्",
    0x8C: "प्",
    0x8D: "फ्",
    0x8E: "ब्",
    0x8F: "भ्",
    0x90: "म्",
    0x91: "च्",
    0x92: "ज्",
    0x93: "च्च्",
    0x94: "ज्ज्",
    0x95: "ज़्",
    0x98: "त्र्",
    0x99: "ज्ञ्",
    0x9E: "त्त्",
    0x9F: "श्र्",
    0xA6: "ष्ट्व",
    0xA8: "ङ्क्ष",
    0xAF: "ख्न",
    0xB1: "ह्",
    0xB3: "श्",
    0xB5: "द्ब्र",
    0xBA: "ख्र",
    0xC3: "व्",
    0xC4: "य्",
    0xCA: "ज़्",
    0xCB: "ल्",
    0xDB: "झ्",
    0xE0: "श्",
    0xF3: "न्न्",
    0xFF: "क्ष्",
    # --- independent vowels ---
    0xA5: "अ",
    0xA7: "इ",
    0xA9: "उ",
    0xAA: "ऊ",
    0xAB: "ऋ",
    0xAC: "ॠ",
    0xAD: "ऌ",
    0xB0: "ए",
    # --- full consonants ---
    0xB6: "ल",
    0xB7: "क",
    0xB9: "ख",
    0xBB: "ग",
    0xBC: "द",
    0xBE: "ङ",
    0xBF: "च",
    0xC0: "छ",
    0xC1: "ज",
    0xC2: "प",
    0xC5: "ट",
    0xC6: "ठ",
    0xC7: "ड",
    0xC8: "फ",
    0xC9: "ढ",
    0xCC: "त",
    0xCD: "थ",
    0xCE: "द",
    0xCF: "ध",
    0xD5: "ब",
    0xD6: "भ",
    0xD7: "म",
    0xD8: "य",
    0xD9: "न",
    0xDA: "र",
    0xDC: "ल",
    0xDD: "ळ",
    0xDF: "व",
    0xE1: "ष",
    0xE2: "स",
    0xE3: "ह",
    # --- matras ---
    0xD4: "े",
    0xE4: "ु",
    0xE5: "ू",
    0xE6: "ा",
    0xE7: PRE_I,  # reordered below
    0xE8: "ी",
    0xE9: "ु",
    0xEA: "ू",
    0xEB: "ृ",
    0xEC: "ॄ",
    0xED: "ॢ",
    0xF0: "े",
    0xF1: "ै",
    0xF2: "ॅ",
    0xF4: "ो",
    0xF5: "ौ",
    # --- signs ---
    0xA1: "ँ",
    0xA2: "ं",
    0xB4: "ं",
    0xB8: "़",
    0xD0: "।",
    0xD1: ":",
    0xF7: "्",
    0xF8: "॰",
    0xF9: "ऽ",
    0xFD: "्र",  # rakar — already in logical order, do NOT move
    0xFE: "्र",
    # --- reordering glyphs ---
    0xFC: REPH,
    0x5A: REPH + "ं",
    # --- quotes ---
    0xD2: "‘",
    0xD3: "’",
    0xEF: "’",
    # --- non-drawing kerning spacers (see note above) ---
    0x55: "",
    0xA4: "",
    0x24: "़",  # pre-base nukta; see _preprocess
    # --- non-drawing/unused slots observed in the corpus ---
    0xB2: "",
}

CONSONANTS = "क-हक़-य़ॹ-ॿ"
_C = f"[{CONSONANTS}]"
MATRAS = "ा-ौॎॏॕ-ॗॢॣ"
SIGNS = "ऀ-ः"
NUKTA = "़"
VIRAMA = "्"
COMBINING = MATRAS + SIGNS + NUKTA + VIRAMA
_M = f"[{COMBINING}]"

# One orthographic cluster: any run of half-forms, then a base consonant.
CLUSTER = f"(?:{_C}{NUKTA}?{VIRAMA})*{_C}{NUKTA}?"

_RE_ORPHAN = re.compile(f"(?<![{CONSONANTS}ऀ-ः{COMBINING}])[{MATRAS}{VIRAMA}{NUKTA}]")
_RE_LATIN = re.compile(r"[A-Za-z]")

# --------------------------------------------------------------------------
# Post-substitution normalisation, applied in order. These are the fixups the
# two-piece drawing model forces: Chanakya draws ो as ा then े, and it draws
# nukta before the matra it belongs after.
# --------------------------------------------------------------------------
_FIXUPS: list[tuple[re.Pattern[str], str]] = [
    # Order matters: the signs move first. शताब्दियों is drawn ा + ं + े, so
    # until the anusvara is out of the way the ा + े = ो composition below
    # cannot see its two halves and the word keeps a bare ाे.
    (re.compile(f"([{SIGNS}])([{MATRAS}]+)"), r"\2\1"),  # ं must follow its matra
    (re.compile(f"([{MATRAS}]+){NUKTA}"), r"{}\1".format(NUKTA)),  # ़ binds the consonant
    (re.compile("ाै"), "ौ"),  # ा + ै -> ौ
    (re.compile("ाे"), "ो"),  # ा + े -> ो
    (re.compile("ाॅ"), "ॉ"),  # ा + ॅ -> ॉ
    (re.compile("अा"), "आ"),  # अ + ा -> आ
    (re.compile("अो"), "ओ"),  # अ + ो -> ओ
    (re.compile("अौ"), "औ"),  # अ + ौ -> औ
    (re.compile("आॅ"), "ऑ"),  # आ + ॅ -> ऑ
    (re.compile("एे"), "ऐ"),  # ए + े -> ऐ
    (re.compile(f"{VIRAMA}ा"), ""),  # virama + ा : a drawing artefact
    (re.compile("ं{2,}"), "ं"),
]

# Nukta pairs -> the precomposed characters Unicode prefers.
_NUKTA_PAIRS = {
    "क़": "क़",
    "ख़": "ख़",
    "ग़": "ग़",
    "ज़": "ज़",
    "ड़": "ड़",
    "ढ़": "ढ़",
    "फ़": "फ़",
    "य़": "य़",
    "ऩ": "ऩ",
    "ऱ": "ऱ",
    "ऴ": "ऴ",
}


class ConversionError(ValueError):
    """Raised when a string cannot be converted to trustworthy Devanagari."""


# --------------------------------------------------------------------------
# Lossless extraction.
#
# MacRoman round-trips 107 of the 108 codes these booklets use. The exception
# is 0xDB (झ): the ToUnicode CMap has no entry for it, so PyMuPDF emits U+FFFD
# and the byte is gone before this module ever sees it — every occurrence of
# समझना, सुझाव, झूठ in the paper. There is no way to guess it back.
#
# So open_lossless() rewrites the ToUnicode CMap of every legacy font to an
# identity map into the Cyrillic block, making extraction byte-exact. Cyrillic
# is chosen because MacRoman cannot produce it, so the two encodings can be
# told apart with no ambiguity and no flag to pass around.
#
# The patch is in-memory only; the source PDF is never written to.
# --------------------------------------------------------------------------
IDENTITY_BASE = 0x0400


def _identity_cmap() -> bytes:
    lines = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CMapName /LegacyIdentity def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<00> <FF>",
        "endcodespacerange",
    ]
    for start in range(0, 256, 100):
        chunk = range(start, min(start + 100, 256))
        lines.append(f"{len(chunk)} beginbfchar")
        lines += ["<%02X> <%04X>" % (c, IDENTITY_BASE + c) for c in chunk]
        lines.append("endbfchar")
    lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    return "\n".join(lines).encode("latin-1")


def open_lossless(path: str):
    """
    Open a PDF with every legacy-font ToUnicode replaced by an identity map.

    Text extracted from the returned document carries the raw font codes, so no
    character can be silently dropped. Use to_codes() on the result exactly as
    on ordinary extraction — it detects which encoding it is looking at.
    """
    import pymupdf

    doc = pymupdf.open(path)
    cmap = _identity_cmap()
    for xref in range(1, doc.xref_length()):
        try:
            key = doc.xref_get_key(xref, "BaseFont")
        except Exception:
            continue
        if not key or key[0] != "name":
            continue
        if not is_legacy_font(key[1].lstrip("/")):
            continue
        stream = doc.get_new_xref()
        doc.update_object(stream, "<<>>")
        doc.update_stream(stream, cmap, compress=False)
        doc.xref_set_key(xref, "ToUnicode", f"{stream} 0 R")
    return doc


def to_codes(text: str | bytes) -> list[int]:
    """
    Recover the original 8-bit font codes.

    Two input encodings are accepted and distinguished without a flag:

      * text from open_lossless(), where each char is IDENTITY_BASE + code;
      * ordinary PyMuPDF output, which is the /ToUnicode result — for these
        fonts, the MacRoman meaning of each byte. Re-encoding with mac_roman
        inverts that exactly.

    A character that will not round-trip is one the extractor could not map at
    all. It is returned as -1 rather than guessed at, so the checks can refuse
    the whole span.
    """
    if isinstance(text, (bytes, bytearray)):
        return list(text)
    codes: list[int] = []
    for ch in text:
        o = ord(ch)
        if IDENTITY_BASE <= o <= IDENTITY_BASE + 0xFF:
            codes.append(o - IDENTITY_BASE)
            continue
        try:
            codes.append(ch.encode("mac_roman")[0])
        except (UnicodeEncodeError, IndexError):
            codes.append(-1)
    return codes


# The pre-base nukta. Chanakya carries TWO nukta glyphs and they sit on
# opposite sides of their consonant: 0xB8 is drawn after (ड, ढ) and 0x24 is
# drawn before (ज, क, फ — letters where the dot tucks under the left limb).
# Both mean U+093C; only the storage order differs, so 0x24 is swapped past its
# consonant here and both then precompose through _NUKTA_PAIRS.
PRE_NUKTA = 0x24

# The non-drawing kerning spacers. Zero ink, pure advance: 0xA4 supplies the
# rest of क's width, 0x55 the rest of र's. They carry no meaning, but they DO
# land in the middle of two-glyph constructions — शताब्दियों is written
# `ा 0xA4 े`, and with the spacer left in place the ा + े = ो sequence cannot
# match and the output keeps a bare ाे. So they are dropped before any lookup.
_SPACERS = frozenset({0x55, 0xA4})

# Marks the font draws with a width of 10/1000 em — i.e. zero advance, drawn
# back over the consonant. A repeat lands exactly on top of the first and is
# invisible on the page. Typesetting double-strikes do happen (SED-24-II writes
# ऐलुमिनियम as ए + े + े, this booklet writes शुरुआती with two ु), and since the
# reader sees one mark, one is what the text must say.
#
# Restricted to the zero-advance marks on purpose: ा, ि and ी advance the pen,
# so a genuine repeat of those would be VISIBLE on the page and must not be
# quietly collapsed — the checks flag it instead.
_OVERLAY_MARKS = frozenset(
    {0x24, 0xA1, 0xB4, 0xB8, 0xE9, 0xEA, 0xEB, 0xF0, 0xF1, 0xF2, 0xF7, 0xFC, 0xFD, 0xFE}
)


def _preprocess(codes: list[int]) -> list[int]:
    """
    Undo the layout artefacts of drawing order, before any character lookup.

    Spacers first, on their own pass, because everything else has to look at
    ADJACENT codes and a spacer sitting in the middle is exactly what breaks
    the sequence table.

    Then, in one walk:
      * Kerning space — ण is drawn `0x87 (ण्) 0x20 0xE6 (ा)` and घ
        `0x83 0x20 0xE6`. The space is a horizontal tweak between the halves of
        one letter, not a word break. Every such space in the corpus sits
        immediately before 0xE6, and ा can never begin a word, so a space there
        is unambiguously spurious.
      * Double-struck overlay mark — collapsed to one; see _OVERLAY_MARKS.
      * Pre-base nukta — `0x24 0xC1` draws ज़ and must encode as ज + ़.
    """
    codes = [c for c in codes if c not in _SPACERS]
    out: list[int] = []
    seen_marks: set[int] = set()
    i, n = 0, len(codes)
    while i < n:
        c = codes[i]
        if c in _OVERLAY_MARKS:
            # Compared across the whole run of overlay marks, not just the
            # previous code: करेंगे is drawn े ं े, and the two े land on the
            # same spot with the anusvara between them.
            if c in seen_marks:
                i += 1
                continue
            seen_marks.add(c)
        else:
            seen_marks.clear()
        if c == 0x20 and i + 1 < n and codes[i + 1] == 0xE6:
            i += 1
            continue
        if c == PRE_NUKTA and i + 1 < n:
            out.append(codes[i + 1])
            out.append(PRE_NUKTA)
            i += 2
            continue
        out.append(c)
        i += 1
    return out


def _substitute(codes: list[int]) -> tuple[str, list[int]]:
    """Longest-match sequences first, then singles. Returns (text, unknowns)."""
    codes = _preprocess(codes)
    out: list[str] = []
    unknown: list[int] = []
    i, n = 0, len(codes)
    max_seq = max(len(k) for k in SEQUENCES)
    while i < n:
        for size in range(min(max_seq, n - i), 1, -1):
            hit = SEQUENCES.get(tuple(codes[i : i + size]))
            if hit is not None:
                out.append(hit)
                i += size
                break
        else:
            c = codes[i]
            if c in SINGLES:
                out.append(SINGLES[c])
            elif c == -1:
                unknown.append(c)
                out.append("�")
            else:
                unknown.append(c)
                out.append("�")
            i += 1
    return "".join(out), unknown


def _place_i_matra(text: str) -> str:
    """
    Move each pre-base i-matra to after its base consonant.

    The subtlety is the half-form chain: Chanakya writes स्थिति as
    ि + स् + थ + ि + त, and the first ि belongs after थ, not after स्. So the
    scan walks forward through every consonant that is followed by a virama and
    only stops at the base.
    """
    while True:
        i = text.find(PRE_I)
        if i < 0:
            return text
        rest = text[i + 1 :]
        m = re.match(CLUSTER, rest)
        if not m:
            # No base consonant to attach to; drop the ordering marker and let
            # the orphan-matra check decide whether the result is usable.
            text = text[:i] + "ि" + rest
            continue
        j = m.end()
        text = text[:i] + rest[:j] + "ि" + rest[j:]


def _place_reph(text: str) -> str:
    """
    Move each reph to the front of the cluster it sits on.

    The glyph is drawn on top and stored last — after the base consonant AND
    after its matras — so the scan walks left over the matras, then left over
    any half-form chain, and inserts र् at the cluster start.
    """
    while True:
        i = text.find(REPH)
        if i < 0:
            return text
        head, rest = text[:i], text[i + 1 :]
        m = re.search(f"{CLUSTER}{_M}*$", head)
        if not m:
            # इ + reph is ई, an idiom of this font rather than a real cluster.
            if head.endswith("इ"):
                text = head[:-1] + "ई" + rest
                continue
            text = head + "र" + VIRAMA + rest
            continue
        k = m.start()
        if head[k:] == "इ":
            text = head[:k] + "ई" + rest
        else:
            text = head[:k] + "र" + VIRAMA + head[k:] + rest


def _normalise(text: str) -> str:
    for pat, rep in _FIXUPS:
        text = pat.sub(rep, text)
    for pair, single in _NUKTA_PAIRS.items():
        text = text.replace(pair, single)
    return unicodedata.normalize("NFC", text)


def check(text: str) -> list[str]:
    """
    Every way the output can be wrong that is detectable without a human.

    These are cheap and they are the whole point: they turn a silent corruption
    into a refusal.
    """
    problems: list[str] = []
    if "�" in text:
        problems.append("replacement character (unmapped code)")
    for ch in CONTROLS:
        if ch in text:
            problems.append("leftover reordering control U+%04X" % ord(ch))
    latin = _RE_LATIN.findall(text)
    if latin:
        problems.append("residual Latin letters: %s" % "".join(sorted(set(latin))))
    orphan = _RE_ORPHAN.search(text)
    if orphan:
        problems.append(
            "orphan matra U+%04X at %d" % (ord(orphan.group()), orphan.start())
        )
    if re.search(f"{VIRAMA}{VIRAMA}", text):
        problems.append("doubled virama")
    # No Devanagari cluster carries two vowel signs. Two in a row means either a
    # two-piece matra whose halves failed to combine (ाे that should be ो) or a
    # code decoded as a mark it is not — both silent, both worth refusing.
    dup = re.search(f"[{MATRAS}][{MATRAS}]", text)
    if dup:
        problems.append("stacked matras %r at %d" % (dup.group(), dup.start()))
    return problems


def convert(text: str | bytes, strict: bool = True) -> str | None:
    """
    Convert one legacy-font span to Unicode Devanagari.

    Returns None when the result cannot be trusted — the caller should then
    keep the question without its Hindi rather than store something wrong.
    Pass strict=False to get the string plus its problems via convert_verbose.
    """
    result, problems = convert_verbose(text)
    if strict and problems:
        return None
    return result


def convert_verbose(text: str | bytes) -> tuple[str, list[str]]:
    """Same as convert() but always returns (text, problems)."""
    codes = to_codes(text)
    raw, _unknown = _substitute(codes)
    placed = _place_reph(_place_i_matra(raw))
    out = _normalise(placed)
    return out, check(out)


def convert_or_raise(text: str | bytes) -> str:
    out, problems = convert_verbose(text)
    if problems:
        raise ConversionError("; ".join(problems))
    return out


def convert_span(text: str, font: str) -> str | None:
    """
    Convert a span only if its font says the bytes are Chanakya. THE ONE TO USE.

    The font check is not a convenience, it is the safety property. Chanakya
    parks conjuncts on the ASCII letters and Devanagari digits on the ASCII
    digits, so feeding it English produces well-formed Devanagari nonsense that
    every check in this module will happily pass:

        convert("Hello World 2026")  ->  '॥द्गद्यद्यश ङ्खशह्म्द्यस्र २०२६'

    Nothing downstream can detect that. So route span text through here, where
    a non-legacy font returns None and the caller keeps the original.

    Returns None if the font is not a supported legacy family, or if the
    conversion failed its checks.
    """
    if not is_legacy_font(font):
        return None
    return convert(text)


# --------------------------------------------------------------------------
# Self-test.
#
# Every expectation below was READ OFF AN IMAGE. The region of the booklet
# holding each line was rendered at 4-5x, the Devanagari transcribed by eye,
# and only then compared with what this module produces from that line's bytes.
# None of it is copied from a published table — the published tables are where
# three of the bugs came from (see the 0xB8 and 0x55/0xA4 notes above).
#
# Cases are stored as raw font bytes rather than extracted text because one
# code, 0xDB (झ), has no /ToUnicode entry at all and cannot survive a round
# trip through PyMuPDF's ordinary output. MACROMAN_CASES separately exercises
# the path where the caller passes in that ordinary output.
#
# Sources: 08 Feb 2026 Paper II Set-G, 14 Dec 2024 Paper II Set-D,
# July 2024 Paper I Set-A — three booklets, three different subset fonts.
# --------------------------------------------------------------------------
CASES: list[tuple[str, str, str]] = [
    (
        "08Feb-P2 p8 #0",
        "e7b7a4e2e820b7f0a42053b7a4e8d7e620b7a4e6f020d5cedcb7a4da5520c2d8e6"
        "fcdfda5587e620b7f0a420a5d9e9b7eaa4dcd920b7a4e820c2fde7b7fda4d8e620"
        "e3f1d0",
        "किसी के स्कीमा को बदलकर पर्यावरण के अनुकूलन की प्रक्रिया है।",
    ),
    (
        "08Feb-P2 p12 #1",
        "e2d7b7a4e7ffe6d8e6f0b420b7a4e620e2e6d7e6c1e8b7a4da5587e620c2da5520"
        "b7a4e6f0a7fc20d5c7b8e620c2fdd6e6df20d9e3e8b420e3f1d0",
        "समकक्षियों का सामाजीकरण पर कोई बड़ा प्रभाव नहीं है।",
    ),
    (
        "08Feb-P2 p15 #2",
        "b7f0a420e7dcb020e2e3e820b7a4e6da5587e620b7a4e6f020e7d94da4e7c2cc20"
        "b7a4da55cce620e3f13f",
        "के लिए सही कारण को निरूपित करता है?",
    ),
    (
        "08Feb-P2 p29 #3",
        "e7d990d9e7dce7b9cc20b7a4cdd9e6f0b420d7f0b420e2f020e2e3e820b7a4cdd9"
        "20b7a4e620bfd8d920b7a4e8e7c1b0d0",
        "निम्नलिखित कथनों में से सही कथन का चयन कीजिए।",
    ),
    (
        "08Feb-P2 p32 #4",
        "e7dfe7d68bd920cefddfe6f0b420b7f0a420e2e6cd20bfe6da5520c2da55b9d9e7"
        "dcd8e6a120",
        "विभिन्न द्रवों के साथ चार परखनलियाँ ",
    ),
    (
        "08Feb-P2 p34 #5",
        "e7df6ce6e7cdfcd8e6f0b420b7a4e6f020a9e220d5e6f0ccdc20b7f0a420d7e9a1"
        "e320c2da5520a5c253c8a4e8cc20bbe98ed5e6da55e620dcbbe6d9f020b7f0a420"
        "e7dcb020b7a4e3d9e620e7c1e2d7f0b420e3dfe620e3e6f020cccde620a9e220d5"
        "e6f0ccdc20b7a4e6f020a9d5dcccf0",
        "विद्यार्थियों को उस बोतल के मुँह पर अपस्फीत गुब्बारा लगाने के लिए कहना जिसमें हवा हो तथा उस बोतल को उबलते",
    ),
    (
        "08Feb-P2 p35 #6",
        "e7d990d9e7dce7b9cc20d7f0b420e2f020b7a4e6f1d920b0b7a42053cde6d8e820"
        "c2dfd920d9e3e8b420e3f13f2020e2e3e820a99ee6da5520bfe9d9f0b420d1",
        "निम्नलिखित में से कौन एक स्थायी पवन नहीं है?  सही उत्तर चुनें :",
    ),
    (
        "08Feb-P2 p41 #7",
        "b0f0e2e820c1d9c1e6e7ccd8e6a120cde820e7c18be3e6f0b4d9f020c1e6e7cc20"
        "c3d8df53cde620a5e6f1da5520e2d9e6ccd9e820e7e3b4ceea20cfd7fc20cee6f0"
        "d9e6f0b420b7a4e6f020d9b7a4e6da5520e7ced8e6d0",
        "ऐसी जनजातियाँ थी जिन्होंने जाति व्यवस्था और सनातनी हिंदू धर्म दोनों को नकार दिया।",
    ),
    (
        "08Feb-P2 p48 #8",
        "d9e8bff020cee6f020b7a4cdd920e7ceb020bbb020e3f1b42c20a78be3f0b4208a"
        "d8e6d9c2eadffcb7a420c2c9b8f0b420a5e6f1da5520e7ceb020e3e9b020e7dfb7"
        "a4cbc2e6f0b420b7a4e820e2e3e6d8cce620e2f020e2e3e820a99ee6da5520b7a4"
        "e620bfd8d920b7a4daf0b45520d1",
        "नीचे दो कथन दिए गए हैं, इन्हें ध्यानपूर्वक पढ़ें और दिए हुए विकल्पों की सहायता से सही उत्तर का चयन करें :",
    ),
    (
        "08Feb-P2 p65 #9",
        "c2c2e6a7da55e220c2da5520d7e0e6e8d920e2f020c055c2e820e7b7a4cce6d5d0",
        "पपाइरस पर मशीन से छपी किताब।",
    ),
    (
        "08Feb-P2 p67 #10",
        "d6e82024c1e6e7e3da5520d9e3e8b420b7a4da55cce820e3f120e7b7a420bbdce7"
        "ccd8e6a120e7b7a4e2b7f0a4206de6da55e620b7a4e820bba7fc20e3f1b4d020df"
        "e320e7e0e6ffe6e6e7cdfcd8e6f0b420b7a4e6f020a7d920bbdce7ccd8e6f0b420"
        "c2da5520e7dfd7e0e6fc20b7a4da55d9f020b7f0a420e7dcb020d6e8",
        "भी ज़ाहिर नहीं करती है कि गलतियाँ किसके द्वारा की गई हैं। वह शिक्षार्थियों को इन गलतियों पर विमर्श करने के लिए भी",
    ),
    (
        "08Feb-P2 p76 #11",
        "e0e68ece20e2b4c2cee62c20a993e6e6da5587e620a5e6f1da5520c3d8e6b7a4da"
        "5587e620b7a4e620c2fdd8e6f0bb",
        "शब्द संपदा, उच्चारण और व्याकरण का प्रयोग",
    ),
    (
        "08Feb-P2 p77 #12",
        "a58ad8e6c2b7a420b7a4e6f020a5c2d9e820b7a4ffe6e620b7f0a420e7dcb020e7"
        "e0e6ffe687e6e0e6e65398e620e2d7dbe6d9f020b7f0a420e2d7cdfc20d5d9e6d9"
        "e6d0",
        "अध्यापक को अपनी कक्षा के लिए शिक्षणशास्त्र समझने के समर्थ बनाना।",
    ),
    (
        "14Dec-P2 p4 #0",
        "b0b7a420c055e698e620e7e0e6ffe6b7a420e2f020a5e7cfb7a420e2f020a5e7cf"
        "b7a420e2e8b9d9f020b7f0a420e7dcb020b7a4e7c655d920a58ad8d8d920b7a4da"
        "55cce620e3f1d0",
        "एक छात्र शिक्षक से अधिक से अधिक सीखने के लिए कठिन अध्ययन करता है।",
    ),
    (
        "14Dec-P2 p9 #1",
        "dce6f2daf0b455e220b7a4e6f0e3dcd5bbfc20b7f0a420e7e268e6b4cc20b7f0a4"
        "20d5e6daf05520d7f0b420e7d990d9e7dce7b9cc20d7f0b420e2f020b7a4e6f1d9"
        "20e2e620b7a4cdd920e2e3e820e3f13f",
        "लॉरेंस कोहलबर्ग के सिद्धांत के बारे में निम्नलिखित में से कौन सा कथन सही है?",
    ),
    (
        "14Dec-P2 p10 #2",
        "b0b7a420c2e7da55d8e6f0c1d9e620e2e6f1b4c2d9e620e7c1e2d7f0b420c055e6"
        "98e6e6f0b420b7a4e6f020e7b7a4e2e820e7dfe1d820c2da5520c1e6d9b7a4e6da"
        "55e820b7a4e6f020d8e6ce20da55b9d9e620a5e6f1da5520c2fd53cce9cc20b7a4"
        "da55d9e620e3e6f0f0d0",
        "एक परियोजना सौंपना जिसमें छात्रों को किसी विषय पर जानकारी को याद रखना और प्रस्तुत करना हो।",
    ),
    (
        "14Dec-P2 p25 #3",
        "c8a4dc20b7a4e620c280dfd920b0b7a420d6e6f1e7ccb7a420c2e7da55dfccfcd9"
        "20e3f1d0",
        "फल का पक्वन एक भौतिक परिवर्तन है।",
    ),
    (
        "14Dec-P2 p30 #4",
        "e7d9b7fda4e6f0d720b7a4e620a993e620bbdcd9e6b4b7a420a5e6f1da5520e7d9"
        "90d920c2fde7ccda55e6f0cfb7a4cce620e3e6f0cce820e3f1d0",
        "निक्रोम का उच्च गलनांक और निम्न प्रतिरोधकता होती है।",
    ),
    (
        "14Dec-P2 p32 #5",
        "d7e6d9df20e0e6da55e8da5520b7a4e620e2e6d7e68bd820cce6c2d7e6d9",
        "मानव शरीर का सामान्य तापमान",
    ),
    (
        "14Dec-P2 p36 #6",
        "d8e320a5e6b4cee6f0dcd920bbf1da552dd5fde672e687e620c1e6e7ccd8e6f0b4"
        "20e2f020a5e6d8e620e7c18be3e6f0b4d9f020e7e0e6ffe6e620ccb7a420c2e3e9"
        "a1bf20c2fde68ccc20b7a4da5520dce820cde8d0",
        "यह आंदोलन गैर-ब्राह्मण जातियों से आया जिन्होंने शिक्षा तक पहुँच प्राप्त कर ली थी।",
    ),
    (
        "14Dec-P2 p41 #7",
        "b7eba4e1b7a420c2e7da55dfe6da5520b7a4e820a5e6dfe0d8b7a4cce6a5e6f0b4"
        "20b7a4e6f020c2eada55e620b7a4da55d9f020b7f0a420e7dcb020b7a4e820c1e6"
        "cce820e3f1d0",
        "कृषक परिवार की आवश्यकताओं को पूरा करने के लिए की जाती है।",
    ),
    (
        "14Dec-P2 p47 #8",
        "a5c2da55e6e3f7d920b7a4e620e2d7d820e3e6f0bbe620ccd520bbfde8d9e7dfbf"
        "20b7f0a42055c2e7e0bfd720cccde655c2eadffc20d7f0b420b7fda4d7e0e6d120"
        "80d8e620e2d7d820e3e6f0bbe63f",
        "अपराह्न का समय होगा तब ग्रीनविच के पश्चिम तथापूर्व में क्रमश: क्या समय होगा?",
    ),
    (
        "14Dec-P2 p59 #9",
        "c1d920cfd920d8e6f0c1d9e620b7a4e820d7e39edfc2ea87e6fc20e7dfe0e6f0e1"
        "cce6a5e6f0b420b7a4e620df87e6fcd920b7a4e8e7c1b0d0",
        "जन धन योजना की महत्त्वपूर्ण विशेषताओं का वर्णन कीजिए।",
    ),
    (
        "14Dec-P2 p66 #10",
        "bb6ce6b4e0e620b7f0a420a5d9e9e2e6da5520b7a4e6f1d92de2e620dfe680d820"
        "e2e3e820e3f13f",
        "गद्यांश के अनुसार कौन-सा वाक्य सही है?",
    ),
    (
        "14Dec-P2 p75 #11",
        "ccd6e820e2b4d6df20e3f120c1d520e7e0e6ffe6e620d5e3e9cc20e2f020b7a4e6"
        "d8fcb7a4dce6c2e6f0b420b7a4e620a5e6d8e6f0c1d920b7a4daf055d020d8e320"
        "e2d520d2e7df6ce6dcd8d320c1f1e2e820e2b453cde620d7f0b420e2b4d6df20e3"
        "e6f020e2b7a4cce620e3f1d020e7df6ce6dcd8",
        "तभी संभव है जब शिक्षा बहुत से कार्यकलापों का आयोजन करे। यह सब ‘विद्यालय’ जैसी संस्था में संभव हो सकता है। विद्यालय",
    ),
    (
        "14Dec-P2 p77 #12",
        "d6e6e1e620d7e6d9df2099e6e6d920b7f0a420b7e9a4dc20d8e6f0bb20d7f0b420"
        "d8e6f0bbcee6d920cef0cce820e3f1",
        "भाषा मानव ज्ञान के कुल योग में योगदान देती है",
    ),
    (
        "Jul24-P1 p5 #0",
        "c1e6bbebe7cc20b7a4e6f020c2cce620bfdc20bbd8e620e3f120e7b7a420a9e2b7"
        "a4e620b7e9a49ee6e620da5553c555e820b0b7a420bbe6f0cbc755d920e7da55c5"
        "fe55e8dfda5520e3f1d02020c1d520dfe320b0b7a420a5e6f1da5520b7e9a49ee6"
        "f020b7a4e6f020cef0b9cce820e3f120c1e6f020da5553c555e820c1f1e2e6",
        "जागृति को पता चल गया है कि उसका कुत्ता रस्टी एक गोल्डन रिट्रीवर है।  जब वह एक और कुत्ते को देखती है जो रस्टी जैसा",
    ),
    (
        "Jul24-P1 p9 #1",
        "e2e6d7e6e7c1b7a420e2da55e6f0b7a4e6da5520a5e6f1da5520e7dfdff0b7a4",
        "सामाजिक सरोकार और विवेक",
    ),
    (
        "Jul24-P1 p15 #2",
        "b0b7a420ccdc20b7a4e620b0b7a420d6e6bb20e7d94da4e7c2cc20b7a4da55cce6"
        "20e3f1d0",
        "एक तल का एक भाग निरूपित करता है।",
    ),
    (
        "Jul24-P1 p16 #3",
        "e2d6e820a5c2e7da55d7f0d820e2b481d8e6b0a120dfe653cce7dfb7a420e2b481"
        "d8e6b0a120e3e6f0cce820e3f1b4d0",
        "सभी अपरिमेय संख्याएँ वास्तविक संख्याएँ होती हैं।",
    ),
    (
        "Jul24-P1 p19 #4",
        "e7d990d9e7dce7b9cc20d7f0b420e2f020e7b7a4e220a5ffe6da5520b7a4e820b7"
        "a4e6f0a7fc20e2d7e7d7cc20daf055b9e620d9e3e8b420e3f13f",
        "निम्नलिखित में से किस अक्षर की कोई सममित रेखा नहीं है?",
    ),
    (
        "Jul24-P1 p35 #5",
        "e7d990d9e7dce7b9cc20bb6ce6b4e0e620b7a4e6f020c2c9b8b7a4da5520c2eac0"
        "f05520bbb020c2fde0d9e6f0b42028c2fd2ee2b42e20",
        "निम्नलिखित गद्यांश को पढ़कर पूछे गए प्रश्नों (प्र.सं. ",
    ),
    (
        "Jul24-P1 p35 #6",
        "c2fd88d8d820b7a4e620c2fdd8e6f0bb20e7b7a4d8e620c1e620e2b7a4cce620e3"
        "f1d0",
        "प्रत्यय का प्रयोग किया जा सकता है।",
    ),
    (
        "Jul24-P1 p36 #7",
        "bbe6b4cfe82c20e7ccdcb7a42c20e2e9d6e6e12c20c1dfe6e3da5520b7a4e6208c"
        "d8e6da55e620d8e320cef0e0e620e3f12c",
        "गांधी, तिलक, सुभाष, जवाहर का प्यारा यह देश है,",
    ),
    (
        "Jul24-P1 p36 #8",
        "dfd853b7a420d8e620e2e3c2e6c655e820b7f0a420d7e6bbfccee0e6fcd920d7f0"
        "b420e7dcb920dcf0cce820e3f1d02020a7e220c2fdb7a4e6da5520b7f0a420d7e6"
        "bbfccee0e6fcd920b7a4e6f02080d8e620b7a4e3f0b4bbf03f",
        "वयस्क या सहपाठी के मार्गदर्शन में लिख लेती है।  इस प्रकार के मार्गदर्शन को क्या कहेंगे?",
    ),
    (
        "Jul24-P1 p45 #9",
        "d6dcf020e3e820c3d8e6b7a4da55e787e6b7a4204da4c220e2f020e2e3e820d920"
        "e3e6f020c2da5520c2fddfe6e320b7f0a420e2e6cd20d5e6f0dcd9f020b7a4e820"
        "ceffe6cce6d0",
        "भले ही व्याकरणिक रूप से सही न हो पर प्रवाह के साथ बोलने की दक्षता।",
    ),
    (
        "Jul24-P1 p45 #10",
        "d8e320c1e6d9d9f020b7a4e820ceffe6cce620e7b7a420b7f1a4e2f020a5e6f1da"
        "5520b7a4e3e6a120d6e6e1e620b7a4e620a9e7bfcc204da4c220e2f020c2fdd8e6"
        "f0bb20b7a4da55d9e620e3f1d0",
        "यह जानने की दक्षता कि कैसे और कहाँ भाषा का उचित रूप से प्रयोग करना है।",
    ),
    (
        "Jul24-P1 p45 #11",
        "c1d520d6e6e1e62053dfe6d6e6e7dfb7a4204da4c220e2f020e2e8b9e820c1e6cc"
        "e820e3f12c20e7d5d9e620e7b7a4e2e820c3d8dfe753cdcc20a58fd8e6e220b7f0"
        "a42c20ccd520a7e2f02080d8e620b7a4e3e620c1e6cce620e3f13f",
        "जब भाषा स्वाभाविक रूप से सीखी जाती है, बिना किसी व्यवस्थित अभ्यास के, तब इसे क्या कहा जाता है?",
    ),
]

# The same check driven from the MacRoman text PyMuPDF returns without the
# identity-CMap patch, which is how most callers will see it. This is the line
# from the top of this file's docstring.
MACROMAN_CASES: list[tuple[str, str, str]] = [
    (
        "08Feb-P2 macroman path",
        "„Ê‹Ê°Á∑§ ‹ê’Êß¸"
        " •ÊÒ⁄U ‡ÊÊ⁄UËÁ⁄U∑§"
        " ‚¥⁄UøŸÊ",
        "हालाँकि लम्बाई और शारीरिक संरचना",
    ),
]

# Constructs worth pinning down individually, so a regression names the rule it
# broke instead of just failing a sentence.
CONSTRUCT_CASES: list[tuple[str, str, str]] = [
    ("i-matra reorder", "e7b7a4", "कि"),
    ("i-matra over half-form chain", "e753cde7cc", "स्थिति"),
    ("i-matra over conjunct", "e7e0e6ffe6e6", "शिक्षा"),
    ("reph moves to cluster front", "a5cdfc", "अर्थ"),
    ("reph over matra", "b7a4e6d8fca4e6f0b4", "कार्यों"),
    ("rakar stays put (NOT moved)", "c2fdd8e6f0bb", "प्रयोग"),
    ("post-base nukta (ड)", "dcc7b8b7a4e6f0b4", "लड़कों"),
    ("pre-base nukta (ज)", "e724c1dce6", "ज़िला"),
    ("two-piece consonant ण", "b7a4e6da558720e6", "कारण"),
    ("two-piece consonant घ", "8320e6da55f055dcea", "घरेलू"),
    ("half-form + full consonant", "d593e6f0", "बच्चे"),
    ("aa + e composes to o", "b7a4e6f0", "को"),
    ("aa + anusvara + e composes to on", "d8e6b4f0", "यों"),
    ("independent vowel आ", "a5e6", "आ"),
    ("double-struck matra collapses", "b7a4e6f0f0", "को"),
    ("kerning spacers vanish", "da5555b7a4a4", "रक"),
    # The rare conjuncts. Each occurs a handful of times in the whole corpus,
    # which is exactly why they are pinned here: too rare for a random sample
    # to catch a regression, common enough to appear in a real question.
    ("0x23 प्त", "e2b4e7dc23", "संलिप्त"),
    ("0x43 ष्ट", "ceebe743ffe6f098e6", "दृष्टिक्षेत्र"),
    ("0x44 ष्ठ", "c2eb44d6eae7d7d0", "पृष्ठभूमि।"),
    ("0x4E हृ", "4eced8da55e6c1", "हृदयराज"),
    ("0x51 क्त", "da5551a4", "रक्त"),
    ("0x5A reph+anusvara", "dce7d95abb", "लर्निंग"),
    ("0x5E ट्ट", "c25ee8d3", "पट्टी’"),
    ("0x5F ट्ठ", "a7b7a45ff0", "इकट्ठे"),
    ("0x61 ड्ड", "b7a4d561e8", "कबड्डी"),
    ("0x6A द्भ", "e26ae6df", "सद्भाव"),
    ("0x6F श", "6febb4b9dce6", "शृंखला"),
    ("0x71 ह्न", "e7bf71", "चिह्न"),
    ("0x72 ह्म्", "d5fd72e6e6b4c755e8d8", "ब्रह्मांडीय"),
    ("0xE5 ू", "28a7b453c5fee555d7f0b4c555dc29", "(इंस्ट्रूमेंटल)"),
    ("0xF3 न्न्", "e7dfe7d6f3e6", "विभिन्न"),
]


def _load_cases() -> list[tuple[str, str, str]]:
    return CONSTRUCT_CASES + CASES + MACROMAN_CASES


def _case_source(src: str) -> str | bytes:
    """Cases are stored either as raw font bytes (hex) or as extracted text."""
    try:
        return bytes.fromhex(src)
    except ValueError:
        return src


def selftest(verbose: bool = False) -> int:
    cases = _load_cases()
    if not cases:
        print("no self-test cases compiled in", file=sys.stderr)
        return 1
    bad = 0
    for label, src, want in cases:
        got, problems = convert_verbose(_case_source(src))
        ok = got == want and not problems
        if not ok:
            bad += 1
            print(f"FAIL  {label}")
            print(f"  want: {want}")
            print(f"  got : {got}")
            if problems:
                print(f"  flags: {'; '.join(problems)}")
        elif verbose:
            print(f"ok    {label}  {got}")
    total = len(cases)
    print(f"\n{total - bad}/{total} exact ({100.0 * (total - bad) / total:.1f}%)")
    return 1 if bad else 0


def iter_legacy_runs(doc, pages=None):
    """
    Yield (page_no, baseline_y, x0, codes) for each run of legacy-font text on
    a page, in reading order.

    Built on get_texttrace() rather than get_text("dict") on purpose.
    get_text() groups glyphs into blocks and lines, and in these booklets that
    grouping silently DROPS glyphs: the first half of a two-piece घ, drawn at
    x=99.1 on a line whose block starts at x=103.2, does not appear in any span
    at all. The page still renders it; extraction just loses it, and the loss
    reads as a plausible word (घरेलू -> ारेलू) rather than as an error.

    get_texttrace() reports every glyph the renderer draws, with its font and
    origin, so nothing can go missing. Glyphs are grouped by exact baseline and
    ordered by x; a run is broken where the horizontal gap is wide enough to be
    a column boundary rather than a word space (word spaces are explicit 0x20
    codes in the stream, so a positional gap that large is always structural).
    """
    for pno in pages if pages is not None else range(doc.page_count):
        # Group whole texttrace spans by baseline. Glyph order WITHIN a span is
        # left as the renderer emitted it, never re-sorted by x: the zero-width
        # marks (े, ं, reph, rakar) are drawn back over the consonant they
        # belong to, so their origin is to the LEFT of the glyph they follow in
        # the stream. Sorting by x would move े across a word space and turn
        # नीले लिटमस into नील ेलिटमस.
        rows: dict[float, list[tuple[float, float, list[int]]]] = {}
        for span in doc[pno].get_texttrace():
            if not is_legacy_font(span.get("font", "")):
                continue
            size = span.get("size", 10.0)
            by_baseline: dict[float, list[tuple[float, int]]] = {}
            for ch in span.get("chars", []):
                ucs, _gid, origin = ch[0], ch[1], ch[2]
                by_baseline.setdefault(round(origin[1], 2), []).append(
                    (origin[0], ucs)
                )
            for y, items in by_baseline.items():
                # Split where the pen jumps forward by more than an em. Table
                # cells on one row are often drawn by a single text operation,
                # so the gap is the only thing separating two answer options.
                # Compared against the running MAXIMUM x, not the previous
                # glyph's, because the zero-width marks jump backwards.
                codes: list[int] = []
                lo = hi = items[0][0]
                for x, ucs in items:
                    if codes and x > hi + size:
                        rows.setdefault(y, []).append((lo, hi, size, codes))
                        codes, lo = [], x
                    codes.extend(to_codes(chr(ucs)))
                    hi = max(hi, x)
                if codes:
                    rows.setdefault(y, []).append((lo, hi, size, codes))

        for y in sorted(rows):
            pieces = sorted(rows[y])
            run: list[int] = []
            start = pieces[0][0]
            end = start
            size = pieces[0][2]
            prev_end = None
            for x0, x1, sz, codes in pieces:
                # A gap wider than one em is structural — the next table cell or
                # column, not a word space. Word spaces are explicit 0x20 codes
                # in the stream, so they never show up as positional gaps.
                if prev_end is not None and x0 - prev_end > sz and run:
                    yield pno, _box(start, end, y, size), run
                    run, start, size = [], x0, sz
                run.extend(codes)
                prev_end = end = x1 + 0.5 * sz
                size = max(size, sz)
            if run:
                yield pno, _box(start, end, y, size), run


def _box(x0: float, x1: float, baseline: float, size: float):
    """Clip rectangle around a run, padded for matras above and below."""
    return (x0 - 2.0, baseline - 1.15 * size, x1 + 2.0, baseline + 0.5 * size)


def scan(path: str, limit: int) -> int:
    """Convert every legacy run in a PDF and report what the checks caught."""
    doc = open_lossless(path)
    seen = converted = flagged = 0
    unsupported: set[str] = set()
    reasons: dict[str, int] = {}
    unknown_codes: dict[int, int] = {}
    for pno in range(doc.page_count):
        for block in doc[pno].get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    if is_unsupported_legacy_font(span["font"]):
                        unsupported.add(span["font"])
    for pno, _bbox, codes in iter_legacy_runs(doc):
        seen += 1
        for c in codes:
            if c not in SINGLES and not any(c == k[0] for k in SEQUENCES):
                unknown_codes[c] = unknown_codes.get(c, 0) + 1
        out, problems = convert_verbose(bytes(c for c in codes if 0 <= c <= 255))
        if problems:
            flagged += 1
            for p in problems:
                key = p.split(":")[0].split(" at ")[0]
                reasons[key] = reasons.get(key, 0) + 1
            if flagged <= limit:
                print(f"p{pno + 1} FLAG {'; '.join(problems)}")
                print(f"      -> {out}")
        else:
            converted += 1
    print(f"\nruns: {seen}  clean: {converted}  flagged: {flagged}")
    if reasons:
        print("flag reasons:", sorted(reasons.items(), key=lambda kv: -kv[1]))
    if unknown_codes:
        print(
            "unmapped codes:",
            sorted(
                ((f"0x{c:02X}", n) for c, n in unknown_codes.items()),
                key=lambda kv: -kv[1],
            )[:20],
        )
    if unsupported:
        print("legacy fonts present but NOT converted:", sorted(unsupported))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--scan", metavar="PDF")
    ap.add_argument("--limit", type=int, default=15)
    ap.add_argument("--text", help="convert one extracted string")
    args = ap.parse_args()
    if args.text:
        out, problems = convert_verbose(args.text)
        print(out)
        if problems:
            print("FLAGS:", "; ".join(problems), file=sys.stderr)
            return 1
        return 0
    if args.scan:
        return scan(args.scan, args.limit)
    if args.selftest:
        return selftest(args.verbose)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())

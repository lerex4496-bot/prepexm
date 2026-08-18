# SHREE-DEV-0708 — glyph specimen, and the state of this decode

Four CTET sittings are still English-only because their Hindi is set in
SHREE-DEV-0708: 07 Feb 2026 and 08 Feb 2026, Paper I and Paper II.
`tools/legacy_devanagari.py` classifies this font `unsupported` — it decodes
Chanakya, and this is a different mapping.

## What is here

`shreedev.png` / `shreedev.pdf` — 125 distinct byte slots, each cropped from
the ORIGINAL rendered page (not a re-rasterised subset font), so every glyph
shown is exactly what CBSE's renderer draws. Generated with:

    python tools/glyph_specimen.py \
      "content/raw/ctet/feb-2026/p1_07Feb_Set-S/Set-S/Main-S.pdf" \
      --font SHREE --max-pages 14 --out <out>.pdf

## The finding that matters

The context around each cropped glyph reads as correct Devanagari — प्रश्न,
विश्वास, बुद्धि, विद्यार्थि. The PAGE is fine. Only text extraction is
mojibake, because the font draws Devanagari shapes at Latin code points and
carries no semantic glyph names.

That leaves two honest routes, and they are not equal:

1. **Glyph table.** Read all 125 slots off this sheet into a deterministic
   mapping, as was done for Chanakya. Exact and offline once built. Chanakya's
   table was verified code-by-code, 71/71, and 38 decoded lines were checked
   against rendered crops before it was trusted. This deserves the same, and
   that is the cost: 125 slots read carefully, not skimmed.

2. **OCR the rendered page.** The `chandra-ocr` and `pdf-ocr` skills are
   installed for this. Faster, but it swaps a deterministic failure for a
   probabilistic one — OCR misreads Devanagari conjuncts quietly, and a wrong
   मात्रा changes the meaning of a question without looking broken.

## Why neither is half-done here

A partially-read table produces text that looks like Hindi and is wrong. For a
Hindi-medium candidate revising from it, that is worse than the English-only
state these four papers are in now. Whichever route is taken, it gets verified
against rendered crops before a single stem reaches the bundle — the same bar
Chanakya cleared.

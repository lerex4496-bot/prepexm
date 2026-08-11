"""
Assemble a parsed CTET paper + its official answer key into contract-shaped
JSON (see apps/mobile/src/content/contract.ts).

A CTET Paper I key is split across sections:
    PAPER-I MAIN        -> Q1-90   (CDP, Maths, EVS — common to all candidates)
    PAPER-I 01-ENGLISH  -> Q91-150 (Language I & II, for the chosen language)
    PAPER-I 02-HINDI    -> Q91-150 (ditto)

so a complete 150-answer key is MAIN plus exactly one language section.

Everything written here starts life as reviewStatus="pending". Nothing reaches
the app until a human approves it in the Content Review tool — that gate is the
safety net under both the parser and, later, the LLM tagger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ctet_parse import collect_spans, merge_english_lines, parse_questions, validate  # noqa: E402
from ctet_syllabus import subject_for, match_banner
from ctet_key_parse import parse_key  # noqa: E402

import re

DEVA_RE = re.compile(r"[ऀ-ॿ]")


# How a piece of text came to be, recorded per language on every question.
# Nothing downstream may infer provenance — it is always stated.
#   EXACT                  lifted verbatim from a Unicode text layer
#   CONVERTED              recovered from a legacy font via a mapping table
#   OCR_HIGH_CONFIDENCE    OCR'd from a rendered region, above threshold
#   OCR_LOW_CONFIDENCE     OCR'd, below threshold -> mandatory human review
#   TRANSLATED_FALLBACK    machine-translated; last resort, never auto-approved
EXTRACTION_METHODS = (
    "EXACT",
    "CONVERTED",
    "OCR_HIGH_CONFIDENCE",
    "OCR_LOW_CONFIDENCE",
    "TRANSLATED_FALLBACK",
)


def build(
    paper_pdf: Path,
    key_pdf: Path,
    set_code: str,
    language_section: str,
    session_label: str,
    paper_type: str,
    held_on: str,
    main_section: str = "PAPER-I MAIN",
    keep_parts: tuple[str, ...] | None = None,
) -> dict:
    doc = pymupdf.open(paper_pdf)
    questions = parse_questions(merge_english_lines(collect_spans(doc)))
    doc.close()

    # A CTET Paper II booklet physically contains BOTH subject streams —
    # Part II is Mathematics & Science and Part III is Social Science, each
    # numbered 31-90 — because one printed booklet serves both kinds of
    # candidate, who answer one stream. 30 + 60 + 60 + 60 = 210 slots in the
    # booklet but 150 questions for any real candidate, and the official key
    # likewise carries a separate section per stream. So a booklet yields two
    # papers, and each keeps only its own stream's part.
    if keep_parts is not None:
        questions = [q for q in questions if q.part in keep_parts]

    # Cross-check the printed banner against the blueprint. The blueprint wins —
    # it is the paper's published structure — but a disagreement means either the
    # banner was misread or CTET changed the layout, and both need a human. A
    # question the blueprint cannot place gets no subject at all rather than a
    # guess, and shows as "Part N" in the app.
    subject_conflicts: list[dict] = []
    unplaced: list[int] = []
    for q in questions:
        official = subject_for(paper_type, q.part, q.number)
        if official is None:
            unplaced.append(q.number)
            continue
        printed = match_banner(q.subject or "")
        if printed and printed != official:
            subject_conflicts.append(
                {"number": q.number, "part": q.part, "printed": printed, "blueprint": official}
            )

    report = validate(questions, 150)

    sections, legend_ok = parse_key(key_pdf)

    def section(name: str):
        for s in sections:
            if s.section == name and s.set_code == set_code:
                return s
        return None

    main = section(main_section)
    lang = section(language_section)
    if main is None:
        raise SystemExit(f"key has no {main_section!r} for set {set_code}")
    if lang is None:
        raise SystemExit(f"key has no {language_section!r} for set {set_code}")

    key_by_num = {e.number: e for e in main.entries}
    key_by_num.update({e.number: e for e in lang.entries})

    paper_id = hashlib.sha1(
        f"CTET|{session_label}|{paper_type}|{set_code}".encode()
    ).hexdigest()[:12]

    out_questions = []
    joined = unmatched = 0

    for q in questions:
        entry = key_by_num.get(q.number)
        warnings = list(q.warnings)

        if entry is None:
            unmatched += 1
            warnings.append("no answer key entry")
            correct: list[str] = []
            status = "ok"
        else:
            joined += 1
            correct = entry.correct
            status = "bonus" if entry.status == "bonus" else "ok"

        # Hindi is only attached when it is genuinely present as Unicode and
        # split into exactly four options. A partial Hindi block is dropped and
        # flagged rather than half-attached: a question showing three of four
        # options in her language is worse than one showing none.
        hi_ok = bool(q.stem_hi) and len(q.options_hi) == 4
        hi_devanagari = bool(DEVA_RE.search(q.hindi_raw))
        if q.hindi_raw.strip() and not hi_ok:
            warnings.append("hindi block present but not split into 4 options")

        options = []
        for i, o in enumerate(q.options_en):
            text = {"en": o.text}
            if hi_ok and hi_devanagari and i < len(q.options_hi):
                text["hi"] = q.options_hi[i]
            options.append(
                {"label": o.label, "text": text, "isCorrect": o.label in correct}
            )

        stem = {"en": q.stem_en}
        if hi_ok and hi_devanagari:
            stem["hi"] = q.stem_hi

        extraction = {"en": "EXACT"}
        if hi_ok and hi_devanagari:
            extraction["hi"] = "EXACT"
        elif q.hindi_bbox:
            # Legacy-font paper: the Hindi exists on the page but its text layer
            # is not recoverable yet. No method is claimed — the bbox is kept so
            # the backfill task can convert or OCR exactly this region later.
            extraction["hi"] = None

        # Duplicate labels mean an option marker was misread — e.g. a fourth
        # option coming through as "(1)". Check this independently of the key,
        # because a mislabelled option can still coincidentally satisfy the key
        # and would then ship a wrong answer silently.
        labels = [o["label"] for o in options]
        if len(set(labels)) != len(labels):
            warnings.append(f"duplicate option labels: {labels}")

        if entry is not None and not any(o["isCorrect"] for o in options):
            warnings.append(f"key says {'/'.join(correct)} but no such option parsed")

        out_questions.append(
            {
                "id": f"{paper_id}-q{q.number:03d}",
                "groupId": f"{paper_id}-g{q.number:03d}",
                "paperId": paper_id,
                "number": q.number,
                "stem": stem,
                "options": options,
                "extractionMethod": extraction,
                "topicId": "",  # assigned by the LLM tagger, from the syllabus enum
                "difficulty": "medium",
                "sourceType": "PYQ",
                "reviewStatus": "pending",
                "status": status,
                "part": q.part,
                "subject": subject_for(paper_type, q.part, q.number),
                # Shared reading material for comprehension blocks. Present on
                # every question in the block, so a question is never served
                # without the text it asks about.
                "passage": {"en": q.passage_en or None, "hi": q.passage_hi or None},
                "sourcePage": q.page,
                "hindiRegion": (
                    {"page": q.hindi_page, "bbox": list(q.hindi_bbox)}
                    if q.hindi_bbox
                    else None
                ),
                "keyRaw": entry.raw if entry else None,
                "multiKey": bool(entry and entry.multi),
                "warnings": warnings,
            }
        )

    paper = {
        "id": paper_id,
        "examCode": "CTET",
        "paperType": paper_type,
        "sessionLabel": {"en": session_label},
        "heldOn": held_on,
        "setCode": set_code,
        "languages": ["en"],
        "sourceType": "PYQ",
        "reviewStatus": "pending",
        "totalQuestions": len(out_questions),
        "totalMarks": len(out_questions),
        "durationMin": 150,
        "sourcePdf": str(paper_pdf),
        "keyPdf": str(key_pdf),
        "keyLegendVerified": legend_ok,
    }

    bonus = [q["number"] for q in out_questions if q["status"] == "bonus"]
    multi = [q["number"] for q in out_questions if q["multiKey"]]

    return {
        "paper": paper,
        "questions": out_questions,
        "report": {
            **report,
            "subject_conflicts": subject_conflicts,
            "unplaced_questions": unplaced,
            "joined_to_key": joined,
            "unmatched": unmatched,
            "bonus_questions": bonus,
            "multi_key_questions": multi,
            "clean_and_keyed": sum(
                1
                for q in out_questions
                if not q["warnings"] and any(o["isCorrect"] for o in q["options"])
            ),
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper", type=Path, required=True)
    ap.add_argument("--key", type=Path, required=True)
    ap.add_argument("--set", dest="set_code", default="A")
    ap.add_argument("--language-section", default="PAPER-I 01-ENGLISH")
    ap.add_argument("--session", default="July 2024")
    ap.add_argument("--paper-type", default="CTET_P1")
    ap.add_argument("--held-on", default="2024-07-07")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    data = build(
        args.paper,
        args.key,
        args.set_code,
        args.language_section,
        args.session,
        args.paper_type,
        args.held_on,
    )

    print(json.dumps(data["report"], indent=2, ensure_ascii=False))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {args.out}")

    q = next((x for x in data["questions"] if x["number"] == 1), None)
    if q:
        print("\n--- sample: Q1 ---")
        print(f"  {q['stem']['en'][:110]}")
        for o in q["options"]:
            print(f"   {'*' if o['isCorrect'] else ' '} ({o['label']}) {o['text']['en'][:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

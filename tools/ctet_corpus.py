"""
Build the recent-CTET corpus and report it honestly.

Scope is deliberately narrow: the 1 March 2026 sitting first, because those
papers are typeset in Unicode (Kokila) and so yield EXACT Hindi with no
conversion, no OCR and no confidence caveat. The Feb 7/8 sittings and the older
archive are legacy-font papers and are backfill, not critical path.

Every number this prints is measured, not asserted. "Approved" is always 0 here
by construction — approval happens only in the Content Review tool, never in
the pipeline.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ctet_assemble import build  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "content" / "raw" / "ctet"
OUT = ROOT / "content" / "parsed"

# (pdf, key, set, main section, language section, paper type, label, date, keep_parts)
#
# LANGUAGE SECTION MUST MATCH THE LANGUAGE WE PARSE.
# Q91-150 are Language I and Language II, and the booklet prints a separate
# section per offered language with DIFFERENT questions. The parser extracts
# the ENGLISH stream, so the key must come from the *-01-English section.
# Joining against *-02-Hindi silently attaches another language's answers to
# these 60 questions per paper — every one of them wrong, none of them flagged,
# because the shape of the data is still perfectly valid.
TARGETS = [
    (
        "feb-2026/p1_01March/SET-1_PAPER-I_ACF-26-I-K.pdf",
        "keys/mar2026_p1_key.pdf",
        "K",
        "PAPER-I-MAIN",
        "PAPER-I-01-English",
        "CTET_P1",
        "March 2026",
        "2026-03-01",
        None,
    ),
    (
        "feb-2026/p2_01March/SET-1_PAPER-II_ACF-26-II-O.pdf",
        "keys/mar2026_p2_key.pdf",
        "O",
        "PAPER-II-Math & Science",
        "PAPER-II-01-English",
        "CTET_P2_MATHSCI",
        "March 2026",
        "2026-03-01",
        ("I", "II", "IV", "V"),
    ),
    (
        "feb-2026/p2_01March/SET-1_PAPER-II_ACF-26-II-O.pdf",
        "keys/mar2026_p2_key.pdf",
        "O",
        "PAPER-II-Social Science",
        "PAPER-II-01-English",
        "CTET_P2_SOCSCI",
        "March 2026",
        "2026-03-01",
        ("I", "III", "IV", "V"),
    ),
]


def main() -> int:
    papers_discovered = sum(1 for _ in RAW.rglob("*.pdf") if "keys" not in _.parts)
    results = []

    for pdf, key, set_code, main_sec, lang_sec, ptype, label, date, keep in TARGETS:
        p, k = RAW / pdf, RAW / key
        if not p.exists() or not k.exists():
            print(f"! missing {p if not p.exists() else k}")
            continue
        data = build(
            p, k, set_code, lang_sec, label, ptype, date,
            main_section=main_sec, keep_parts=keep,
        )
        out = OUT / f"ctet_{ptype.lower()}_{date}_{set_code}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        results.append((ptype, data, out))

    if not results:
        print("nothing assembled")
        return 1

    print("=" * 68)
    print("RECENT CTET CORPUS — 1 March 2026 (Unicode era)")
    print("=" * 68)
    print(f"papers discovered in archive (all sessions) : {papers_discovered}")
    print(f"papers parsed this run                      : {len(results)}")

    tot_q = tot_4 = tot_keyed = tot_flag = 0
    tot_hi_exact = 0
    methods: Counter[str] = Counter()
    bonus_all: list[tuple[str, int]] = []
    multi_all: list[tuple[str, int]] = []

    for ptype, data, out in results:
        qs = data["questions"]
        four = sum(1 for q in qs if len(q["options"]) == 4)
        keyed = sum(1 for q in qs if any(o["isCorrect"] for o in q["options"]))
        flagged = sum(1 for q in qs if q["warnings"])
        hi_exact = sum(1 for q in qs if q["extractionMethod"].get("hi") == "EXACT")
        for q in qs:
            methods[f"en={q['extractionMethod'].get('en')}"] += 1
            methods[f"hi={q['extractionMethod'].get('hi')}"] += 1
        bonus_all += [(ptype, n) for n in data["report"]["bonus_questions"]]
        multi_all += [(ptype, n) for n in data["report"]["multi_key_questions"]]

        print()
        print(f"--- {ptype}  (set {data['paper']['setCode']}, {data['paper']['heldOn']})")
        print(f"    source            : {Path(data['paper']['sourcePdf']).name}")
        print(f"    key               : {Path(data['paper']['keyPdf']).name}  legend={data['paper']['keyLegendVerified']}")
        print(f"    questions parsed  : {len(qs)} / 150")
        print(f"    options complete  : {four}")
        print(f"    keys joined       : {keyed}")
        print(f"    Hindi EXACT       : {hi_exact}")
        print(f"    flagged           : {flagged}")
        print(f"    -> {out.name}")

        tot_q += len(qs)
        tot_4 += four
        tot_keyed += keyed
        tot_flag += flagged
        tot_hi_exact += hi_exact

    print()
    print("=" * 68)
    print("TOTALS")
    print("=" * 68)
    print(f"  questions parsed        : {tot_q}")
    print(f"  options complete (4/4)  : {tot_4}")
    print(f"  keys joined             : {tot_keyed}")
    print(f"  Hindi EXACT (Unicode)   : {tot_hi_exact}")
    print(f"  flagged for review      : {tot_flag}")
    print(f"  clean (no flags)        : {tot_q - tot_flag}")
    print()
    print("  extraction-method distribution:")
    for k, v in sorted(methods.items()):
        print(f"    {k:26} {v}")
    print()
    print(f"  bonus questions (Z=ALL, free mark) : {len(bonus_all)} {bonus_all}")
    print(f"  multi-key questions                : {len(multi_all)} {multi_all}")
    print()
    print("  APPROVED questions      : 0   (approval happens only in Content Review)")
    print(f"  remaining review queue  : {tot_q}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

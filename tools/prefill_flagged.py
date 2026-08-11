"""
Pre-fill option text for the flagged CTET March-2026 questions.

WHY THESE NEEDED HAND TRANSCRIPTION
-----------------------------------
Every question here sets its options as stacked mathematical layout (fractions,
sub/superscripts) or spans a column break, so the PDF text layer yields
fragments — often just the literal marker "(2)" — rather than option content.
No amount of parser tuning recovers a fraction that was never a text run; the
content was read off the rendered source page.

WHAT THIS DOES AND DOES NOT DECIDE
----------------------------------
It fills option TEXT and repairs broken STEMS only.

Correctness is NOT a judgement call made here: `is_correct` is recomputed
strictly from the official CBSE key already stored on the question
(`key_raw`), through the printed legend A=1,2 / B=1,3 / ... / Z=ALL. So the
mark scheme still comes from CBSE, and this file only supplies the text that
CBSE printed alongside it.

Everything goes through the PATCH API, so every field lands in the audit trail
with its previous value, and each question stays `pending` — a human still
approves it in the review tool.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:8008"

# Transcribed from the official rendered pages. Fractions written inline.
# (paper_type, number) -> {stem, options[4], stem_hi, options_hi}
PREFILL: dict[tuple[str, int], dict] = {
    ("CTET_P1", 41): {
        "stem": (
            "Ravi gives one-fourth of a pizza to Sonu and one-third of the remaining pizza "
            "to Priya. He then distributes the remaining pizza equally to Anu, Bobby and "
            "Cheema. What fraction of the whole pizza does Cheema get ?"
        ),
        "options": ["1/6", "1/12", "1/9", "5/36"],
        "options_hi": ["1/6", "1/12", "1/9", "5/36"],
    },
    ("CTET_P2_MATHSCI", 32): {
        "stem": "Which of the following is not written correctly in Roman Numerals ?",
        "options": ["XXV", "LXXII", "LXIII", "VXII"],
        "options_hi": ["XXV", "LXXII", "LXIII", "VXII"],
    },
    ("CTET_P2_MATHSCI", 33): {
        "stem": "If (5 - 7x)/(8 + 3x) = -40/7, then what is the value of (2x + 3)/(x + 9) ?",
        "options": ["-7/4", "11/13", "-5/2", "13/14"],
        "options_hi": ["-7/4", "11/13", "-5/2", "13/14"],
    },
    ("CTET_P2_MATHSCI", 39): {
        "stem": "5/7 of 35/12 ÷ 28/9 + 96/15 ÷ 8/5 × 3/4 - 7/56 is equal to :",
        "options": ["6 9/16", "3 9/16", "6 61/112", "3 61/112"],
        "options_hi": ["6 9/16", "3 9/16", "6 61/112", "3 61/112"],
    },
    ("CTET_P2_MATHSCI", 49): {
        "stem": (
            "ABC is a right triangle, right-angled at B. D and E are points on side AB such "
            "that AD = DE = EB. Then, (DC² - BC²)/(AC² - EC²) is equal to :"
        ),
        "options": ["2/5", "4/9", "1/3", "1/2"],
        "options_hi": ["2/5", "4/9", "1/3", "1/2"],
    },
    ("CTET_P2_MATHSCI", 50): {
        "stem": (
            "Numbers from 8 to 92 were written on paper slips (one number on one slip) and "
            "were kept in a box. Then, a slip was taken out from the box, without looking "
            "into it. What is the probability that the number on the slip will be a "
            "multiple of 7 ?"
        ),
        "options": ["12/85", "13/84", "1/7", "13/85"],
        "options_hi": ["12/85", "13/84", "1/7", "13/85"],
    },
    ("CTET_P2_MATHSCI", 79): {
        "stem": (
            "Which of the following options about Reaction I (R1) and Reaction II (R2) are "
            "correct ?  Reaction I (R1) : Reaction of slaked lime with carbon dioxide.  "
            "Reaction II (R2) : Heating of calcium bicarbonate."
        ),
        "options": [
            "R1 - Exothermic, R2 - Combination",
            "R1 - Endothermic, R2 - Exothermic",
            "R1 - Decomposition, R2 - Endothermic",
            "R1 - Exothermic, R2 - Decomposition",
        ],
    },
    ("CTET_P2_MATHSCI", 122): {
        "stem": (
            "Digital technologies can help in solving the major challenges of : "
            "A. Poverty  B. Climate change  C. Price surge  D. Paperless green offices. "
            "Choose the most appropriate combination of alternatives, as highlighted in "
            "the passage"
        ),
        "options": ["A, B, D", "B, C, D", "A, B, C", "A, C, D"],
    },
    ("CTET_P2_SOCSCI", 122): {
        "stem": (
            "Digital technologies can help in solving the major challenges of : "
            "A. Poverty  B. Climate change  C. Price surge  D. Paperless green offices. "
            "Choose the most appropriate combination of alternatives, as highlighted in "
            "the passage"
        ),
        "options": ["A, B, D", "B, C, D", "A, B, C", "A, C, D"],
    },
}

LABELS = ["A", "B", "C", "D"]

# The legend printed on every CBSE answer key.
KEY_LABELS: dict[str, list[str]] = {
    "1": ["A"], "2": ["B"], "3": ["C"], "4": ["D"],
    "A": ["A", "B"], "B": ["A", "C"], "C": ["A", "D"],
    "D": ["B", "C"], "E": ["B", "D"], "F": ["C", "D"],
    "Z": ["A", "B", "C", "D"],
}


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path, data=data, method=method,
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or "{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = ap.parse_args()

    pending = api("GET", "/api/queue?status=pending&limit=2000")["items"]
    index = {(i["paperType"], i["number"]): i["id"] for i in pending}

    done = missing = 0
    for (ptype, num), spec in sorted(PREFILL.items()):
        qid = index.get((ptype, num))
        if not qid:
            print(f"  -- {ptype} Q{num}: not in pending queue, skipping")
            missing += 1
            continue

        q = api("GET", f"/api/questions/{qid}")
        key_raw = q["answerKey"]["raw"]
        correct = KEY_LABELS.get(key_raw or "", [])
        if not correct:
            print(f"  !! {ptype} Q{num}: no usable official key ({key_raw!r}) — skipped")
            missing += 1
            continue

        opts = {
            LABELS[i]: {
                "en": spec["options"][i],
                "hi": (spec.get("options_hi") or [None] * 4)[i],
                # Correctness comes from the official key, never from this file.
                "isCorrect": LABELS[i] in correct,
            }
            for i in range(4)
        }

        print(f"  {ptype} Q{num}  key='{key_raw}' -> correct {correct}")
        for lab in LABELS:
            mark = "*" if opts[lab]["isCorrect"] else " "
            print(f"     {mark}({lab}) {opts[lab]['en']}")

        if args.apply:
            api("PATCH", f"/api/questions/{qid}", {
                "actor": "prefill:source-transcription",
                "stem_en": spec["stem"],
                "options": opts,
            })
            v = api("GET", f"/api/questions/{qid}/validate")
            print(f"     -> approvable={v['approvable']} {v['problems'] or ''}")
        done += 1
        print()

    print(f"{'applied' if args.apply else 'dry run'}: {done} questions, {missing} skipped")
    if not args.apply:
        print("re-run with --apply to write (every change is audited; status stays pending)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

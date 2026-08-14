"""
Deterministic quality gate over parsed papers, before any judgement is applied.

WHY THIS RUNS FIRST
-------------------
Review is the last thing standing between a parsing bug and a student revising
from a wrong answer. Most of what review has to catch is not a matter of
opinion at all — a question with three options, an empty stem, a stem that
appears twice, an answer with no official key behind it. Those are facts about
the data, and a check that computes them is more reliable than any reader,
human or model, going question by question and getting tired.

So this sorts every parsed question into three buckets:

    BLOCK   definitively broken — never ships, no judgement needed
    JUDGE   nothing provably wrong, but something a reader must look at
    PASS    clears every mechanical check

The point is to make the JUDGE pile small and real. Sending 4,000 questions to
a reviewer produces rubber-stamping; sending the few hundred that actually look
odd produces review.

WHAT THIS DELIBERATELY DOES NOT DO
----------------------------------
It never decides an answer. Answer keys come from CBSE's published final key,
decoded deterministically (tools/verify_keys.py), and nothing here — and no
model anywhere in this pipeline — is permitted to overrule that. A question
whose key is missing is BLOCKed, not guessed.

It also does not rewrite text. A garbled stem is reported, never repaired.

Usage:
    python tools/review_gate.py
    python tools/review_gate.py --paper-type CTET_P2_SOCSCI
    python tools/review_gate.py --out content/review/judge.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
PARSED = ROOT / "content" / "parsed"
DEFAULT_OUT = ROOT / "content" / "review" / "judge.json"

# A stem shorter than this is not a question. Real CTET stems run 40-400 chars;
# 15 is comfortably below any genuine one and above a fragment like "Q. 31".
MIN_STEM = 15
MAX_STEM = 2000
MIN_OPTION = 1

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
# U+FFFD is what a failed decode leaves behind. The private-use range is where
# broken font mappings dump glyphs that render as boxes on the phone.
MOJIBAKE = re.compile(r"[�-]")


def norm(text: str) -> str:
    """Normalised form for duplicate comparison: case, spacing and marks only."""
    t = unicodedata.normalize("NFKC", text or "").lower()
    t = re.sub(r"[^\wऀ-ॿ]+", " ", t)
    return " ".join(t.split())


def text_of(blob: dict | None, lang: str = "en") -> str:
    if not isinstance(blob, dict):
        return ""
    return (blob.get(lang) or "").strip()


def check(q: dict) -> tuple[str, list[str]]:
    """Return (verdict, reasons). Verdict is BLOCK, JUDGE or PASS."""
    blocks: list[str] = []
    judges: list[str] = []

    stem_en = text_of(q.get("stem"), "en")
    stem_hi = text_of(q.get("stem"), "hi")
    stem = stem_en or stem_hi
    options = q.get("options") or []

    # ── facts that make a question unusable ────────────────────────────────
    if not stem:
        blocks.append("empty stem")
    elif len(stem) < MIN_STEM:
        blocks.append(f"stem too short ({len(stem)} chars)")

    if len(options) != 4:
        blocks.append(f"{len(options)} options, expected 4")

    correct = [o for o in options if o.get("isCorrect")]
    if not correct:
        blocks.append("no official answer key joined")

    texts = [text_of(o.get("text"), "en") or text_of(o.get("text"), "hi") for o in options]
    if any(len(t) < MIN_OPTION for t in texts):
        blocks.append("an option is empty")
    elif len({norm(t) for t in texts}) != len(texts):
        blocks.append("duplicate option text")

    # ── things a reader has to decide ──────────────────────────────────────
    if stem and len(stem) > MAX_STEM:
        judges.append(f"stem unusually long ({len(stem)} chars)")
    if MOJIBAKE.search(stem) or any(MOJIBAKE.search(t) for t in texts):
        judges.append("contains replacement or private-use characters")
    if not q.get("subject"):
        judges.append("no subject assigned by the blueprint")
    for w in q.get("warnings") or []:
        judges.append(f"parser warning: {w}")

    # A comprehension question without its passage cannot be answered at all.
    if re.search(r"\b(passage|extract|poem|following (text|lines))\b", stem, re.I):
        if not (q.get("passage") or {}):
            judges.append("refers to a passage but none was captured")

    if blocks:
        return "BLOCK", blocks
    if judges:
        return "JUDGE", judges
    return "PASS", []


def pick_one_set_per_sitting(files: list[Path], paper_type: str | None) -> list[Path]:
    """
    One file per (paper type, exam date) — the sets are the same paper reshuffled.

    CBSE prints four sets of every paper: identical questions in a different
    order, so candidates sitting side by side cannot copy. Set O and set P of
    01 March are the SAME 150 questions. Importing all four would quadruple the
    bank with nothing new in it, and would hand her the same question four times
    in one practice session.

    It also makes duplicate detection meaningless: every question legitimately
    appears in three other files, so everything looks like a duplicate and the
    signal that matters — a question genuinely repeated across DIFFERENT
    SITTINGS — is buried.

    Where several files describe the same sitting, the one with the most
    questions carrying an official answer wins.
    """
    groups: dict[tuple[str, str], list[tuple[int, Path]]] = defaultdict(list)
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        paper = data.get("paper") or {}
        ptype, held = paper.get("paperType"), paper.get("heldOn")
        if not ptype or not held:
            continue
        if paper_type and ptype != paper_type:
            continue
        keyed = sum(
            1
            for q in data.get("questions") or []
            if any(o.get("isCorrect") for o in q.get("options") or [])
        )
        groups[(ptype, held)].append((keyed, f))

    chosen: list[Path] = []
    for (ptype, held), members in sorted(groups.items()):
        members.sort(key=lambda m: (-m[0], m[1].name))
        chosen.append(members[0][1])
        if len(members) > 1:
            dropped = ", ".join(p.stem.replace("ctet_", "") for _k, p in members[1:])
            print(f"  {ptype} {held}: using {members[0][1].stem.replace('ctet_', '')} "
                  f"({members[0][0]} keyed); same sitting also parsed as {dropped}")
    if chosen:
        print()
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper-type", help="e.g. CTET_P2_SOCSCI")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    files = pick_one_set_per_sitting(sorted(PARSED.glob("*.json")), args.paper_type)
    verdicts: Counter[str] = Counter()
    per_paper: dict[str, Counter] = defaultdict(Counter)
    judge_items: list[dict] = []
    block_items: list[dict] = []
    seen: dict[str, str] = {}
    dupes = 0
    no_hindi: Counter[str] = Counter()

    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            print(f"! {f.name}: unreadable — {e}")
            continue
        paper = data.get("paper") or {}
        if not paper.get("paperType"):
            continue
        if args.paper_type and paper["paperType"] != args.paper_type:
            continue

        label = f.stem.replace("ctet_", "")
        for q in data.get("questions") or []:
            verdict, reasons = check(q)

            # Duplicates are judged ACROSS papers, so the same question
            # reappearing in another set is caught rather than counted twice.
            stem_key = norm(text_of(q.get("stem"), "en") or text_of(q.get("stem"), "hi"))
            if verdict != "BLOCK" and stem_key and len(stem_key) > 30:
                if stem_key in seen and seen[stem_key] != label:
                    dupes += 1
                    reasons = [*reasons, f"same stem as {seen[stem_key]}"]
                    verdict = "JUDGE" if verdict == "PASS" else verdict
                else:
                    seen.setdefault(stem_key, label)

            if not text_of(q.get("stem"), "hi"):
                no_hindi[label] += 1

            verdicts[verdict] += 1
            per_paper[label][verdict] += 1
            if verdict in ("JUDGE", "BLOCK"):
                item = {
                    "paper": label,
                    "paperType": paper["paperType"],
                    "questionId": q.get("id"),
                    "number": q.get("number"),
                    "subject": q.get("subject"),
                    "verdict": verdict,
                    "reasons": reasons,
                    "stem": text_of(q.get("stem"), "en")[:400],
                    "stemHi": text_of(q.get("stem"), "hi")[:400],
                    "options": [
                        {
                            "label": o.get("label"),
                            "en": text_of(o.get("text"), "en")[:200],
                            "hi": text_of(o.get("text"), "hi")[:200],
                            "isCorrect": bool(o.get("isCorrect")),
                        }
                        for o in (q.get("options") or [])
                    ],
                    "keyRaw": q.get("keyRaw"),
                }
                (judge_items if verdict == "JUDGE" else block_items).append(item)

    total = sum(verdicts.values())
    print(f"{'paper':44} {'PASS':>6} {'JUDGE':>6} {'BLOCK':>6}  no-hi")
    print("-" * 76)
    for label in sorted(per_paper):
        c = per_paper[label]
        print(
            f"{label:44} {c['PASS']:>6} {c['JUDGE']:>6} {c['BLOCK']:>6}  {no_hindi[label]:>5}"
        )
    print("-" * 76)
    print(
        f"{'TOTAL':44} {verdicts['PASS']:>6} {verdicts['JUDGE']:>6} {verdicts['BLOCK']:>6}"
    )
    print()
    if total:
        print(
            f"{total} questions · {verdicts['PASS'] / total:.1%} clear every mechanical check "
            f"· {verdicts['JUDGE']} need a reader · {verdicts['BLOCK']} cannot ship"
        )
    print(f"{dupes} questions repeat a stem seen in another paper (sets are reshuffles)")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"judge": judge_items, "block": block_items}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nwrote {args.out.relative_to(ROOT)} — {len(judge_items)} to judge, {len(block_items)} blocked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

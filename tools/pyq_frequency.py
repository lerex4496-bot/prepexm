"""
What actually comes up — measured, not claimed.

WHY THIS EXISTS
---------------
Every coaching source sells a list of "most important topics". Almost none of
them show their working, and a student revising 23 days out has to take it on
faith. We hold six real sittings of her exact paper with the board's own answer
keys, so the honest version is available: count what the examiners actually set.

This produces two things she can act on tonight:

  1. TOPIC FREQUENCY — which of the 53 official syllabus topics appear most
     across sittings, so revision goes in the order the paper rewards.
  2. REPEATED QUESTIONS — items that recur across DIFFERENT sittings, near
     word-for-word. These are the cheapest marks on the paper.

WHAT IT DOES NOT DO
-------------------
It does not predict the September paper. Nobody can, and anyone selling that is
guessing. Frequency across six sittings is evidence about what the board keeps
testing; it is not a leak. Said plainly here so the app never implies otherwise.

TWO CORRECTIONS BUILT IN
------------------------
- Counts by SITTING, not by paper. CBSE prints four shuffled sets of each paper;
  counting sets would multiply every topic by however many sets were imported
  and quietly rank the over-imported sittings highest.
- Near-duplicate detection is on normalised stems, so "Which of the following
  is..." vs "Which one of the following is..." still counts as the same item.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from ctet_sst_syllabus import BY_ID  # noqa: E402

DB = ROOT / "apps" / "mobile" / "assets" / "content" / "studymate.db"
OUT = ROOT / "content" / "review" / "frequency.json"

# Two stems this similar are the same question reworded. Set from inspection:
# genuine repeats across sittings score well above this, unrelated questions on
# one topic score well below.
SIMILAR = 0.82


def norm(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "").lower())
    # Boilerplate that varies between sittings without changing the question.
    text = re.sub(r"^(which (one )?of the following|read the following|consider the following)", "", text)
    return re.sub(r"[^a-z0-9 ]", "", text).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper-type", default="CTET_P2_SOCSCI")
    ap.add_argument("--top", type=int, default=20)
    args = ap.parse_args()

    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        """SELECT q.id, q.stem_en, q.subject, q.topic_id,
                  p.session_label, p.held_on
             FROM questions q JOIN papers p ON p.id = q.paper_id
            WHERE p.paper_type = ?""",
        (args.paper_type,),
    ).fetchall()

    sittings = sorted({r["held_on"] for r in rows})
    print(f"{len(rows)} questions across {len(sittings)} sittings: {', '.join(sittings)}\n")

    # ── topic frequency, counted per sitting ──────────────────────────────────
    topic_sittings: dict[str, set[str]] = defaultdict(set)
    topic_count: Counter[str] = Counter()
    for r in rows:
        if not r["topic_id"]:
            continue
        topic_count[r["topic_id"]] += 1
        topic_sittings[r["topic_id"]].add(r["held_on"])

    print("REVISE IN THIS ORDER — topics by how often they are actually set")
    print(f"{'questions':>10} {'sittings':>9}  topic")
    print("-" * 74)
    ranked = sorted(
        topic_count.items(),
        key=lambda kv: (-len(topic_sittings[kv[0]]), -kv[1]),
    )
    for tid, n in ranked[: args.top]:
        t = BY_ID.get(tid)
        if not t:
            continue
        print(f"{n:>10} {len(topic_sittings[tid]):>9}  {t.strand[:14]:15} {t.name}")

    # ── the board's own split, measured ───────────────────────────────────────
    strands = Counter(
        BY_ID[r["topic_id"]].strand for r in rows if r["topic_id"] and r["topic_id"] in BY_ID
    )
    total_tagged = sum(strands.values())
    print(f"\nwhere the {total_tagged} tagged Social Studies questions actually sit:")
    for strand, n in strands.most_common():
        print(f"  {strand:28} {n:>4}  ({n / total_tagged:.0%})")

    # ── repeated questions across sittings ────────────────────────────────────
    sst = [r for r in rows if (r["subject"] or "").startswith("Social") and r["stem_en"]]
    repeats: list[dict] = []
    used: set[int] = set()
    for i, a in enumerate(sst):
        if i in used:
            continue
        na = norm(a["stem_en"])
        if len(na) < 40:
            continue
        group = [a]
        for j in range(i + 1, len(sst)):
            if j in used:
                continue
            b = sst[j]
            if b["held_on"] == a["held_on"]:
                continue  # same sitting: that is a set reshuffle, not a repeat
            if SequenceMatcher(None, na, norm(b["stem_en"])).ratio() >= SIMILAR:
                group.append(b)
                used.add(j)
        if len(group) > 1:
            repeats.append(
                {
                    "sittings": sorted({g["held_on"] for g in group}),
                    "topic": BY_ID[a["topic_id"]].name if a["topic_id"] in BY_ID else None,
                    "stem": a["stem_en"][:200],
                }
            )

    repeats.sort(key=lambda r: -len(r["sittings"]))
    print(f"\nREPEATED ACROSS SITTINGS — {len(repeats)} questions the board has set more than once")
    for r in repeats[:12]:
        print(f"  x{len(r['sittings'])}  [{r['topic'] or 'untagged'}]")
        print(f"       {r['stem'][:110]}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "sittings": sittings,
                "topics": [
                    {
                        "topicId": tid,
                        "name": BY_ID[tid].name,
                        "strand": BY_ID[tid].strand,
                        "questions": n,
                        "sittings": len(topic_sittings[tid]),
                    }
                    for tid, n in ranked
                    if tid in BY_ID
                ],
                "repeats": repeats,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

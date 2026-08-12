"""
Batch-assemble every downloaded CTET paper and report pipeline accuracy.

This is the measurement that decides whether the parser is trustworthy enough
to put in front of a student. It reports, per paper, how many of the 150
questions came through clean AND carry an official answer — anything less is
work for the Content Review queue.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ctet_assemble import build  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "content" / "raw" / "ctet"
OUT = ROOT / "content" / "parsed"

# session dir -> (key pdf, held-on date, human label)
SESSIONS = {
    "july-2024": ("july2024_p1_key.pdf", "2024-07-07", "July 2024"),
}


def main() -> int:
    rows = []
    for session, (key_name, held_on, label) in SESSIONS.items():
        key_pdf = RAW / "keys" / key_name
        if not key_pdf.exists():
            print(f"! missing key {key_pdf}")
            continue

        for pdir in sorted((RAW / session).glob("*/")):
            name = pdir.name
            if not name.startswith("paper"):
                continue
            hits = sorted(pdir.glob("*Eng+Hin*.pdf"))
            if not hits:
                continue

            is_p1 = "paper1" in name.lower()
            # Only Paper I keys are downloaded so far; skip Paper II cleanly
            # rather than joining it against the wrong key.
            if not is_p1:
                rows.append((name, None, "no Paper II key downloaded"))
                continue

            set_code = name.rsplit("set", 1)[-1].strip("_ ").upper()[:1] or "A"
            try:
                data = build(
                    hits[0],
                    key_pdf,
                    set_code,
                    "PAPER-I 01-ENGLISH",
                    label,
                    "CTET_P1",
                    held_on,
                )
            except SystemExit as e:
                rows.append((name, None, str(e)))
                continue

            out = OUT / f"ctet_{session}_{name}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

            qs = data["questions"]
            rows.append(
                (
                    name,
                    {
                        "parsed": len(qs),
                        "four_opts": sum(1 for q in qs if len(q["options"]) == 4),
                        "keyed": sum(1 for q in qs if any(o["isCorrect"] for o in q["options"])),
                        "flagged": sum(1 for q in qs if q["warnings"]),
                        "bonus": len(data["report"]["bonus_questions"]),
                        "multi": len(data["report"]["multi_key_questions"]),
                    },
                    None,
                )
            )

    print(f"{'paper':16} {'parsed':>7} {'4opts':>6} {'keyed':>6} {'flagged':>8} {'bonus':>6} {'multi':>6}")
    print("-" * 62)
    total_q = total_clean = 0
    for name, r, err in rows:
        if r is None:
            print(f"{name:16}   skipped — {err}")
            continue
        print(
            f"{name:16} {r['parsed']:>7} {r['four_opts']:>6} {r['keyed']:>6} "
            f"{r['flagged']:>8} {r['bonus']:>6} {r['multi']:>6}"
        )
        total_q += r["parsed"]
        total_clean += r["parsed"] - r["flagged"]

    if total_q:
        print("-" * 62)
        print(f"{'TOTAL':16} {total_q:>7} questions, {total_clean} clean "
              f"({100 * total_clean / total_q:.1f}%), {total_q - total_clean} to review")
    return 0


if __name__ == "__main__":
    sys.exit(main())

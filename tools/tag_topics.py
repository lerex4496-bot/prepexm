"""
Tag questions to the official CTET syllabus topics.

WHY TAGGING AT ALL
------------------
`topic_id` is 0% populated across her 1,048 questions, which means the app can
offer "practise everything" and nothing else. Topic-wise revision, "what comes
up most", and weak-area drills all need to know what each question is ABOUT.

WHY IT IS CONSERVATIVE
----------------------
A question tagged to the wrong topic is worse than one left untagged. Untagged
just means it does not appear in a topic drill. Mis-tagged means she revises
"The Revolt of 1857" and is served a question about the Mughal revenue system —
and, worse, the frequency report then tells her to spend time on the wrong
thing. So a question is tagged only when the evidence is clear, and the run
reports how much it could not place rather than quietly reaching for a
best guess.

HOW
---
Two deterministic signals, no model:

  1. ALIAS HIT — the stem or options contain a phrase that belongs to exactly
     one topic ("sepoy", "panchayat", "formative assessment"). Aliases are
     specific by design; see tools/ctet_sst_syllabus.py.
  2. MARGIN — the best topic must beat the runner-up. A question mentioning
     both "constitution" and "parliament" is genuinely ambiguous, and guessing
     between them helps nobody.

Anything left over is written to a review file for a reader to place. That
reader may assign a topic; it may never touch an answer.

Usage:
    python tools/tag_topics.py --dry-run
    python tools/tag_topics.py --write        # updates Postgres, then re-export
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "apps" / "api"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from ctet_sst_syllabus import TOPICS, BY_ID  # noqa: E402

REVIEW_OUT = ROOT / "content" / "review" / "untagged.json"

# A tag needs at least one SPECIFIC hit (or several generic ones), and must beat
# the runner-up. Tuned against the actual failures, not guessed:
#
#   - the first pass demanded a 2-point margin, which rejected 128 questions
#     whose best topic led by exactly 1. Most were correct.
#   - it also scored "government" (generic, appears in half the civics paper)
#     the same as "mangal pandey" (names exactly one topic). Weighting by
#     specificity is what separates those.
MIN_MARGIN = 1
# 2 accepts either one specific hit (3) or two independent generic hits, and
# still rejects a lone common word — which is genuinely too weak to file a
# question on. Raising this to 3 rejected 82 questions whose only evidence was
# two corroborating generic terms; that was over-strict.
MIN_SCORE = 2

SPECIFIC = 3
GENERIC = 1


def normalise(text: str) -> str:
    # Collapse spacing so "Raja Rammohan" and "Raja Ram Mohan" both match one
    # alias — a real miss found in the first run, where the alias was spaced and
    # the paper was not.
    text = re.sub(r"\s+", " ", (text or "").lower())
    return text


def alias_hit(alias: str, haystack: str) -> bool:
    """
    Substring match, but spacing-insensitive for multi-word aliases.

    Proper nouns are spelled inconsistently across sittings — "Rammohan" and
    "Ram Mohan", "Jyotirao" and "Jyotiba" — and a spacing difference should not
    decide whether she gets a question about social reformers in her revision.
    """
    if alias in haystack:
        return True
    if " " in alias:
        return alias.replace(" ", "") in haystack.replace(" ", "")
    return False


def score_topics(haystack: str) -> Counter[str]:
    """
    Points per topic, weighted by how much each alias actually pins it down.

    A multi-word phrase or a long term names a topic; a short common word only
    hints at one. Scoring them equally is what made "Government" tie with
    everything else in the civics questions.
    """
    scores: Counter[str] = Counter()
    for topic in TOPICS:
        for alias in topic.aliases:
            if alias_hit(alias, haystack):
                weight = SPECIFIC if (" " in alias or len(alias) >= 9) else GENERIC
                scores[topic.id] += weight
    return scores


# A question is about TEACHING when the stem is about what a teacher or learner
# does, not about the fact itself. 20 of her 60 marks are these.
#
# This gate exists because the alias approach systematically got them wrong:
# pedagogy stems are ordinary prose that happens to mention content words, so
# "children could not explain latitude and longitude — what should the teacher
# do?" scored as Geography/Globe, and "a gender neutral ATMOSPHERE in school"
# scored as Geography/Air. Both are pedagogy questions, and filing them under
# content sends her to revise the wrong thing.
PEDAGOGY_INTENT = re.compile(
    r"\b(teacher|teaching|taught|classroom|class room|pupils?|learners?|"
    r"students? (should|can|are|were|will|may)|assess|assessment|evaluat|"
    r"which (question|activity|method|strategy|approach)|"
    r"lesson|pedagog|curriculum|textbook should|project method|group work|"
    r"higher.order|critical thinking|rubric|portfolio|formative|summative)\b",
    re.I,
)

# Proper nouns and dates are content no matter how the sentence is framed: a
# question naming Mangal Pandey is a History question even if a teacher is
# mentioned. Without this, the gate would swallow genuine content questions
# that merely say "students".
STRONG_CONTENT = re.compile(
    r"\b(1[0-9]{3}|18[0-9]{2}|19[0-9]{2}|harappa|mohenjo|ashoka|akbar|mughal|"
    r"gandhi|ambedkar|phule|periyar|sepoy|mangal pandey|chola|gupta|maurya|"
    r"sultanate|plassey|buxar|diwani|latitude|longitude|equator|monsoon)\b",
    re.I,
)


def classify(stem: str, options: list[str]) -> tuple[str | None, str]:
    """(topic_id or None, reason) — reason explains a refusal as well as a hit."""
    haystack = normalise(stem + " " + " ".join(options))
    if not haystack.strip():
        return None, "empty question"

    scores = score_topics(haystack)

    # Pedagogy gate: when the question is plainly about the teaching act and no
    # strong content marker is present, only pedagogy topics may win.
    if PEDAGOGY_INTENT.search(stem or "") and not STRONG_CONTENT.search(stem or ""):
        ped = Counter({tid: s for tid, s in scores.items() if BY_ID[tid].strand == "Pedagogy"})
        if ped:
            scores = ped
        else:
            # Recognisably a teaching question but no pedagogy alias fired —
            # better unplaced than filed under a content topic it merely
            # mentions.
            return None, "pedagogy question, no pedagogy alias matched"
    if not scores:
        return None, "no alias matched"

    ranked = scores.most_common()
    best_id, best = ranked[0]
    runner = ranked[1][1] if len(ranked) > 1 else 0

    if best < MIN_SCORE:
        return None, f"weak evidence (best {best})"
    if best - runner < MIN_MARGIN:
        tie = ", ".join(BY_ID[i].name for i, s in ranked[:3] if s == best)
        return None, f"ambiguous between: {tie}"
    return best_id, f"score {best} vs {runner}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paper-type", default="CTET_P2_SOCSCI")
    ap.add_argument(
        "--agent-tags",
        type=Path,
        help="JSON from a reader who placed what the aliases could not. Applied "
             "ONLY where this tool has no tag of its own, and validated against "
             "the closed syllabus taxonomy first.",
    )
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--write", action="store_true")
    args = ap.parse_args()

    # Read-only until proven valid: a tag naming a topic that is not in the
    # bulletin would put a drill on the screen that the syllabus does not have.
    agent: dict[str, str] = {}
    if args.agent_tags and args.agent_tags.exists():
        raw = json.loads(args.agent_tags.read_text(encoding="utf-8"))
        rejected = 0
        for row in raw:
            tid = row.get("topicId")
            if tid is None:
                continue
            if tid not in BY_ID:
                rejected += 1
                continue
            agent[row["questionId"]] = tid
        print(f"reader tags: {len(agent)} valid, {rejected} rejected as unknown topics\n")

    from app.db import SessionLocal  # noqa: E402
    from app.models import Option, Paper, Question  # noqa: E402
    from sqlalchemy import select  # noqa: E402
    from sqlalchemy.orm import selectinload  # noqa: E402

    tagged = 0
    per_topic: Counter[str] = Counter()
    refusals: Counter[str] = Counter()
    unplaced: list[dict] = []

    with SessionLocal() as db:
        rows = list(
            db.scalars(
                select(Question)
                .options(selectinload(Question.options))
                .join(Paper, Paper.id == Question.paper_id)
                .where(Paper.paper_type == args.paper_type)
            )
        )
        # Only the subject-content section carries syllabus topics; language and
        # CDP questions are a different taxonomy entirely and are left alone
        # rather than forced into one.
        subject_rows = [q for q in rows if (q.subject or "").startswith("Social")]

        from_reader = 0
        for q in subject_rows:
            topic_id, reason = classify(q.stem_en or "", [o.text_en or "" for o in q.options])
            # The reader only fills gaps. Where the aliases produced a tag it
            # stands, so the deterministic result stays reproducible from the
            # code rather than depending on who read what.
            if not topic_id and q.id in agent:
                topic_id, reason = agent[q.id], "placed by reader"
                from_reader += 1
            if topic_id:
                tagged += 1
                per_topic[topic_id] += 1
                if args.write:
                    q.topic_id = topic_id
            else:
                refusals[reason.split(":")[0]] += 1
                unplaced.append(
                    {
                        "questionId": q.id,
                        "number": q.number,
                        "reason": reason,
                        "stem": (q.stem_en or "")[:220],
                    }
                )

        if args.write:
            db.commit()

    total = len(subject_rows)
    print(f"Social Studies questions: {total}")
    print(f"  from aliases: {tagged - from_reader}   from reader: {from_reader}")
    print(f"  tagged   : {tagged} ({tagged / total:.0%})" if total else "  tagged: 0")
    print(f"  unplaced : {total - tagged}")
    print()
    print("why unplaced:")
    for reason, n in refusals.most_common():
        print(f"  {n:>4}  {reason}")
    print()
    print("top topics by question count:")
    for tid, n in per_topic.most_common(15):
        t = BY_ID[tid]
        print(f"  {n:>4}  {t.strand:26} {t.name}")

    REVIEW_OUT.parent.mkdir(parents=True, exist_ok=True)
    REVIEW_OUT.write_text(json.dumps(unplaced, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {REVIEW_OUT.relative_to(ROOT)} — {len(unplaced)} for a reader to place")
    if args.dry_run:
        print("dry run — nothing written to the database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

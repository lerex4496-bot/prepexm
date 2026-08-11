/**
 * Today's plan — generated from REAL local data, deterministically.
 *
 * No model is involved and no network is touched. That is deliberate: the plan
 * is the first thing she sees every morning, so it has to render instantly and
 * work on a train with no signal. Everything here is a query plus arithmetic.
 *
 * Every item carries a {code, params} rationale rather than a sentence, so the
 * "why am I seeing this" line renders in her language. That line is the whole
 * difference between an app that feels like it knows her and a list of links.
 *
 * Selection, in priority order:
 *   1. mistakes she has repeated       -> fix          (strongest signal)
 *   2. subjects with poor accuracy     -> practice
 *   3. papers never attempted          -> practice
 *   4. subjects never seen at all      -> learn
 */

import { currentExam, listPapers, openContentDb, type PaperRow } from '@/db/content';
import { listAttempts } from '@/db/local';
import { groupWeaknesses, loadMistakes, type MistakeDetail } from '@/db/mistakes';

export type PlanKind = 'learn' | 'practice' | 'recall' | 'fix';

export type Rationale =
  | { code: 'MISSED_TWICE'; params: { count: number } }
  | { code: 'RECENT_MISTAKE'; params: Record<string, never> }
  | { code: 'HIGH_WEIGHTAGE'; params: { pct: number } }
  | { code: 'NEVER_SEEN'; params: Record<string, never> }
  | { code: 'DUE_TODAY'; params: { days: number } };

export interface PlanItem {
  id: string;
  kind: PlanKind;
  minutes: number;
  title: string;
  detail: string;
  rationale: Rationale;
  /** What tapping it runs. */
  action:
    | { type: 'mistakes' }
    | { type: 'subject'; subject: string }
    | { type: 'paper'; paperId: string };
}

export interface TodayData {
  minutes: number;
  items: PlanItem[];
  weakAreas: { subject: string; count: number }[];
  overallPct: number | null;
  attemptCount: number;
  mistakeCount: number;
  papers: PaperRow[];
  hasContent: boolean;
}

/** Roughly 45 seconds per CTET question, rounded to something readable. */
function minutesFor(questions: number): number {
  return Math.max(5, Math.round((questions * 45) / 60 / 5) * 5);
}

export async function buildToday(dailyMinutes: number | null): Promise<TodayData> {
  const budget = dailyMinutes ?? 30;

  const [papers, attempts, mistakes] = await Promise.all([
    listPapers(),
    listAttempts(),
    loadMistakes(),
  ]);

  const items: PlanItem[] = [];
  const groups = groupWeaknesses(mistakes);

  // 1. Repeated mistakes first — nothing else she could do is worth more.
  const repeated = groups.filter((g) => g.count >= 2);
  if (repeated.length) {
    const total = repeated.reduce((n, g) => n + g.count, 0);
    items.push({
      id: 'fix-repeated',
      kind: 'fix',
      minutes: Math.min(15, minutesFor(total)),
      title: repeated[0].subject,
      detail: `${total}`,
      rationale: { code: 'MISSED_TWICE', params: { count: repeated[0].count } },
      action: { type: 'mistakes' },
    });
  } else if (mistakes.length) {
    items.push({
      id: 'fix-recent',
      kind: 'fix',
      minutes: Math.min(10, minutesFor(mistakes.length)),
      title: groups[0]?.subject ?? '',
      detail: `${mistakes.length}`,
      rationale: { code: 'RECENT_MISTAKE', params: {} },
      action: { type: 'mistakes' },
    });
  }

  // 2. Subjects where accuracy is weakest, measured from her own answers.
  const bySubject = await subjectAccuracy(mistakes);
  const weakest = bySubject.filter((s) => s.wrong > 0).slice(0, 2);
  for (const s of weakest) {
    if (items.some((i) => i.action.type === 'subject' && i.action.subject === s.subject)) continue;
    items.push({
      id: `practice-${s.subject}`,
      kind: 'practice',
      minutes: 15,
      title: s.subject,
      detail: '12',
      rationale: { code: 'HIGH_WEIGHTAGE', params: { pct: s.sharePct } },
      action: { type: 'subject', subject: s.subject },
    });
  }

  // 3. A paper she has never sat.
  const attemptedPapers = new Set(attempts.map((a) => a.paper_id));
  const fresh = papers.find((p) => !attemptedPapers.has(p.id));
  if (fresh) {
    items.push({
      id: `paper-${fresh.id}`,
      kind: 'practice',
      minutes: fresh.duration_min,
      title: fresh.paper_type.replace(/_/g, ' '),
      detail: `${fresh.total_questions}`,
      rationale: { code: 'NEVER_SEEN', params: {} },
      action: { type: 'paper', paperId: fresh.id },
    });
  }

  // 4. If she has done nothing yet, lead with a subject rather than an empty page.
  if (!items.length && papers.length) {
    const subjects = await listSubjects();
    if (subjects[0]) {
      items.push({
        id: 'learn-first',
        kind: 'learn',
        minutes: 15,
        title: subjects[0].subject,
        detail: `${subjects[0].count}`,
        rationale: { code: 'NEVER_SEEN', params: {} },
        action: { type: 'subject', subject: subjects[0].subject },
      });
    }
  }

  // Trim to her stated daily budget, but never to nothing: a plan that says
  // "you have 5 minutes so do nothing" is worse than one honest item.
  const trimmed: PlanItem[] = [];
  let spent = 0;
  for (const it of items) {
    if (trimmed.length && spent + it.minutes > budget) continue;
    trimmed.push(it);
    spent += it.minutes;
  }

  const scored = attempts.filter((a) => a.max_score);
  const overallPct = scored.length
    ? Math.round(
        (scored.reduce((n, a) => n + (a.score ?? 0) / (a.max_score ?? 1), 0) / scored.length) * 100
      )
    : null;

  return {
    minutes: spent,
    items: trimmed,
    weakAreas: groups.slice(0, 3).map((g) => ({ subject: g.subject, count: g.count })),
    overallPct,
    attemptCount: scored.length,
    mistakeCount: mistakes.length,
    papers,
    hasContent: papers.length > 0,
  };
}

async function subjectAccuracy(mistakes: MistakeDetail[]) {
  const counts = new Map<string, number>();
  for (const m of mistakes) {
    const s = m.subject ?? (m.part ? `Part ${m.part}` : 'Unsorted');
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()]
    .map(([subject, wrong]) => ({
      subject,
      wrong,
      sharePct: Math.round((wrong / total) * 100),
    }))
    .sort((a, b) => b.wrong - a.wrong);
}

export interface SubjectRow {
  subject: string;
  part: string | null;
  count: number;
}

/** Subjects present in the approved bundle — the spine of the Learn tab. */
export async function listSubjects(): Promise<SubjectRow[]> {
  const db = await openContentDb();
  // Joined to papers: subjects must never bleed across exams. Without this a
  // NEET student saw CTET pedagogy sections in the Learn tab.
  const rows = await db.getAllAsync<{ subject: string | null; part: string | null; n: number }>(
    `SELECT q.subject AS subject, q.part AS part, COUNT(*) AS n
       FROM questions q
       JOIN papers p ON p.id = q.paper_id
      WHERE p.exam_code = ?
      GROUP BY q.subject, q.part
      ORDER BY q.part, q.subject`,
    currentExam()
  );
  return rows
    .filter((r) => r.subject || r.part)
    .map((r) => ({
      subject: r.subject ?? `Part ${r.part}`,
      part: r.part,
      count: r.n,
    }));
}

/**
 * Mistake Notebook queries.
 *
 * Mistakes live in the LOCAL (writable) database; the question text lives in
 * the CONTENT bundle. They are separate databases on purpose — a content
 * update replaces the bundle wholesale and must never take her work with it —
 * so these joins happen in TypeScript rather than SQL.
 *
 * The headline this screen has to earn is "these are the things you
 * REPEATEDLY get wrong", so everything here groups and counts rather than
 * listing. A flat list of wrong answers is a scoreboard; a ranked list of
 * recurring weaknesses is a study plan.
 */

import { currentExam, openContentDb } from './content';
import { openLocalDb, type MistakeType } from './local';

export interface MistakeRow {
  id: string;
  attempt_id: string;
  question_id: string;
  paper_id: string;
  topic_id: string | null;
  chosen: string | null;
  correct: string | null;
  mistake_type: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface MistakeDetail extends MistakeRow {
  number: number;
  subject: string | null;
  part: string | null;
  stem_en: string;
  stem_hi: string | null;
  paperType: string;
}

/** One row per recurring weakness, ranked by how often it bites. */
export interface WeaknessGroup {
  key: string;
  subject: string;
  topicId: string | null;
  count: number;
  latest: number;
  items: MistakeDetail[];
}

export async function loadMistakes(includeResolved = false): Promise<MistakeDetail[]> {
  const local = await openLocalDb();
  const rows = await local.getAllAsync<MistakeRow>(
    includeResolved
      ? 'SELECT * FROM mistakes ORDER BY created_at DESC'
      : 'SELECT * FROM mistakes WHERE resolved_at IS NULL ORDER BY created_at DESC'
  );
  if (!rows.length) return [];

  const content = await openContentDb();
  // One query for every referenced question rather than N queries in a loop —
  // this screen can legitimately hold hundreds of mistakes.
  const ids = [...new Set(rows.map((r) => r.question_id))];
  const placeholders = ids.map(() => '?').join(',');
  const questions = await content.getAllAsync<{
    id: string;
    number: number;
    subject: string | null;
    part: string | null;
    stem_en: string;
    stem_hi: string | null;
    paper_type: string;
  }>(
    `SELECT q.id, q.number, q.subject, q.part, q.stem_en, q.stem_hi, p.paper_type
       FROM questions q JOIN papers p ON p.id = q.paper_id
      WHERE q.id IN (${placeholders}) AND p.exam_code = ?`,
    ...ids,
    currentExam()
  );
  const byId = new Map(questions.map((q) => [q.id, q]));

  return rows.flatMap((r) => {
    const q = byId.get(r.question_id);
    // A mistake whose question vanished from the bundle (rejected in review,
    // say) is dropped rather than rendered as a blank card.
    if (!q) return [];
    return [
      {
        ...r,
        number: q.number,
        subject: q.subject,
        part: q.part,
        stem_en: q.stem_en,
        stem_hi: q.stem_hi,
        paperType: q.paper_type,
      },
    ];
  });
}

/**
 * Group by subject, then rank by frequency. Repetition is the signal: getting
 * one question wrong is noise, getting four from the same area wrong is a gap.
 */
export function groupWeaknesses(items: MistakeDetail[]): WeaknessGroup[] {
  const map = new Map<string, WeaknessGroup>();
  for (const m of items) {
    const subject = m.subject ?? (m.part ? `Part ${m.part}` : 'Unsorted');
    const key = `${subject}::${m.topic_id ?? ''}`;
    const g = map.get(key);
    if (g) {
      g.count += 1;
      g.latest = Math.max(g.latest, m.created_at);
      g.items.push(m);
    } else {
      map.set(key, {
        key,
        subject,
        topicId: m.topic_id,
        count: 1,
        latest: m.created_at,
        items: [m],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.latest - a.latest);
}

export function countByType(items: MistakeDetail[]): { type: string; count: number }[] {
  const c = new Map<string, number>();
  for (const m of items) {
    const t = m.mistake_type ?? 'untagged';
    c.set(t, (c.get(t) ?? 0) + 1);
  }
  return [...c.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export async function resolveMistake(id: string): Promise<void> {
  const local = await openLocalDb();
  await local.runAsync('UPDATE mistakes SET resolved_at = ? WHERE id = ?', Date.now(), id);
}

export async function unresolveMistake(id: string): Promise<void> {
  const local = await openLocalDb();
  await local.runAsync('UPDATE mistakes SET resolved_at = NULL WHERE id = ?', id);
}

export async function setMistakeTypeById(id: string, type: MistakeType): Promise<void> {
  const local = await openLocalDb();
  await local.runAsync('UPDATE mistakes SET mistake_type = ? WHERE id = ?', type, id);
}

export interface PerformancePoint {
  attemptId: string;
  paperType: string;
  submittedAt: number;
  score: number;
  maxScore: number;
  pct: number;
}

/** Attempt history, oldest first — the shape a trend line needs. */
export async function loadPerformance(): Promise<PerformancePoint[]> {
  const local = await openLocalDb();
  const rows = await local.getAllAsync<{
    id: string;
    paper_id: string;
    submitted_at: number;
    score: number;
    max_score: number;
  }>(
    `SELECT id, paper_id, submitted_at, score, max_score
       FROM attempts WHERE submitted_at IS NOT NULL AND max_score > 0
      ORDER BY submitted_at ASC`
  );
  if (!rows.length) return [];

  const content = await openContentDb();
  const papers = await content.getAllAsync<{ id: string; paper_type: string }>(
    'SELECT id, paper_type FROM papers'
  );
  const byId = new Map(papers.map((p) => [p.id, p.paper_type]));

  return rows.map((r) => ({
    attemptId: r.id,
    paperType: byId.get(r.paper_id) ?? '—',
    submittedAt: r.submitted_at,
    score: r.score,
    maxScore: r.max_score,
    pct: Math.round((r.score / r.max_score) * 100),
  }));
}

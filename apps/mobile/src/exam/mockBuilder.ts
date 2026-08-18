/**
 * Full-length mock papers, assembled on the phone from real questions.
 *
 * WHAT A MOCK IS HERE — AND WHAT IT IS NOT
 * ----------------------------------------
 * Every question in a mock appeared on a real CTET paper and carries the answer
 * CBSE published for it. Nothing is generated, rewritten or paraphrased. The
 * only new thing is the selection and the order.
 *
 * That makes it the safest extra practice available: the chance of a wrong
 * answer is exactly the chance that CBSE's own final answer key is wrong, and
 * no model is involved at any point in this file. It is deliberately a
 * different product from an "AI mock", and the two must never be mixed — "was
 * this on a real paper?" is a question she is entitled to a straight answer to.
 *
 * WHY IT FOLLOWS THE BLUEPRINT
 * ----------------------------
 * A shuffled bag of 150 questions is not practice for CTET. The value of a mock
 * is that it rehearses the real thing: 30 of Child Development, then 60 of
 * Social Studies, under the same clock. So sections are filled to the published
 * blueprint, and a section that cannot be filled is reported short rather than
 * quietly padded from another one — a 150-question paper with 40 Social Studies
 * questions would misrepresent her readiness in the one direction that matters.
 *
 * WHY A SEED RATHER THAN A STORED QUESTION LIST
 * ---------------------------------------------
 * A mock is identified by `mock:<seed>` and rebuilt from that seed on demand.
 * Same seed, same paper, every time — so leaving mid-test and coming back gives
 * her the same questions in the same order, and a finished mock can be reopened
 * for review months later. Nothing has to be written to the database, and there
 * is no way for a stored list to drift from the content it points at.
 *
 * This runs entirely on the device. The server has an equivalent in
 * apps/api/app/practicesets.py, but her phone has no server to call.
 */

import type { LoadedQuestion, PaperRow } from '@/db/content';

/**
 * The only fields assembly actually reads.
 *
 * Generic over the row type so this works on the LIGHT pool (seven columns,
 * no options) as well as on fully loaded questions. Assembling a mock used to
 * drag the whole pool across the bridge — 899 questions with both stems,
 * passages and explanations, plus 3,596 option rows — to pick 150 of them,
 * which is what put "Loading paper…" on screen for seconds at a time.
 */
export interface Selectable {
  id: string;
  subject: string | null;
  topic_id: string | null;
  stem_en: string;
  stem_hi: string | null;
}
import { rankOf } from './topicPriority';

/** The prefix that marks a synthetic paper id. */
export const MOCK_PREFIX = 'mock:';

/**
 * The kinds of practice, all assembled by the same engine.
 *
 *   full      150 questions to the real blueprint, under the real clock
 *   section   one section only — 60 Social Studies in 60 minutes fits an evening
 *   topic     a single syllabus topic, for revising one thing properly
 *   priority  drawn from the topics the examiners set most often
 *   weak      built from the questions she has actually got wrong
 *
 * A full paper is the right rehearsal but the wrong tool on a weeknight, and it
 * is useless for fixing one weak topic. These exist so practice can match the
 * time and the purpose she actually has.
 */
export type MockMode = 'full' | 'section' | 'topic' | 'priority' | 'weak';

export interface MockSpec {
  mode: MockMode;
  /** topic id, or a section code ('sst' | 'cdp' | 'lang1' | 'lang2'). '-' when unused. */
  param: string;
  seed: string;
}

/**
 * Id format: `mock:<mode>:<param>:<seed>`
 *
 * Everything needed to rebuild the paper lives in the id, so nothing about a
 * practice set has to be stored. Resuming, reopening months later, and the
 * attempts table keying on paper id all work with no extra tables.
 */
export function isMockId(paperId: string): boolean {
  return paperId.startsWith(MOCK_PREFIX);
}

export function parseMockId(paperId: string): MockSpec {
  const rest = paperId.slice(MOCK_PREFIX.length);
  const parts = rest.split(':');
  // A bare `mock:<seed>` is the original full-paper form. Kept working so any
  // mock she has already sat still reopens as the same paper.
  if (parts.length < 3) return { mode: 'full', param: '-', seed: rest };
  const [mode, param, ...seedParts] = parts;
  return {
    mode: (['full', 'section', 'topic', 'priority', 'weak'] as const).includes(mode as MockMode)
      ? (mode as MockMode)
      : 'full',
    param,
    seed: seedParts.join(':'),
  };
}

export function mockIdFor(seed: string, mode: MockMode = 'full', param = '-'): string {
  return `${MOCK_PREFIX}${mode}:${param}:${seed}`;
}

/** Legacy helper kept for the original id shape. */
export function mockSeed(paperId: string): string {
  return parseMockId(paperId).seed;
}

/** Subject names behind each section code, and how long the real thing allows. */
export const SECTIONS: Record<string, { subjects: string[]; count: number; minutes: number }> = {
  sst: { subjects: ['Social Studies / Social Science'], count: 60, minutes: 60 },
  cdp: { subjects: ['Child Development and Pedagogy'], count: 30, minutes: 30 },
  lang1: { subjects: ['Language I'], count: 30, minutes: 30 },
  lang2: { subjects: ['Language II'], count: 30, minutes: 30 },
};

/** A short drill — long enough to be worth sitting, short enough for an evening. */
export const DRILL_SIZE = 20;

/**
 * Section shape of each paper, from the printed booklet cover.
 *
 * Mirrors BLUEPRINTS in apps/api/app/practicesets.py. Duplicated rather than
 * shared because the app cannot import Python, and the SOURCE of both is the
 * booklet itself — not one copying the other.
 */
export const BLUEPRINTS: Record<string, [string, number][]> = {
  CTET_P1: [
    ['Child Development and Pedagogy', 30],
    ['Mathematics', 30],
    ['Environmental Studies', 30],
    ['Language I', 30],
    ['Language II', 30],
  ],
  CTET_P2_MATHSCI: [
    ['Child Development and Pedagogy', 30],
    ['Mathematics and Science', 60],
    ['Language I', 30],
    ['Language II', 30],
  ],
  CTET_P2_SOCSCI: [
    ['Child Development and Pedagogy', 30],
    ['Social Studies / Social Science', 60],
    ['Language I', 30],
    ['Language II', 30],
  ],
};

export const MOCK_DURATION_MIN = 150;

/**
 * mulberry32 — a small, fast, well-distributed PRNG.
 *
 * Math.random() cannot be used: it is unseeded, so a mock could not be rebuilt
 * from its id and resuming would hand her a different paper mid-attempt.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: string seed -> 32-bit integer, so seeds can be human-readable. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Fisher-Yates, driven by the seeded generator. Does not mutate the input. */
function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface MockPlan<Q extends Selectable = LoadedQuestion> {
  questions: Q[];
  /** Sections that could not be filled, so the UI can say so rather than hide it. */
  short: { subject: string; wanted: number; got: number }[];
}

/**
 * Choose the questions for one mock.
 *
 * `pool` is every approved question available for her paper type. Selection is
 * per section and without replacement, so no question can appear twice.
 */
export function buildMock<Q extends Selectable>(
  seedOrSpec: string | MockSpec,
  paperType: string,
  pool: readonly Q[],
  /** Ids she has answered wrongly — required only for the 'weak' mode. */
  weakIds: readonly string[] = []
): MockPlan<Q> {
  const spec: MockSpec =
    typeof seedOrSpec === 'string' ? { mode: 'full', param: '-', seed: seedOrSpec } : seedOrSpec;

  // Every mode except `full` is a single-section selection, so they share one
  // path: narrow the pool, then take DRILL_SIZE (or the section's real count).
  if (spec.mode !== 'full') {
    return buildDrill(spec, pool, weakIds);
  }

  const blueprint = BLUEPRINTS[paperType];
  if (!blueprint) return { questions: [], short: [] };

  const next = rng(hashSeed(spec.seed));

  // Collapse questions that are the same question wearing a different id —
  // CBSE prints four shuffled sets per paper, so if two sets of one sitting are
  // both present the same item exists twice. See dedupe().
  const unique = dedupe(pool);

  const bySubject = new Map<string, Q[]>();
  for (const q of unique) {
    const key = q.subject ?? '';
    const list = bySubject.get(key);
    if (list) list.push(q);
    else bySubject.set(key, [q]);
  }

  const picked: Q[] = [];
  const short: MockPlan['short'] = [];

  for (const [subject, wanted] of blueprint) {
    const available = bySubject.get(subject) ?? [];
    // Sorted before shuffling so the seed alone determines the result: map
    // iteration order depends on how the pool arrived, which would make the
    // "same seed, same paper" promise quietly false.
    const ordered = [...available].sort((a, b) => a.id.localeCompare(b.id));
    const chosen = shuffle(ordered, next).slice(0, wanted);
    if (chosen.length < wanted) {
      short.push({ subject, wanted, got: chosen.length });
    }
    picked.push(...chosen);
  }

  // Renumber 1..n so the palette, "Q 12 / 150" and the answer sheet all read
  // like a real paper rather than showing the numbers these questions had on
  // whichever paper they came from.
  // `number` is overwritten, not added, so the shape is unchanged — but TS
  // cannot see that a spread of Q is still Q, hence the assertion.
  const questions = picked.map((q, i) => ({ ...q, number: i + 1 }) as unknown as Q);
  return { questions, short };
}


/**
 * A focused set: one topic, one section, the priority topics, or her mistakes.
 *
 * Deliberately the same seeded, de-duplicated selection the full paper uses, so
 * a drill is resumable and reopenable exactly like a mock. Only the pool and the
 * size differ.
 */
function buildDrill<Q extends Selectable>(
  spec: MockSpec,
  pool: readonly Q[],
  weakIds: readonly string[]
): MockPlan<Q> {
  const next = rng(hashSeed(`${spec.mode}:${spec.param}:${spec.seed}`));
  const unique = dedupe(pool);

  let candidates: Q[] = unique;
  let wanted = DRILL_SIZE;
  let label = spec.param;

  if (spec.mode === 'section') {
    const section = SECTIONS[spec.param];
    if (!section) return { questions: [], short: [] };
    candidates = unique.filter((q) => section.subjects.includes(q.subject ?? ''));
    wanted = section.count;
  } else if (spec.mode === 'topic') {
    candidates = unique.filter((q) => q.topic_id === spec.param);
  } else if (spec.mode === 'priority') {
    // The topics the board sets most often, hardest-hitting first. Questions
    // with no topic are excluded rather than padded in — an untagged question
    // cannot be claimed to be high-priority.
    const ranked = unique.filter((q) => q.topic_id && rankOf(q.topic_id) < 12);
    candidates = ranked.sort((a, b) => rankOf(a.topic_id) - rankOf(b.topic_id));
    // Take from the top of the ranking, then shuffle for presentation, so a
    // priority drill really is the high-frequency topics rather than a sample.
    candidates = candidates.slice(0, DRILL_SIZE * 3);
  } else if (spec.mode === 'weak') {
    const wrong = new Set(weakIds);
    candidates = unique.filter((q) => wrong.has(q.id));
    label = 'mistakes';
  }

  const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const chosen = shuffle(ordered, next).slice(0, wanted);
  const short =
    chosen.length < wanted
      ? [{ subject: label, wanted, got: chosen.length }]
      : [];
  return { questions: chosen.map((q, i) => ({ ...q, number: i + 1 })), short };
}

/** Collapse questions that are the same question under a different id. */
function dedupe<Q extends Selectable>(pool: readonly Q[]): Q[] {
  const seen = new Set<string>();
  const out: Q[] = [];
  for (const q of pool) {
    const fingerprint = (q.stem_en || q.stem_hi || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (fingerprint && seen.has(fingerprint)) continue;
    if (fingerprint) seen.add(fingerprint);
    out.push(q);
  }
  return out;
}

/** A PaperRow for a mock, shaped so the exam player needs no special case. */
export function mockPaper(
  spec: MockSpec,
  paperType: string,
  total: number,
  label = 'Mock test'
): PaperRow {
  const minutes =
    spec.mode === 'section' ? (SECTIONS[spec.param]?.minutes ?? total) : spec.mode === 'full' ? MOCK_DURATION_MIN : total;
  return {
    id: mockIdFor(spec.seed, spec.mode, spec.param),
    exam_code: 'CTET',
    paper_type: paperType,
    session_label: label,
    held_on: '',
    set_code: null,
    // Marks its provenance honestly: assembled by us from real questions, not a
    // paper CBSE ever printed.
    source_type: 'MOCK',
    total_questions: total,
    // A drill gets a minute a question — the real paper's pace — rather than
    // the full 150, so timing practice still means something on a short set.
    duration_min: minutes,
    total_marks: total,
  };
}

/**
 * A fresh seed. Date-based so mocks sort naturally and read meaningfully in a
 * list, with a short random tail so two mocks made in the same minute differ.
 */
export function newMockSeed(): string {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${stamp}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

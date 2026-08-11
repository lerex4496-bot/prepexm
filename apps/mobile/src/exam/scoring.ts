/**
 * Official CTET scoring.
 *
 * CTET marks +1 per correct answer with NO negative marking — unlike NEET,
 * which is +4/-1. Getting that wrong in either direction would misrepresent
 * her real standing, so the rule lives in one place, per exam, and is applied
 * from the paper's own exam code rather than assumed.
 *
 * The two subtleties that matter, both of which come straight from the
 * official answer key and would silently corrupt every score if ignored:
 *
 *   MULTI-KEY  A question may accept more than one option (key letters A-F on
 *              the official key, per the printed legend A=1,2 / B=1,3 / ...).
 *              Any accepted option scores. This is already encoded as several
 *              options carrying is_correct = 1.
 *
 *   BONUS      `status = 'bonus'` means the key accepted ALL options (Z=ALL) —
 *              the question was effectively voided and every candidate who
 *              attempted it was awarded the mark. Scoring it normally would
 *              mark her wrong on a question CBSE gave everyone.
 */

import type { LoadedQuestion, PaperRow } from '@/db/content';

export interface ExamRules {
  correct: number;
  incorrect: number;
  unattempted: number;
}

export const RULES: Record<string, ExamRules> = {
  // CTET: +1, no negative marking.
  CTET: { correct: 1, incorrect: 0, unattempted: 0 },
  // NEET: +4 / -1. Present so the difference is explicit, not implied.
  NEET: { correct: 4, incorrect: -1, unattempted: 0 },
};

export function rulesFor(paper: Pick<PaperRow, 'exam_code'>): ExamRules {
  return RULES[paper.exam_code] ?? RULES.CTET;
}

export interface QuestionOutcome {
  questionId: string;
  number: number;
  chosen: string | null;
  correctLabels: string[];
  isCorrect: boolean;
  isBonus: boolean;
  attempted: boolean;
  marks: number;
  topicId: string | null;
  timeMs: number;
}

export interface ScoreResult {
  score: number;
  maxScore: number;
  correct: number;
  incorrect: number;
  unattempted: number;
  bonusAwarded: number;
  outcomes: QuestionOutcome[];
}

export function scoreAttempt(
  paper: Pick<PaperRow, 'exam_code'>,
  questions: LoadedQuestion[],
  responses: Map<string, { chosen: string | null; timeMs: number }>
): ScoreResult {
  const rules = rulesFor(paper);

  let score = 0;
  let correct = 0;
  let incorrect = 0;
  let unattempted = 0;
  let bonusAwarded = 0;
  const outcomes: QuestionOutcome[] = [];

  for (const q of questions) {
    const r = responses.get(q.id);
    const chosen = r?.chosen ?? null;
    const attempted = chosen != null;
    const correctLabels = q.options.filter((o) => o.is_correct === 1).map((o) => o.label);
    const isBonus = q.status === 'bonus';

    let isCorrect: boolean;
    if (isBonus) {
      // Voided by the board: every attempt scores, regardless of choice.
      isCorrect = attempted;
      if (attempted) bonusAwarded += 1;
    } else {
      isCorrect = attempted && correctLabels.includes(chosen as string);
    }

    let marks = 0;
    if (!attempted) {
      unattempted += 1;
      marks = rules.unattempted;
    } else if (isCorrect) {
      correct += 1;
      marks = rules.correct;
    } else {
      incorrect += 1;
      marks = rules.incorrect;
    }

    score += marks;
    outcomes.push({
      questionId: q.id,
      number: q.number,
      chosen,
      correctLabels,
      isCorrect,
      isBonus,
      attempted,
      marks,
      topicId: q.topic_id,
      timeMs: r?.timeMs ?? 0,
    });
  }

  return {
    score,
    maxScore: questions.length * rules.correct,
    correct,
    incorrect,
    unattempted,
    bonusAwarded,
    outcomes,
  };
}

/**
 * The five states of the real NTA/CBSE question palette.
 * Each carries a distinct glyph as well as a colour — colour alone is not an
 * indicator, both for accessibility and because the palette must stay readable
 * at a glance under exam pressure.
 */
export type PaletteState =
  | 'notVisited'
  | 'notAnswered'
  | 'answered'
  | 'marked'
  | 'answeredMarked';

export const PALETTE_GLYPH: Record<PaletteState, string> = {
  notVisited: '○',
  notAnswered: '▢',
  answered: '●',
  marked: '◆',
  answeredMarked: '◈',
};

export function paletteState(r?: { chosen: string | null; marked: boolean; visited: boolean }): PaletteState {
  if (!r || !r.visited) return 'notVisited';
  const answered = r.chosen != null;
  if (r.marked) return answered ? 'answeredMarked' : 'marked';
  return answered ? 'answered' : 'notAnswered';
}

/**
 * Prefill for the "how did you get it wrong?" question, from time-on-question.
 * A hint only — she always overrides it. Fast answers skew toward misreading,
 * slow ones toward a genuine conceptual gap.
 */
export function guessMistakeType(timeMs: number, medianMs: number): string {
  if (timeMs > 0 && timeMs < medianMs * 0.4) return 'misread';
  if (timeMs > medianMs * 2) return 'conceptual';
  return 'conceptual';
}

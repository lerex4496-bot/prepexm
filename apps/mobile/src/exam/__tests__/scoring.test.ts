import { RULES, rulesFor, scoreAttempt } from '../scoring';
import type { LoadedQuestion, PaperRow } from '@/db/content';

/**
 * Tests for the code that decides her marks.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `scoreAttempt` turns a set of answers into the number she plans her revision
 * around. A mistake here does not crash, does not look wrong on screen, and
 * does not show up in any log — it just quietly tells her she is doing better
 * or worse than she is. That is the worst failure mode in the app, and until
 * now nothing checked it.
 *
 * The three rules worth protecting are the ones that came from reading the
 * official answer key rather than from the obvious implementation:
 *
 *   NO NEGATIVE MARKING FOR CTET. NEET deducts 1 for a wrong answer; CTET
 *   deducts nothing. Applying NEET's rule to a CTET paper would understate a
 *   guess-heavy attempt badly.
 *
 *   BONUS questions (key legend Z=ALL) were voided by the board and every
 *   candidate who attempted them got the mark. Scoring one normally marks her
 *   wrong on a question CBSE gave to everybody.
 *
 *   MULTI-KEY questions accept more than one option (legend A=1,2 / B=1,3 and
 *   so on). Any accepted option scores.
 */

const CTET: Pick<PaperRow, 'exam_code'> = { exam_code: 'CTET' };
const NEET: Pick<PaperRow, 'exam_code'> = { exam_code: 'NEET' };

/** A four-option question; `correct` lists every accepted label. */
function question(
  id: string,
  number: number,
  correct: string[],
  status: string = 'ok'
): LoadedQuestion {
  return {
    id,
    paper_id: 'p1',
    number,
    part: 'I',
    subject: 'Child Development and Pedagogy',
    stem_en: `Question ${number}`,
    stem_hi: null,
    passage_en: null,
    passage_hi: null,
    extraction_en: 'EXACT',
    extraction_hi: null,
    topic_id: null,
    explanation_en: null,
    explanation_hi: null,
    explanation_gu: null,
    status,
    multi_key: correct.length > 1 ? 1 : 0,
    key_raw: correct.join(''),
    options: ['A', 'B', 'C', 'D'].map((label) => ({
      question_id: id,
      label,
      text_en: `Option ${label}`,
      text_hi: null,
      is_correct: correct.includes(label) ? 1 : 0,
    })),
  } as LoadedQuestion;
}

function answers(pairs: Record<string, string | null>) {
  return new Map(
    Object.entries(pairs).map(([id, chosen]) => [id, { chosen, timeMs: 1000 }])
  );
}

describe('rulesFor', () => {
  it('applies each exam its own rule', () => {
    expect(rulesFor(CTET)).toEqual({ correct: 1, incorrect: 0, unattempted: 0 });
    expect(rulesFor(NEET)).toEqual({ correct: 4, incorrect: -1, unattempted: 0 });
  });

  it('falls back to CTET for an unknown exam rather than scoring nothing', () => {
    expect(rulesFor({ exam_code: 'SOMETHING_NEW' })).toEqual(RULES.CTET);
  });
});

describe('CTET scoring', () => {
  const qs = [question('q1', 1, ['B']), question('q2', 2, ['C']), question('q3', 3, ['A'])];

  it('gives +1 for correct, 0 for wrong, 0 for unattempted', () => {
    const r = scoreAttempt(CTET, qs, answers({ q1: 'B', q2: 'A', q3: null }));
    expect(r.score).toBe(1);
    expect(r.correct).toBe(1);
    expect(r.incorrect).toBe(1);
    expect(r.unattempted).toBe(1);
  });

  it('never deducts for a wrong answer', () => {
    // The whole paper answered wrongly must be 0, not a negative number.
    const r = scoreAttempt(CTET, qs, answers({ q1: 'A', q2: 'A', q3: 'B' }));
    expect(r.score).toBe(0);
    expect(r.incorrect).toBe(3);
  });

  it('reports maxScore from the rule, not from a hardcoded 1', () => {
    expect(scoreAttempt(CTET, qs, answers({})).maxScore).toBe(3);
  });
});

describe('NEET scoring', () => {
  const qs = [question('q1', 1, ['B']), question('q2', 2, ['C']), question('q3', 3, ['A'])];

  it('gives +4 for correct and -1 for wrong', () => {
    const r = scoreAttempt(NEET, qs, answers({ q1: 'B', q2: 'A', q3: null }));
    expect(r.score).toBe(3); // +4 - 1 + 0
  });

  it('leaves an unattempted question at zero rather than deducting', () => {
    // The difference between skipping and guessing is the whole reason NEET
    // candidates are taught to skip.
    expect(scoreAttempt(NEET, qs, answers({})).score).toBe(0);
    expect(scoreAttempt(NEET, qs, answers({ q1: 'A', q2: 'A', q3: 'B' })).score).toBe(-3);
  });

  it('sets maxScore to 4 per question', () => {
    expect(scoreAttempt(NEET, qs, answers({})).maxScore).toBe(12);
  });
});

describe('bonus questions (board accepted every option)', () => {
  const qs = [question('q1', 1, ['B'], 'bonus')];

  it('awards the mark for ANY answer, not just the printed one', () => {
    const wrongLooking = scoreAttempt(CTET, qs, answers({ q1: 'D' }));
    expect(wrongLooking.score).toBe(1);
    expect(wrongLooking.correct).toBe(1);
    expect(wrongLooking.incorrect).toBe(0);
    expect(wrongLooking.bonusAwarded).toBe(1);
  });

  it('does NOT award it when she left the question blank', () => {
    // CBSE awarded the mark to candidates who attempted it. Giving it to a
    // blank would inflate her score above what the board would have given.
    const skipped = scoreAttempt(CTET, qs, answers({ q1: null }));
    expect(skipped.score).toBe(0);
    expect(skipped.unattempted).toBe(1);
    expect(skipped.bonusAwarded).toBe(0);
  });
});

describe('multi-key questions (more than one accepted option)', () => {
  const qs = [question('q1', 1, ['A', 'C'])];

  it('accepts either key', () => {
    expect(scoreAttempt(CTET, qs, answers({ q1: 'A' })).score).toBe(1);
    expect(scoreAttempt(CTET, qs, answers({ q1: 'C' })).score).toBe(1);
  });

  it('still rejects an option the key does not list', () => {
    expect(scoreAttempt(CTET, qs, answers({ q1: 'B' })).score).toBe(0);
  });

  it('records every accepted label on the outcome, for the review screen', () => {
    const r = scoreAttempt(CTET, qs, answers({ q1: 'A' }));
    expect(r.outcomes[0].correctLabels.sort()).toEqual(['A', 'C']);
  });
});

describe('a whole paper', () => {
  // 10 questions: 6 right, 2 wrong, 1 bonus attempted, 1 skipped.
  const qs = [
    ...[1, 2, 3, 4, 5, 6].map((n) => question(`c${n}`, n, ['A'])),
    question('w1', 7, ['A']),
    question('w2', 8, ['A']),
    question('b1', 9, ['A'], 'bonus'),
    question('s1', 10, ['A']),
  ];
  const given = answers({
    c1: 'A', c2: 'A', c3: 'A', c4: 'A', c5: 'A', c6: 'A',
    w1: 'B', w2: 'C',
    b1: 'D',
    s1: null,
  });

  it('totals correctly under CTET', () => {
    const r = scoreAttempt(CTET, qs, given);
    expect(r.correct).toBe(7); // 6 + the bonus
    expect(r.incorrect).toBe(2);
    expect(r.unattempted).toBe(1);
    expect(r.score).toBe(7);
    expect(r.maxScore).toBe(10);
  });

  it('totals correctly under NEET, where the wrong answers cost marks', () => {
    const r = scoreAttempt(NEET, qs, given);
    expect(r.score).toBe(7 * 4 - 2); // 28 - 2
    expect(r.maxScore).toBe(40);
  });

  it('produces one outcome per question, in order', () => {
    const r = scoreAttempt(CTET, qs, given);
    expect(r.outcomes).toHaveLength(10);
    expect(r.outcomes.map((o) => o.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('edge cases', () => {
  it('scores an empty paper as zero rather than throwing', () => {
    const r = scoreAttempt(CTET, [], answers({}));
    expect(r).toMatchObject({ score: 0, maxScore: 0, correct: 0, outcomes: [] });
  });

  it('treats a question with no response entry as unattempted', () => {
    // A response row missing entirely is different from one with chosen:null,
    // and both must count as a skip rather than a wrong answer.
    const r = scoreAttempt(CTET, [question('q1', 1, ['A'])], new Map());
    expect(r.unattempted).toBe(1);
    expect(r.incorrect).toBe(0);
  });
});

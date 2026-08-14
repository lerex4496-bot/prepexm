/**
 * Why marks are lost on questions she already knows the answer to.
 *
 * ABOUT A QUARTER of her Social Studies questions are structural: Assertion-
 * Reason, Statement I/II, Match the following, and the negative "which is NOT".
 * On these the candidate usually knows the content and still loses the mark, by
 * answering a slightly different question from the one asked.
 *
 * That is worth teaching directly, because it is the cheapest improvement
 * available. Learning one more chapter of medieval history might win a mark.
 * Learning to read an Assertion-Reason stem properly is worth every
 * Assertion-Reason question on the paper, and it takes ten minutes.
 *
 * WRITTEN, NOT GENERATED
 * ----------------------
 * These are deliberately hand-written. A generated explanation of a trap tends
 * to restate the question; the useful version names the specific misreading
 * that costs the mark, which comes from looking at how these questions are
 * actually built. There are only a handful of archetypes, so this is a small
 * amount of careful writing rather than a content pipeline.
 *
 * Shown before a drill of that type, and again on the review screen when she
 * gets one wrong — at the moment the lesson is worth something.
 */

export type ArchetypeId =
  | 'assertionReason'
  | 'statements'
  | 'match'
  | 'negative'
  | 'pedagogyScenario';

export interface Archetype {
  id: ArchetypeId;
  /** Shown as the card title. */
  title: string;
  /** One line: what this question type is. */
  what: string;
  /** The specific misreading that loses the mark. */
  trap: string;
  /** What to do instead, in order. */
  method: string[];
  /** Detects the archetype from the question stem. */
  test: RegExp;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'assertionReason',
    title: 'Assertion and Reason',
    what: 'Two statements: an Assertion (A) and a Reason (R). You judge both, and then the link between them.',
    trap:
      'Most marks here are lost by stopping after "are both true?". The question asks a second, separate thing — whether R is the reason FOR A. Both statements can be perfectly true and still have nothing to do with each other, and that is the option people miss.',
    method: [
      'Cover R. Decide if A alone is true.',
      'Cover A. Decide if R alone is true.',
      'Only if both are true, ask: does R actually explain WHY A happens?',
      'If R is true but explains something else, the answer is "both true, R is not the correct explanation".',
    ],
    test: /assertion\s*\(?\s*a\s*\)?|reason\s*\(?\s*r\s*\)?/i,
  },
  {
    id: 'statements',
    title: 'Statement I and II',
    what: 'Two or more numbered statements; you choose which are correct.',
    trap:
      'The statements are usually ALMOST right. One word does the damage — "all" instead of "some", "must" instead of "may", a wrong date, a swapped name. Reading for the general sense makes a subtly wrong statement feel true.',
    method: [
      'Read each statement on its own and mark it true or false before looking at the options.',
      'Hunt for the absolute words: all, only, never, always, must. They are where a statement is usually broken.',
      'Check names, dates and numbers against what you know — those are the usual planted error.',
      'Now match your own verdict to the options, rather than picking the option that "looks right".',
    ],
    test: /statement\s*[-–]?\s*(i|1|ii|2)\b|following statements|consider the following/i,
  },
  {
    id: 'match',
    title: 'Match the following',
    what: 'Two columns to pair up, then pick the option showing the right pairing.',
    trap:
      'Trying to match all four at once. The options are built so that two pairs look plausible in several combinations — if you work top to bottom you can talk yourself into a wrong set.',
    method: [
      'Find the ONE pair you are certain about first.',
      'Cross out every option that contradicts it. That usually removes half.',
      'Find your next most certain pair and repeat.',
      'You rarely need to know all four — two certainties normally leave one option standing.',
    ],
    test: /match the|column\s*[-–]?\s*i|correctly matched/i,
  },
  {
    id: 'negative',
    title: 'The "NOT" question',
    what: 'You are asked which option is false, incorrect, or does not belong.',
    trap:
      'Reading straight past the "not". Under time pressure the eye takes in a familiar question and answers the ordinary version of it — so you pick a correct statement, which is exactly the wrong answer here.',
    method: [
      'Underline the NOT / EXCEPT / INCORRECT as you read it.',
      'Judge every option as simply true or false first.',
      'Then pick the false one — do not try to hold the inversion in your head while reading.',
      'Before moving on, re-read the question stem once. This is the single easiest mark to throw away.',
    ],
    test: /\bnot\b[^.?]{0,40}(correct|true|appropriate)|which[^.?]{0,25}\bnot\b|except\b|incorrect/i,
  },
  {
    id: 'pedagogyScenario',
    title: 'Classroom scenario (pedagogy)',
    what:
      'A teacher does something in a classroom and you choose what it shows, or what she should do next. Twenty of your sixty Social Studies marks are these.',
    trap:
      'Choosing the answer that sounds strictest or most traditional. CTET pedagogy consistently rewards the option that treats the child as active, builds understanding over recall, uses evidence and local context, and assesses to help learning rather than to rank. The harsh-sounding option is almost never it.',
    method: [
      'Ask what the teacher is trying to develop — understanding, or memory?',
      'Prefer the option where children do the thinking: enquire, discuss, observe, compare.',
      'Reject options that rely on rote learning, punishment, labelling, or comparing children with each other.',
      'For assessment questions, prefer continuous and diagnostic over one final judgement.',
    ],
    test: /teacher|classroom|class room|students? (are|is|were|should)|pedagog|assessment|evaluation/i,
  },
];

/** The archetypes a question matches, most specific first. */
export function archetypesFor(stem: string): Archetype[] {
  const text = stem || '';
  return ARCHETYPES.filter((a) => a.test.test(text));
}

/**
 * The single most useful card for a question.
 *
 * Ordered by how specific the pattern is: a classroom scenario that is ALSO an
 * assertion-reason question is best taught as assertion-reason, because that is
 * where the mark is actually lost.
 */
export function primaryArchetype(stem: string): Archetype | null {
  const hits = archetypesFor(stem);
  if (!hits.length) return null;
  const order: ArchetypeId[] = [
    'assertionReason',
    'match',
    'statements',
    'negative',
    'pedagogyScenario',
  ];
  return hits.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
}

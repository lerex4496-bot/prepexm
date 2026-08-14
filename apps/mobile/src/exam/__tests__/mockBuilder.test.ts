import {
  BLUEPRINTS,
  DRILL_SIZE,
  SECTIONS,
  buildMock,
  isMockId,
  mockIdFor,
  mockPaper,
  mockSeed,
  newMockSeed,
  parseMockId,
} from '../mockBuilder';
import type { LoadedQuestion } from '@/db/content';

/**
 * The two promises a mock makes, and what breaks if either is wrong:
 *
 *   1. Same seed -> same paper. If this fails, leaving a mock mid-test and
 *      coming back hands her a DIFFERENT paper with her old answers mapped onto
 *      it — every answer silently attached to the wrong question.
 *   2. No question twice. If this fails she answers the same item twice in one
 *      150-question sitting and her score misrepresents her readiness.
 *
 * Both are invisible on screen. Neither would be caught by opening the app and
 * looking at it, which is why they are tested here.
 */

function question(id: string, subject: string): LoadedQuestion {
  return {
    id,
    paper_id: 'p1',
    number: 1,
    part: null,
    subject,
    stem_en: `stem ${id}`,
    stem_hi: null,
    passage_en: null,
    passage_hi: null,
    extraction_en: null,
    extraction_hi: null,
    topic_id: null,
    explanation_en: null,
    explanation_hi: null,
    explanation_gu: null,
    status: 'ok',
    multi_key: 0,
    key_raw: '1',
    options: [],
  };
}

/** A pool big enough to fill the Social Studies blueprint several times over. */
function pool(): LoadedQuestion[] {
  const out: LoadedQuestion[] = [];
  for (const [subject, needed] of BLUEPRINTS.CTET_P2_SOCSCI) {
    for (let i = 0; i < needed * 4; i += 1) {
      out.push(question(`${subject}-${i}`, subject));
    }
  }
  return out;
}

describe('buildMock', () => {
  it('fills every section to the blueprint', () => {
    const { questions, short } = buildMock('seed-a', 'CTET_P2_SOCSCI', pool());
    expect(questions).toHaveLength(150);
    expect(short).toEqual([]);

    const bySubject = new Map<string, number>();
    for (const q of questions) {
      bySubject.set(q.subject!, (bySubject.get(q.subject!) ?? 0) + 1);
    }
    for (const [subject, needed] of BLUEPRINTS.CTET_P2_SOCSCI) {
      expect(bySubject.get(subject)).toBe(needed);
    }
  });

  it('is deterministic: the same seed rebuilds the identical paper', () => {
    const a = buildMock('seed-a', 'CTET_P2_SOCSCI', pool()).questions;
    const b = buildMock('seed-a', 'CTET_P2_SOCSCI', pool()).questions;
    expect(b.map((q) => q.id)).toEqual(a.map((q) => q.id));
  });

  it('does not depend on the order the pool arrives in', () => {
    // Map iteration follows insertion order, so a pool loaded in a different
    // order must still yield the same paper — otherwise "same seed, same
    // paper" holds only while the query happens to sort the same way.
    const forwards = buildMock('seed-a', 'CTET_P2_SOCSCI', pool()).questions;
    const backwards = buildMock('seed-a', 'CTET_P2_SOCSCI', [...pool()].reverse()).questions;
    expect(backwards.map((q) => q.id)).toEqual(forwards.map((q) => q.id));
  });

  it('gives different seeds different papers', () => {
    const a = buildMock('seed-a', 'CTET_P2_SOCSCI', pool()).questions;
    const b = buildMock('seed-b', 'CTET_P2_SOCSCI', pool()).questions;
    expect(b.map((q) => q.id)).not.toEqual(a.map((q) => q.id));
  });

  it('never repeats a question within one mock', () => {
    const { questions } = buildMock('seed-c', 'CTET_P2_SOCSCI', pool());
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
  });

  it('numbers questions 1..n so the paper reads like a real one', () => {
    const { questions } = buildMock('seed-d', 'CTET_P2_SOCSCI', pool());
    expect(questions.map((q) => q.number)).toEqual(
      Array.from({ length: questions.length }, (_v, i) => i + 1)
    );
  });

  it('reports a short section instead of padding from another', () => {
    // Only 10 Social Studies questions available where the blueprint wants 60.
    const thin = pool().filter(
      (q) => q.subject !== 'Social Studies / Social Science' || Number(q.id.split('-')[1]) < 10
    );
    const { questions, short } = buildMock('seed-e', 'CTET_P2_SOCSCI', thin);
    expect(short).toEqual([
      { subject: 'Social Studies / Social Science', wanted: 60, got: 10 },
    ]);
    // Short, NOT topped up from another subject.
    expect(questions).toHaveLength(100);
    const sst = questions.filter((q) => q.subject === 'Social Studies / Social Science');
    expect(sst).toHaveLength(10);
  });

  it('collapses the same question appearing under two ids', () => {
    // What a duplicated sitting looks like: set K and set I of one paper hold
    // identical questions with different ids. Both must not reach one mock.
    const base = pool();
    const twin = base.map((q) => ({ ...q, id: `${q.id}-dup`, paper_id: 'p2' }));
    const { questions } = buildMock('seed-dup', 'CTET_P2_SOCSCI', [...base, ...twin]);
    const stems = questions.map((q) => q.stem_en);
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('returns nothing for an unknown paper type rather than guessing', () => {
    expect(buildMock('seed-f', 'NEET_PHYSICS', pool())).toEqual({ questions: [], short: [] });
  });

  it('survives an empty pool without throwing', () => {
    const { questions, short } = buildMock('seed-g', 'CTET_P2_SOCSCI', []);
    expect(questions).toEqual([]);
    expect(short).toHaveLength(BLUEPRINTS.CTET_P2_SOCSCI.length);
  });
});

describe('mock ids', () => {
  it('round-trips a seed through the id', () => {
    expect(mockSeed(mockIdFor('abc123'))).toBe('abc123');
  });

  it('recognises only mock ids', () => {
    expect(isMockId(mockIdFor('x'))).toBe(true);
    // A real paper id is a bare hash and must never be treated as a mock.
    expect(isMockId('aadec8378767')).toBe(false);
  });

  it('generates distinct seeds', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => newMockSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe('mockPaper', () => {
  it('is shaped like a paper the exam player can run', () => {
    const p = mockPaper({ mode: 'full', param: '-', seed: 'seed-a' }, 'CTET_P2_SOCSCI', 150);
    expect(p.id).toBe(mockIdFor('seed-a'));
    expect(p.paper_type).toBe('CTET_P2_SOCSCI');
    expect(p.total_questions).toBe(150);
    expect(p.duration_min).toBe(150);
    // Provenance is stated, not implied: this is not a paper CBSE printed.
    expect(p.source_type).toBe('MOCK');
  });
});

describe('practice modes', () => {
  it('round-trips mode and param through the id', () => {
    const id = mockIdFor('s1', 'topic', 'ped_evaluation');
    expect(parseMockId(id)).toEqual({ mode: 'topic', param: 'ped_evaluation', seed: 's1' });
  });

  it('still reads the original bare-seed id as a full paper', () => {
    // Mocks she has already sat carry the old shape; they must keep opening.
    expect(parseMockId('mock:20260814ab')).toEqual({
      mode: 'full',
      param: '-',
      seed: '20260814ab',
    });
  });

  it('a topic drill contains only that topic', () => {
    const tagged = pool().map((q, i) => ({
      ...q,
      topic_id: i % 3 === 0 ? 'ped_evaluation' : 'geo_globe',
    }));
    const { questions } = buildMock(
      { mode: 'topic', param: 'ped_evaluation', seed: 's' },
      'CTET_P2_SOCSCI',
      tagged
    );
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((q) => q.topic_id === 'ped_evaluation')).toBe(true);
  });

  it('a section drill is that section at full length', () => {
    const { questions } = buildMock(
      { mode: 'section', param: 'sst', seed: 's' },
      'CTET_P2_SOCSCI',
      pool()
    );
    expect(questions).toHaveLength(SECTIONS.sst.count);
    expect(
      questions.every((q) => q.subject === 'Social Studies / Social Science')
    ).toBe(true);
  });

  it('a weak drill contains only questions she got wrong', () => {
    const all = pool();
    const wrong = all.slice(0, 25).map((q) => q.id);
    const { questions } = buildMock(
      { mode: 'weak', param: '-', seed: 's' },
      'CTET_P2_SOCSCI',
      all,
      wrong
    );
    expect(questions).toHaveLength(DRILL_SIZE);
    expect(questions.every((q) => wrong.includes(q.id))).toBe(true);
  });

  it('reports short rather than padding a thin topic', () => {
    const tagged = pool().map((q, i) => ({
      ...q,
      topic_id: i < 3 ? 'ped_evaluation' : 'geo_globe',
    }));
    const { questions, short } = buildMock(
      { mode: 'topic', param: 'ped_evaluation', seed: 's' },
      'CTET_P2_SOCSCI',
      tagged
    );
    expect(questions).toHaveLength(3);
    expect(short[0]).toMatchObject({ wanted: DRILL_SIZE, got: 3 });
  });

  it('drills are deterministic too', () => {
    const spec = { mode: 'section' as const, param: 'sst', seed: 'same' };
    const a = buildMock(spec, 'CTET_P2_SOCSCI', pool()).questions.map((q) => q.id);
    const b = buildMock(spec, 'CTET_P2_SOCSCI', pool()).questions.map((q) => q.id);
    expect(b).toEqual(a);
  });
});

import { chunkPages, rankChunks, tokenize } from '../search';

describe('tokenize', () => {
  it('drops the words that appear in every question', () => {
    expect(tokenize('What is the process of photosynthesis?')).toEqual(['process', 'photosynthesis']);
  });

  it('drops Hinglish filler so the real term is what gets searched', () => {
    expect(tokenize('mujhe photosynthesis samjhao bhai')).toEqual(['photosynthesis', 'bhai']);
  });

  it('keeps Devanagari and Gujarati words as terms', () => {
    expect(tokenize('बाल विकास क्या है')).toEqual(['बाल', 'विकास']);
    expect(tokenize('કોષ વિશે સમજાવો')).toEqual(['કોષ', 'વિશે', 'સમજાવો']);
  });
});

describe('rankChunks', () => {
  const chunks = [
    { page: 1, text: 'Photosynthesis is the process by which green plants make food using sunlight.' },
    { page: 2, text: 'Respiration releases energy from glucose in the mitochondria of the cell.' },
    { page: 3, text: 'The chloroplast contains chlorophyll, the pigment used in photosynthesis.' },
    { page: 4, text: 'Instructions to candidates. Do not open this booklet until told to do so.' },
  ];

  it('returns the pages about the term and leaves out the rest', () => {
    // Which of the two photosynthesis pages ranks first is BM25's call and not
    // worth pinning — what matters is that both are retrieved and that the
    // respiration page and the cover page are not.
    const hits = rankChunks('mujhe photosynthesis samjhao', chunks, 2);
    expect(hits.map((h) => h.item.page).sort()).toEqual([1, 3]);
  });

  it('returns nothing when no term matches, rather than the first chunk', () => {
    expect(rankChunks('trigonometry identities', chunks)).toEqual([]);
  });

  it('ignores a query that is nothing but stop words', () => {
    expect(rankChunks('what is the', chunks)).toEqual([]);
  });

  it('prefers the rarer term when a query mixes rare and common ones', () => {
    // "cell" is in one chunk, "the" in all of them and stopped anyway.
    expect(rankChunks('the cell', chunks, 1)[0].item.page).toBe(2);
  });
});

describe('chunkPages', () => {
  it('tags every chunk with the page it came from', () => {
    const chunks = chunkPages(['a'.repeat(200), 'b'.repeat(200)]);
    expect(chunks.map((c) => c.page)).toEqual([1, 2]);
  });

  it('splits a long page and keeps the page number on both halves', () => {
    const para = 'Photosynthesis is a process. '.repeat(60); // ~1700 chars, one paragraph
    const chunks = chunkPages([para], 400);
    expect(chunks.length).toBeGreaterThan(2);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1]));
  });

  it('breaks on blank lines rather than mid-sentence', () => {
    const page = ['x'.repeat(700), 'y'.repeat(700)].join('\n\n');
    const chunks = chunkPages([page], 800);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe('x'.repeat(700));
  });

  it('drops fragments too short to be worth retrieving', () => {
    expect(chunkPages(['12', '', 'iv'])).toEqual([]);
  });
});

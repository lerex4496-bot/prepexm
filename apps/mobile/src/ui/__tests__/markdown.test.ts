import { looksLikeMarkdown, parseInline, parseMarkdown } from '../markdown/parse';

/**
 * The cases here are taken from what the tutor actually produced on the phone,
 * plus the ways a naive renderer breaks ordinary sentences. The second group
 * matters as much as the first: a renderer that italicises half an answer
 * because it contained a multiplication sign is worse than showing the raw
 * asterisks, which is what this replaced.
 */
describe('parseInline', () => {
  it('reads the bold the tutor actually writes', () => {
    expect(parseInline('**Quick Revision Tip for CTET:** When asked…')).toEqual([
      { text: 'Quick Revision Tip for CTET:', bold: true },
      { text: ' When asked…' },
    ]);
  });

  it('reads bold in the middle of a sentence', () => {
    expect(parseInline('link it to **(a) Parent Material**, then')).toEqual([
      { text: 'link it to ' },
      { text: '(a) Parent Material', bold: true },
      { text: ', then' },
    ]);
  });

  it('keeps emphasis nested inside bold', () => {
    expect(parseInline('**Black Soil = *Deccan Trap* only**')).toEqual([
      { text: 'Black Soil = ', bold: true },
      { text: 'Deccan Trap', italic: true, bold: true },
      { text: ' only', bold: true },
    ]);
  });

  it('reads ***both*** without leaving a stray star behind', () => {
    expect(parseInline('***Deccan Trap*** is')).toEqual([
      { text: 'Deccan Trap', bold: true, italic: true },
      { text: ' is' },
    ]);
  });

  it('leaves arithmetic alone', () => {
    expect(parseInline('2 * 3 = 6 and 4 * 5 = 20')).toEqual([{ text: '2 * 3 = 6 and 4 * 5 = 20' }]);
  });

  it('leaves snake_case identifiers alone', () => {
    expect(parseInline('use max_tokens_per_call here')).toEqual([
      { text: 'use max_tokens_per_call here' },
    ]);
  });

  it('marks citation numbers so they can be coloured', () => {
    expect(parseInline('as the notes say [2] clearly')).toEqual([
      { text: 'as the notes say ' },
      { text: '[2]', cite: 2 },
      { text: ' clearly' },
    ]);
  });

  it('keeps a link label and drops the target', () => {
    expect(parseInline('see [the chapter](https://x.test/a) for more')).toEqual([
      { text: 'see ' },
      { text: 'the chapter' },
      { text: ' for more' },
    ]);
  });

  it('handles inline code without treating its contents as markup', () => {
    expect(parseInline('call `a**b**c` now')).toEqual([
      { text: 'call ' },
      { text: 'a**b**c', code: true },
      { text: ' now' },
    ]);
  });

  it('works in Devanagari', () => {
    expect(parseInline('**बाल विकास** एक प्रक्रिया है')).toEqual([
      { text: 'बाल विकास', bold: true },
      { text: ' एक प्रक्रिया है' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, and caps six levels at three', () => {
    const blocks = parseMarkdown('# One\n## Two\n#### Four');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'One' },
      { kind: 'heading', level: 2, text: 'Two' },
      { kind: 'heading', level: 3, text: 'Four' },
    ]);
  });

  it('reads a numbered list and keeps each item its own number', () => {
    const blocks = parseMarkdown('59. **Bhabar**: a porous belt\n60. **Ter**: the zone south');
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [
          { depth: 0, marker: '59.', text: '**Bhabar**: a porous belt' },
          { depth: 0, marker: '60.', text: '**Ter**: the zone south' },
        ],
      },
    ]);
  });

  it('nests bullets by indent', () => {
    const blocks = parseMarkdown('- top\n  - under\n- back');
    expect(blocks[0]).toMatchObject({
      kind: 'list',
      ordered: false,
      items: [
        { depth: 0, text: 'top' },
        { depth: 1, text: 'under' },
        { depth: 0, text: 'back' },
      ],
    });
  });

  it('joins a wrapped paragraph into one block', () => {
    expect(parseMarkdown('the zone south of\nBhabar where streams\n\nnext')).toEqual([
      { kind: 'paragraph', text: 'the zone south of Bhabar where streams' },
      { kind: 'paragraph', text: 'next' },
    ]);
  });

  it('keeps fenced code literal', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```');
    expect(blocks).toEqual([{ kind: 'code', text: '# not a heading\n- not a list' }]);
  });

  it('reads a pipe table', () => {
    const blocks = parseMarkdown('| Soil | Crop |\n| --- | --- |\n| Black | Cotton |');
    expect(blocks).toEqual([
      { kind: 'table', header: ['Soil', 'Crop'], rows: [['Black', 'Cotton']] },
    ]);
  });

  it('does not turn a sentence with a bar in it into a table', () => {
    const blocks = parseMarkdown('the notation a | b means or');
    expect(blocks[0].kind).toBe('paragraph');
  });

  it('reads a block quote', () => {
    expect(parseMarkdown('> Photosynthesis is the process\n> by which plants')).toEqual([
      { kind: 'quote', text: 'Photosynthesis is the process by which plants' },
    ]);
  });

  it('reads a horizontal rule but not a list dash', () => {
    expect(parseMarkdown('---')).toEqual([{ kind: 'rule' }]);
    expect(parseMarkdown('- one')[0].kind).toBe('list');
  });
});

describe('looksLikeMarkdown', () => {
  it('is true for the answers that were rendering as raw syntax', () => {
    expect(looksLikeMarkdown('**Quick Revision Tip:** link it')).toBe(true);
    expect(looksLikeMarkdown('## Soils of India\nBlack soil is')).toBe(true);
    expect(looksLikeMarkdown('1. First\n2. Second')).toBe(true);
  });

  it('is false for an ordinary sentence, so it takes the plain path', () => {
    expect(looksLikeMarkdown('Photosynthesis happens in the chloroplast.')).toBe(false);
    expect(looksLikeMarkdown('बाल विकास एक सतत प्रक्रिया है।')).toBe(false);
  });
});

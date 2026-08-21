import fs from 'node:fs';
import path from 'node:path';

import { extractPdfText, parseCMap, tidy } from '../pdfText';

/**
 * Run against the REAL papers in content/raw rather than a synthetic fixture.
 *
 * A hand-built PDF proves nothing here: the failure modes that matter — object
 * streams, fragment-per-BT/ET generators, inherited resources, xref tables
 * that no longer match the file — only appear in documents produced by real
 * software. These are the exact files this app is about.
 */
const RAW = path.resolve(__dirname, '../../../../../content/raw/ctet/august-2023/paper2_SetE');

function read(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(RAW, name)));
}

const maybe = fs.existsSync(RAW) ? describe : describe.skip;

// Extraction yields to the event loop after every page so the phone's UI stays
// responsive (see extractPdfText). That is a few seconds for a 64-page paper,
// which is the intended behaviour and well past jest's 5-second default.
jest.setTimeout(120_000);

maybe('extractPdfText', () => {
  it('reads a real CTET paper as continuous text', async () => {
    const r = await extractPdfText(read('EH-II 2023 set E.pdf'));

    expect(r.pageCount).toBe(64);
    expect(r.extractability).toBeGreaterThan(0.8);

    const all = tidy(r.pages.join('\n'));
    expect(all.length).toBeGreaterThan(50000);
    // Content, not merely bytes — this is text that is on the paper.
    expect(all).toMatch(/Test Booklet/);
    expect(all).toMatch(/Language I and\/or Language II/);
    expect(all).not.toMatch(/�/);
  });

  it('keeps a sentence on one line instead of one line per fragment', async () => {
    // The generator wraps every fragment in its own BT/ET, so a naive reader
    // returns "T / est / B / ooklet". Line breaks come from the baseline.
    const all = (await extractPdfText(read('EH-II 2023 set E.pdf'))).pages.join('\n');
    expect(all).toMatch(/only questions pertaining to English and Hindi language/);
  });

  /**
   * The 2023 language papers set their Indic text in legacy pre-Unicode fonts
   * with no `/ToUnicode` map, so the codes decode to Latin gibberish
   * ("{bV n[aH$bH$"). The REQUIREMENT is not that we read them — nothing short
   * of OCR can — it is that we do not hand that gibberish to the model as if
   * it were her notes. A low extractability score is the correct answer, and
   * the caller turns it into "photograph the page instead".
   */
  it('scores a legacy-font paper as unreadable rather than returning mojibake', async () => {
    for (const f of ['SANSKRIT-II set E.pdf', 'GUJARATI II set E.pdf', 'BENGALI II set E.pdf']) {
      expect((await extractPdfText(read(f))).extractability).toBeLessThan(0.3);
    }
  });

  it('gives up on a file that is not a PDF instead of hanging', async () => {
    expect((await extractPdfText(new Uint8Array(2000).fill(0x41))).extractability).toBe(0);
  });

  it('reports progress per page, so the UI can say where it has got to', async () => {
    const seen: number[] = [];
    const r = await extractPdfText(read('EH-II 2023 set E.pdf'), (done) => seen.push(done));
    expect(seen).toHaveLength(r.pageCount);
    expect(seen[seen.length - 1]).toBe(r.pageCount);
  });
});

describe('parseCMap', () => {
  it('maps single characters from a bfchar section', () => {
    const m = parseCMap(`
      2 beginbfchar
      <0003> <0041>
      <0004> <0042>
      endbfchar
    `);
    expect(m.get(3)).toBe('A');
    expect(m.get(4)).toBe('B');
  });

  it('walks a bfrange with an incrementing destination', () => {
    const m = parseCMap('1 beginbfrange\n<0010> <0013> <0061>\nendbfrange');
    expect([m.get(0x10), m.get(0x11), m.get(0x12), m.get(0x13)]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('walks a bfrange with an explicit destination array', () => {
    const m = parseCMap('1 beginbfrange\n<0020> <0022> [<0058> <0059> <005A>]\nendbfrange');
    expect([m.get(0x20), m.get(0x21), m.get(0x22)]).toEqual(['X', 'Y', 'Z']);
  });

  it('keeps multi-unit destinations, which is how ligatures and clusters map', () => {
    // A "fi" ligature glyph, and a Devanagari कि cluster.
    const m = parseCMap('2 beginbfchar\n<0005> <00660069>\n<0006> <0915093F>\nendbfchar');
    expect(m.get(5)).toBe('fi');
    expect(m.get(6)).toBe('कि');
  });
});

describe('tidy', () => {
  it('rejoins words hyphenated across a line break', () => {
    expect(tidy('photosyn-\nthesis is')).toBe('photosynthesis is');
  });

  it('collapses runs of blank lines', () => {
    expect(tidy('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});

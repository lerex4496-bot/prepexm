/**
 * Reading the text out of a PDF, on the phone, with no server.
 *
 * WHY THIS EXISTS
 * ---------------
 * Attaching her own notes used to POST the file to the StudyMate API, which
 * extracted the text and chunked it. With no server running that button did
 * not degrade — it failed outright with "no API address configured", which is
 * a sentence about our infrastructure shown to a student who wanted to ask
 * about her syllabus PDF.
 *
 * WHAT IT DOES AND DOES NOT READ
 * ------------------------------
 * It reads the text layer: the characters the PDF actually stores. A PDF that
 * is a photograph of a page — a scan — has no text layer, and nothing here can
 * invent one. That case is DETECTED rather than guessed at: `extractability`
 * reports the share of pages that yielded usable text, and the caller tells
 * her to photograph the page instead, which does run OCR.
 *
 * Character codes are mapped through each font's `/ToUnicode` CMap where one
 * exists. This is the difference between real text and mojibake: subset fonts
 * routinely number their glyphs from 1, so the raw code for "A" may be 0x03,
 * and reading the bytes directly produces control characters that look like a
 * decoding bug. Where a font has no CMap the codes are read as Latin-1, which
 * is right for the standard encodings and wrong for a subset font — which is
 * exactly what the readability check below is for.
 */

import {
  Lexer,
  PdfDocument,
  asArray,
  dictGet,
  isName,
  latin1,
  type PdfObject,
  type PdfValue,
} from './pdfObjects';
import { WORD_CHARS } from '@/i18n/script';

export interface PdfText {
  /** One entry per page, in reading order. */
  pages: string[];
  pageCount: number;
  /** Share of pages that yielded usable text: 0 for a scan, ~1 for a real PDF. */
  extractability: number;
}

/**
 * A phone is not a workstation, and this whole pipeline holds the file, its
 * latin-1 copy and every decompressed stream in memory at once. 12 MB of PDF
 * is a long syllabus or a full previous paper; beyond that the honest answer
 * is to say so rather than to be killed by the OS mid-parse.
 */
export const MAX_PDF_BYTES = 12 * 1024 * 1024;

export class PdfTooLarge extends Error {}

/** Hand the runtime back the thread, so touches and animation still land. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * ASYNC, AND YIELDING PER PAGE, WHICH IS NOT AN OPTIMISATION.
 *
 * A 64-page paper takes ~4 seconds of solid work, and JavaScript on the phone
 * has one thread. Run straight through, that is four seconds during which the
 * app does not redraw and does not respond to a tap — indistinguishable from a
 * freeze, on the screen where she has just been told something is happening.
 *
 * Yielding between pages costs a few milliseconds and keeps the UI alive, and
 * `onProgress` lets the caller say "page 12 of 64" instead of leaving a
 * spinner to imply the app has died.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  onProgress?: (done: number, total: number) => void
): Promise<PdfText> {
  if (bytes.length > MAX_PDF_BYTES) {
    throw new PdfTooLarge(`this PDF is ${Math.round(bytes.length / 1024 / 1024)} MB`);
  }
  const doc = new PdfDocument(latin1(bytes));
  const pages = orderedPages(doc);
  await yieldToUi();

  const out: string[] = [];
  for (const page of pages) {
    try {
      out.push(extractPage(doc, page));
    } catch {
      // One unreadable page is not a reason to lose the other two hundred.
      out.push('');
    }
    onProgress?.(out.length, pages.length);
    await yieldToUi();
  }

  const usable = out.filter((p) => readable(p)).length;
  return {
    pages: out,
    pageCount: out.length,
    extractability: out.length ? usable / out.length : 0,
  };
}

const LETTERS = new RegExp(`[${WORD_CHARS}]`, 'g');
const ORDINARY = new RegExp(`[${WORD_CHARS}\\s.,;:'"()\\-–—/%?!₹+=*\\[\\]]`, 'g');

/**
 * Does this page's text look like language rather than like a failed decode?
 *
 * A page of a scan yields nothing, and a page whose fonts we mis-decoded
 * yields plenty of characters that are not letters. Both must be caught, so
 * the test is on the SHAPE of the text, not on its length: at least 40 letters
 * and a clear majority of the non-space characters being letters, digits or
 * ordinary punctuation.
 */
function readable(text: string): boolean {
  const solid = text.replace(/\s+/g, '');
  if (solid.length < 40) return false;
  const letters = (text.match(LETTERS) ?? []).length;
  if (letters < 40) return false;
  const ordinary = (text.match(ORDINARY) ?? []).length;
  return ordinary / text.length > 0.85 && letters / solid.length > 0.55;
}

// ---------------------------------------------------------------------------
// Page tree
// ---------------------------------------------------------------------------

/**
 * The page objects, in the order she would read them.
 *
 * Walks `/Root → /Pages → /Kids`, which is the only place reading order is
 * recorded. The fallback — every `/Type /Page` in object-number order — is
 * usually right and occasionally shuffled, which is worth it: a shuffled
 * document still answers her questions, a failed one answers nothing.
 */
function orderedPages(doc: PdfDocument): PdfValue[] {
  const root = catalog(doc);
  const pagesRoot = doc.resolve(dictGet(root, 'Pages'));
  const found: PdfValue[] = [];

  const walk = (node: PdfValue | null, depth: number): void => {
    if (!node || depth > 64 || found.length > 5000) return;
    const kids = doc.resolve(dictGet(node, 'Kids'));
    if (kids) {
      for (const kid of asArray(kids)) walk(doc.resolve(kid), depth + 1);
      return;
    }
    if (isName(dictGet(node, 'Type'), 'Page') || dictGet(node, 'Contents')) found.push(node);
  };
  walk(pagesRoot, 0);
  if (found.length) return found;

  return [...doc.objects.keys()]
    .sort((a, b) => a - b)
    .map((n) => doc.objects.get(n)!.value)
    .filter((v) => isName(dictGet(v, 'Type'), 'Page'));
}

function catalog(doc: PdfDocument): PdfValue | null {
  // The trailer names the catalog. Cheapest reliable route: the last `/Root`
  // in the file, which is the most recent incremental update's trailer.
  const idx = doc.s.lastIndexOf('/Root');
  if (idx >= 0) {
    const lex = new Lexer(doc.s, idx + '/Root'.length);
    const ref = lex.value();
    const resolved = doc.resolve(ref);
    if (dictGet(resolved, 'Pages')) return resolved;
  }
  for (const obj of doc.objects.values()) {
    if (isName(dictGet(obj.value, 'Type'), 'Catalog')) return obj.value;
  }
  return null;
}

/**
 * `/Resources` is inheritable: a page that does not carry one uses its
 * parent's. Missing this makes every font lookup fail on documents that
 * declare their fonts once at the page-tree root.
 */
function inherited(doc: PdfDocument, page: PdfValue, key: string): PdfValue | null {
  let node: PdfValue | null = page;
  for (let depth = 0; node && depth < 64; depth++) {
    const own = doc.resolve(dictGet(node, key));
    if (own) return own;
    node = doc.resolve(dictGet(node, 'Parent'));
  }
  return null;
}

function extractPage(doc: PdfDocument, page: PdfValue): string {
  const streams = asArray(dictGet(page, 'Contents'))
    .map((ref) => doc.object(ref) ?? (doc.resolve(ref) ? null : null))
    .filter((o): o is PdfObject => !!o && !!o.raw);

  let content = '';
  for (const s of streams) {
    try {
      content += latin1(doc.decodeStream(s)) + '\n';
    } catch {
      /* a stream we cannot inflate contributes nothing */
    }
  }
  if (!content) return '';

  const fonts = fontMap(doc, inherited(doc, page, 'Resources'));
  return runContent(content, fonts);
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

interface Font {
  /** Character code → string. Absent for fonts with no `/ToUnicode`. */
  toUnicode: Map<number, string> | null;
  /** Composite (Type0) fonts address glyphs with two bytes, simple ones with one. */
  twoByte: boolean;
}

const FALLBACK_FONT: Font = { toUnicode: null, twoByte: false };

function fontMap(doc: PdfDocument, resources: PdfValue | null): Map<string, Font> {
  const out = new Map<string, Font>();
  const fonts = doc.resolve(dictGet(resources, 'Font'));
  if (!fonts || typeof fonts !== 'object' || fonts.t !== 'dict') return out;

  for (const [name, ref] of fonts.v) {
    const font = doc.resolve(ref);
    if (!font) continue;
    const twoByte = isName(doc.resolve(dictGet(font, 'Subtype')), 'Type0');
    const cmapObj = doc.object(dictGet(font, 'ToUnicode'));
    let toUnicode: Map<number, string> | null = null;
    if (cmapObj) {
      try {
        toUnicode = parseCMap(latin1(doc.decodeStream(cmapObj)));
      } catch {
        toUnicode = null;
      }
    }
    out.set(name, { toUnicode, twoByte });
  }
  return out;
}

/**
 * Parse the `beginbfchar` / `beginbfrange` sections of a `/ToUnicode` CMap.
 *
 * Destination values are UTF-16BE and may be several code units long — a
 * ligature glyph maps to "fi", and a Devanagari conjunct to a whole cluster —
 * so each entry maps to a STRING, not to a single character.
 */
export function parseCMap(text: string): Map<number, string> {
  const map = new Map<number, string>();

  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = charRe.exec(text)) !== null) {
    const items = hexTokens(m[1]);
    for (let i = 0; i + 1 < items.length; i += 2) {
      const src = items[i];
      const dst = items[i + 1];
      if (src.kind !== 'hex' || dst.kind !== 'hex') continue;
      map.set(codeOf(src.hex), utf16be(dst.hex));
    }
  }

  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(text)) !== null) {
    const items = hexTokens(m[1]);
    let i = 0;
    while (i + 2 < items.length) {
      const lo = items[i];
      const hi = items[i + 1];
      const dst = items[i + 2];
      if (lo.kind !== 'hex' || hi.kind !== 'hex') {
        i++;
        continue;
      }
      const from = codeOf(lo.hex);
      // Capped: a corrupt `<0000> <FFFF>` range would otherwise allocate 65k
      // entries per range and there can be many.
      const to = Math.min(codeOf(hi.hex), from + 65535);

      if (dst.kind === 'array') {
        dst.items.forEach((h, k) => map.set(from + k, utf16be(h)));
      } else if (dst.kind === 'hex') {
        const base = dst.hex;
        // The last code unit increments across the range; the prefix (a
        // surrogate lead, or a base consonant) stays as it is.
        const head = base.slice(0, Math.max(0, base.length - 4));
        const tail = parseInt(base.slice(-4) || '0', 16);
        for (let c = from; c <= to; c++) {
          map.set(c, utf16be(head + ((tail + c - from) & 0xffff).toString(16).padStart(4, '0')));
        }
      }
      i += 3;
    }
  }
  return map;
}

type CMapToken =
  | { kind: 'hex'; hex: string }
  | { kind: 'array'; items: string[] }
  | { kind: 'other' };

function hexTokens(section: string): CMapToken[] {
  const out: CMapToken[] = [];
  const re = /<([0-9a-fA-F\s]*)>|\[([\s\S]*?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    if (m[1] !== undefined) {
      out.push({ kind: 'hex', hex: m[1].replace(/\s+/g, '') });
    } else {
      const items = [...m[2].matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => x[1].replace(/\s+/g, ''));
      out.push({ kind: 'array', items });
    }
  }
  return out;
}

function codeOf(hex: string): number {
  return parseInt(hex || '0', 16) || 0;
}

function utf16be(hex: string): string {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const unit = parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16);
    if (Number.isFinite(unit)) out += String.fromCharCode(unit);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Content streams
// ---------------------------------------------------------------------------

/**
 * Walk a page's content stream and collect what it draws as text.
 *
 * Only the text operators matter: `Tf` picks the font (and therefore the
 * encoding), `Tj`/`'`/`"`/`TJ` draw strings, and the positioning operators say
 * where. Everything else — paths, images, colour — is stepped over.
 *
 * LINE BREAKS ARE INFERRED FROM THE Y COORDINATE, not from the operators.
 *
 * The obvious rule — "every `Td` or `Tm` starts a new line" — is wrong, and
 * visibly so: generators emit a fresh `Tm` mid-word to kern or to switch
 * style, and following that rule shredded a heading into "T / est / B /
 * ooklet". So the text line matrix is tracked, and a new line is only started
 * when the baseline actually MOVES — which is what a line break physically is.
 *
 * Inside a `TJ` array, a kern of more than a fifth of an em is how most
 * generators write a space, so it becomes one.
 */
function runContent(content: string, fonts: Map<string, Font>): string {
  const lex = new Lexer(content);
  const operands: PdfValue[] = [];
  let font = FALLBACK_FONT;

  const out: string[] = [];
  let line = '';
  // Translation of the text line matrix. Rotation and scale are ignored: this
  // is looking for "did the baseline move", not laying anything out.
  let x = 0;
  let y = 0;
  let leading = 0;
  let drawnY: number | null = null;

  const endLine = (): void => {
    if (line.trim()) out.push(line.replace(/\s+$/, ''));
    line = '';
    drawnY = null;
  };

  /** Called before each show operator: break the line if the baseline moved. */
  const beforeShow = (): void => {
    if (drawnY !== null && Math.abs(y - drawnY) > 1.5) endLine();
    drawnY = y;
  };

  const num = (i: number): number => {
    const v = operands[operands.length - i];
    return typeof v === 'number' ? v : 0;
  };

  for (;;) {
    lex.skip();
    if (lex.i >= content.length) break;

    const value = lex.value();
    if (value !== null) {
      operands.push(value);
      if (operands.length > 64) operands.shift();
      continue;
    }

    const op = lex.takeWord();
    if (!op) {
      lex.i++;
      continue;
    }

    switch (op) {
      case 'BT':
        x = 0;
        y = 0;
        break;
      case 'Tf': {
        const name = operands[operands.length - 2];
        if (name && typeof name === 'object' && name.t === 'name') {
          font = fonts.get(name.v) ?? FALLBACK_FONT;
        }
        break;
      }
      case 'TL':
        leading = num(1);
        break;
      case 'Td':
        x += num(2);
        y += num(1);
        break;
      case 'TD':
        x += num(2);
        y += num(1);
        leading = -num(1);
        break;
      case 'Tm':
        x = num(2);
        y = num(1);
        break;
      case 'T*':
        y -= leading;
        break;
      case 'Tj': {
        beforeShow();
        const s = operands[operands.length - 1];
        if (s && typeof s === 'object' && s.t === 'str') line += decodeString(s.v, font);
        break;
      }
      case "'":
      case '"': {
        // Both move to the next line before showing their string.
        y -= leading;
        beforeShow();
        const s = operands[operands.length - 1];
        if (s && typeof s === 'object' && s.t === 'str') line += decodeString(s.v, font);
        break;
      }
      case 'TJ': {
        beforeShow();
        const arr = operands[operands.length - 1];
        if (arr && typeof arr === 'object' && arr.t === 'arr') {
          for (const item of arr.v) {
            if (typeof item === 'number') {
              if (item <= -200 && line && !line.endsWith(' ')) line += ' ';
            } else if (typeof item === 'object' && item.t === 'str') {
              line += decodeString(item.v, font);
            }
          }
        }
        break;
      }
      case 'ET':
        // Deliberately NOT a line break. Plenty of generators wrap every
        // single fragment in its own BT/ET pair, and breaking here put
        // "Test Booklet" on four lines. The baseline is the only signal.
        break;
      default:
        break;
    }
    operands.length = 0;
  }

  endLine();
  return out.join('\n');
}

function decodeString(raw: string, font: Font): string {
  const { toUnicode, twoByte } = font;

  if (!toUnicode) {
    // No CMap. For a standard-encoded font the bytes ARE the characters for
    // everything a syllabus PDF uses; control bytes are dropped rather than
    // rendered, so a subset font shows up as missing text and not as noise.
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i) & 0xff;
      if (c === 9 || c === 10 || c === 13) out += ' ';
      else if (c >= 32) out += String.fromCharCode(c);
    }
    return out;
  }

  let out = '';
  const step = twoByte ? 2 : 1;
  for (let i = 0; i < raw.length; i += step) {
    const code =
      step === 2
        ? ((raw.charCodeAt(i) & 0xff) << 8) | (raw.charCodeAt(i + 1) & 0xff)
        : raw.charCodeAt(i) & 0xff;
    const mapped = toUnicode.get(code);
    if (mapped !== undefined) out += mapped;
    else if (!twoByte && code >= 32) out += String.fromCharCode(code);
  }
  return out;
}

/** A word broken across a line end by a hyphen, in any of the three scripts. */
const HYPHEN_BREAK = new RegExp(`([${WORD_CHARS}])-\\n([${WORD_CHARS}])`, 'g');

/**
 * Tidy the extracted text into something worth putting in a prompt.
 *
 * A PDF's text layer is full of soft hyphens at line ends, runs of blank
 * lines, and page furniture. This is cheap and only does the safe parts.
 */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(HYPHEN_BREAK, '$1$2') // word split across a line break
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

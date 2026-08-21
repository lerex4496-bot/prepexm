/**
 * The small part of the PDF object model this app needs.
 *
 * SCOPE, STATED UP FRONT
 * ----------------------
 * This is not a PDF library. It reads indirect objects, dictionaries, arrays,
 * names, strings and streams — enough to walk a page tree, find each page's
 * content and fonts, and decompress them. It does not render, does not handle
 * encryption, and does not care about anything visual.
 *
 * It finds objects by SCANNING for `N G obj` rather than by reading the
 * cross-reference table. That is deliberate: xref tables are the first thing
 * to go stale in a file that has been edited, merged or produced by a careless
 * generator, and a scan does not care. Objects that live inside compressed
 * object streams (`/ObjStm`, normal in any PDF 1.5+) are expanded afterwards,
 * because those are invisible to a scan.
 */

import { inflate } from './inflate';

export type PdfValue =
  | number
  | { t: 'name'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ref'; num: number; gen: number }
  | { t: 'arr'; v: PdfValue[] }
  | { t: 'dict'; v: Map<string, PdfValue> }
  | { t: 'bool'; v: boolean }
  | { t: 'null' };

export interface PdfObject {
  value: PdfValue;
  /** Raw, still-encoded stream bytes, when the object has a stream. */
  raw?: Uint8Array;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWs(c: number): boolean {
  return WS.has(c);
}

function isRegular(c: number): boolean {
  return !WS.has(c) && !DELIM.has(c);
}

/**
 * A lexer over the file read as latin-1, where one character is one byte.
 *
 * Latin-1 rather than UTF-8 on purpose: a PDF is binary, and decoding it as
 * UTF-8 would replace every byte above 0x7f with U+FFFD and destroy exactly
 * the byte offsets everything here depends on.
 */
export class Lexer {
  constructor(
    readonly s: string,
    public i = 0
  ) {}

  skip(): void {
    for (;;) {
      while (this.i < this.s.length && isWs(this.s.charCodeAt(this.i))) this.i++;
      if (this.s[this.i] !== '%') return;
      while (this.i < this.s.length && this.s.charCodeAt(this.i) !== 0x0a) this.i++;
    }
  }

  /** The next bare keyword (`obj`, `stream`, `Tj`, …) without consuming it. */
  peekWord(): string {
    this.skip();
    let j = this.i;
    while (j < this.s.length && isRegular(this.s.charCodeAt(j))) j++;
    return this.s.slice(this.i, j);
  }

  takeWord(): string {
    const w = this.peekWord();
    this.i += w.length;
    return w;
  }

  /**
   * Parse one object. Returns null at end of input or on a token that does not
   * begin an object (a content-stream operator, `endobj`, `]`, …), leaving `i`
   * where it was so the caller can read it as a keyword instead.
   */
  value(): PdfValue | null {
    this.skip();
    if (this.i >= this.s.length) return null;
    const c = this.s[this.i];

    if (c === '/') return { t: 'name', v: this.name() };
    if (c === '(') return { t: 'str', v: this.literalString() };
    if (c === '[') return this.array();
    if (c === '<') {
      return this.s[this.i + 1] === '<' ? this.dict() : { t: 'str', v: this.hexString() };
    }
    if (c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) return this.numberOrRef();

    const w = this.peekWord();
    if (w === 'true' || w === 'false') {
      this.i += w.length;
      return { t: 'bool', v: w === 'true' };
    }
    if (w === 'null') {
      this.i += 4;
      return { t: 'null' };
    }
    return null;
  }

  name(): string {
    this.i++; // '/'
    let out = '';
    while (this.i < this.s.length && isRegular(this.s.charCodeAt(this.i))) {
      const ch = this.s[this.i];
      if (ch === '#' && this.i + 2 < this.s.length) {
        const hex = this.s.slice(this.i + 1, this.i + 3);
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 3;
          continue;
        }
      }
      out += ch;
      this.i++;
    }
    return out;
  }

  literalString(): string {
    this.i++; // '('
    let depth = 1;
    let out = '';
    while (this.i < this.s.length) {
      const ch = this.s[this.i++];
      if (ch === '\\') {
        const e = this.s[this.i++];
        if (e === 'n') out += '\n';
        else if (e === 'r') out += '\r';
        else if (e === 't') out += '\t';
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === '\n') continue; // line continuation
        else if (e === '\r') {
          if (this.s[this.i] === '\n') this.i++;
          continue;
        } else if (e >= '0' && e <= '7') {
          let oct = e;
          while (oct.length < 3 && this.s[this.i] >= '0' && this.s[this.i] <= '7') {
            oct += this.s[this.i++];
          }
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else out += e;
        continue;
      }
      if (ch === '(') depth++;
      if (ch === ')' && --depth === 0) break;
      out += ch;
    }
    return out;
  }

  hexString(): string {
    this.i++; // '<'
    let hex = '';
    while (this.i < this.s.length && this.s[this.i] !== '>') {
      const ch = this.s[this.i++];
      if (/[0-9a-fA-F]/.test(ch)) hex += ch;
    }
    this.i++; // '>'
    if (hex.length % 2) hex += '0'; // an odd final digit is padded, per the spec
    let out = '';
    for (let k = 0; k < hex.length; k += 2) {
      out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
    }
    return out;
  }

  array(): PdfValue {
    this.i++; // '['
    const items: PdfValue[] = [];
    for (;;) {
      this.skip();
      if (this.i >= this.s.length) break;
      if (this.s[this.i] === ']') {
        this.i++;
        break;
      }
      const v = this.value();
      if (v === null) {
        // An operator or junk inside an array: step over one token, so that a
        // malformed file cannot spin here forever.
        const w = this.takeWord();
        if (!w) this.i++;
        continue;
      }
      items.push(v);
    }
    return { t: 'arr', v: items };
  }

  dict(): PdfValue {
    this.i += 2; // '<<'
    const map = new Map<string, PdfValue>();
    for (;;) {
      this.skip();
      if (this.i >= this.s.length) break;
      if (this.s[this.i] === '>' && this.s[this.i + 1] === '>') {
        this.i += 2;
        break;
      }
      if (this.s[this.i] !== '/') {
        const w = this.takeWord();
        if (!w) this.i++;
        continue;
      }
      const key = this.name();
      const v = this.value();
      if (v !== null) map.set(key, v);
    }
    return { t: 'dict', v: map };
  }

  /** A number, or `n g R` when the three tokens form an indirect reference. */
  numberOrRef(): PdfValue {
    const start = this.i;
    const first = this.number();
    if (Number.isInteger(first) && first >= 0) {
      const save = this.i;
      this.skip();
      const j = this.i;
      if (j < this.s.length && this.s[j] >= '0' && this.s[j] <= '9') {
        const gen = this.number();
        this.skip();
        if (this.s[this.i] === 'R' && !isRegular(this.s.charCodeAt(this.i + 1))) {
          this.i++;
          return { t: 'ref', num: first, gen };
        }
      }
      this.i = save;
    }
    if (this.i === start) this.i++; // never stall
    return first;
  }

  number(): number {
    this.skip();
    const start = this.i;
    if (this.s[this.i] === '+' || this.s[this.i] === '-') this.i++;
    while (this.i < this.s.length && /[0-9.]/.test(this.s[this.i])) this.i++;
    const n = parseFloat(this.s.slice(start, this.i));
    return Number.isFinite(n) ? n : 0;
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export class PdfDocument {
  readonly objects = new Map<number, PdfObject>();

  constructor(readonly s: string) {
    this.scan();
    this.expandObjectStreams();
  }

  /** Every `N G obj … endobj` in the file, later definitions winning. */
  private scan(): void {
    const re = /(?:^|[^0-9])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.s)) !== null) {
      const num = parseInt(m[1], 10);
      const lex = new Lexer(this.s, m.index + m[0].length);
      let value: PdfValue | null;
      try {
        value = lex.value();
      } catch {
        continue;
      }
      if (value === null) continue;

      let raw: Uint8Array | undefined;
      if (lex.peekWord() === 'stream') raw = this.readStream(lex, value);

      // An incremental update repeats object numbers, and the scan keeps
      // going, so the LAST definition in the file is the one kept — which is
      // the one the reader would have used.
      this.objects.set(num, raw ? { value, raw } : { value });
    }
  }

  private readStream(lex: Lexer, dictValue: PdfValue): Uint8Array | undefined {
    lex.i += 'stream'.length;
    // Exactly CRLF or LF follows the keyword. Anything else and the offsets
    // are already wrong, so we fall back to searching for `endstream`.
    if (this.s[lex.i] === '\r') lex.i++;
    if (this.s[lex.i] === '\n') lex.i++;
    const start = lex.i;

    let end = -1;
    const declared = this.asNumber(dictGet(dictValue, 'Length'));
    if (declared !== null && declared >= 0 && start + declared <= this.s.length) {
      if (/^\s*endstream/.test(this.s.slice(start + declared, start + declared + 20))) {
        end = start + declared;
      }
    }
    if (end < 0) {
      const found = this.s.indexOf('endstream', start);
      if (found < 0) return undefined;
      end = found;
      // Trim the EOL the writer put before `endstream`.
      if (this.s[end - 1] === '\n') end--;
      if (this.s[end - 1] === '\r') end--;
    }

    const out = new Uint8Array(Math.max(0, end - start));
    for (let k = 0; k < out.length; k++) out[k] = this.s.charCodeAt(start + k) & 0xff;
    return out;
  }

  /**
   * Pull the objects hidden inside `/Type /ObjStm` streams into the map.
   *
   * Without this a PDF 1.5+ file looks almost empty: the catalog, the page
   * tree, the font dictionaries — everything that is not itself a stream —
   * lives in there, and a raw scan sees only the content streams.
   */
  private expandObjectStreams(): void {
    for (const obj of [...this.objects.values()]) {
      if (!obj.raw) continue;
      if (!isName(dictGet(obj.value, 'Type'), 'ObjStm')) continue;

      let text: string;
      try {
        text = latin1(this.decodeStream(obj));
      } catch {
        continue;
      }
      const n = this.asNumber(dictGet(obj.value, 'N')) ?? 0;
      const first = this.asNumber(dictGet(obj.value, 'First')) ?? 0;

      const header = new Lexer(text.slice(0, first));
      const pairs: [number, number][] = [];
      for (let k = 0; k < n; k++) pairs.push([header.number(), header.number()]);

      for (const [num, off] of pairs) {
        if (this.objects.has(num)) continue; // a top-level definition wins
        try {
          const v = new Lexer(text, first + off).value();
          if (v !== null) this.objects.set(num, { value: v });
        } catch {
          /* one bad entry must not cost us the rest of the stream */
        }
      }
    }
  }

  resolve(v: PdfValue | undefined | null): PdfValue | null {
    let cur = v ?? null;
    for (let guard = 0; guard < 32; guard++) {
      if (!cur || typeof cur !== 'object' || cur.t !== 'ref') return cur;
      cur = this.objects.get(cur.num)?.value ?? null;
    }
    return null;
  }

  /** The object a reference points at, so its stream can be reached. */
  object(v: PdfValue | undefined | null): PdfObject | null {
    if (v && typeof v === 'object' && v.t === 'ref') return this.objects.get(v.num) ?? null;
    return null;
  }

  asNumber(v: PdfValue | undefined | null): number | null {
    const r = this.resolve(v);
    return typeof r === 'number' ? r : null;
  }

  /** Decode a stream through its `/Filter` chain. */
  decodeStream(obj: PdfObject): Uint8Array {
    if (!obj.raw) return new Uint8Array(0);
    let data = obj.raw;

    const filters = asArray(this.resolve(dictGet(obj.value, 'Filter')));
    const parms = asArray(this.resolve(dictGet(obj.value, 'DecodeParms')));

    for (let k = 0; k < filters.length; k++) {
      const f = this.resolve(filters[k]);
      if (!f || typeof f !== 'object' || f.t !== 'name') continue;
      if (f.v === 'FlateDecode' || f.v === 'Fl') data = inflate(data);
      else if (f.v === 'ASCIIHexDecode' || f.v === 'AHx') data = asciiHex(data);
      else if (f.v === 'ASCII85Decode' || f.v === 'A85') data = ascii85(data);
      else if (f.v === 'Crypt') continue;
      else throw new Error(`unsupported filter /${f.v}`);

      const p = this.resolve(parms[k] ?? null);
      if ((this.asNumber(dictGet(p, 'Predictor')) ?? 1) >= 10) {
        data = unpredictPng(
          data,
          this.asNumber(dictGet(p, 'Colors')) ?? 1,
          this.asNumber(dictGet(p, 'BitsPerComponent')) ?? 8,
          this.asNumber(dictGet(p, 'Columns')) ?? 1
        );
      }
    }
    return data;
  }
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

export function dictGet(v: PdfValue | undefined | null, key: string): PdfValue | null {
  if (v && typeof v === 'object' && v.t === 'dict') return v.v.get(key) ?? null;
  return null;
}

export function isName(v: PdfValue | undefined | null, name: string): boolean {
  return !!v && typeof v === 'object' && v.t === 'name' && v.v === name;
}

export function asArray(v: PdfValue | undefined | null): PdfValue[] {
  if (!v) return [];
  if (typeof v === 'object' && v.t === 'arr') return v.v;
  return [v];
}

export function latin1(bytes: Uint8Array): string {
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on a
  // stream of any size, and a per-byte `+=` over a megabyte is slow enough to
  // be felt on the phone.
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return out;
}

function asciiHex(data: Uint8Array): Uint8Array {
  let hex = '';
  for (const b of data) {
    const c = String.fromCharCode(b);
    if (c === '>') break;
    if (/[0-9a-fA-F]/.test(c)) hex += c;
  }
  if (hex.length % 2) hex += '0';
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple = 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break; // '~' ends the data
    if (isWs(c)) continue;
    if (c === 0x7a && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    tuple = tuple * 85 + (c - 0x21);
    if (++count === 5) {
      for (let k = 3; k >= 0; k--) out.push((tuple / 2 ** (k * 8)) & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    for (let k = 3; k > 4 - count; k--) out.push((tuple / 2 ** (k * 8)) & 0xff);
  }
  return Uint8Array.from(out);
}

/** Undo the PNG row predictors that `/Predictor >= 10` applies. */
function unpredictPng(data: Uint8Array, colors: number, bpc: number, columns: number): Uint8Array {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);

  for (let r = 0; r < rows; r++) {
    const tag = data[r * (rowLen + 1)];
    const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const x = row[i] ?? 0;
      let v: number;
      if (tag === 1) v = x + a;
      else if (tag === 2) v = x + b;
      else if (tag === 3) v = x + ((a + b) >> 1);
      else if (tag === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else v = x;
      cur[i] = v & 0xff;
    }
    out.set(cur, r * rowLen);
    prev = cur;
  }
  return out;
}

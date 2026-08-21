/**
 * DEFLATE (RFC 1951) and zlib (RFC 1950) decompression, in plain TypeScript.
 *
 * WHY THIS IS HERE RATHER THAN A DEPENDENCY
 * -----------------------------------------
 * Almost every stream inside a PDF is Flate-compressed, so reading a PDF on
 * the phone starts with inflate. React Native has no zlib: Node's is a native
 * module and the browser's DecompressionStream does not exist in Hermes. The
 * usual answer is pako, which is 45 kB of ES5 and pulls its own build setup.
 *
 * This is ~150 lines with no dependencies and no install step, which matters
 * because the whole point of the on-device path is that it works in an APK
 * that has already been built.
 *
 * The structure follows tinf (Joergen Ibsen, zlib licence): canonical Huffman
 * tables stored as symbol counts plus a sorted symbol list, which decodes a
 * code by walking bits and subtracting counts — no lookup tables to build.
 */

class Bits {
  private tag = 0;
  private bitcnt = 0;
  pos = 0;

  constructor(private readonly src: Uint8Array) {}

  bit(): number {
    // Reload once the current byte is spent. `bitcnt--` is read BEFORE the
    // decrement, so 0 means "empty" and the byte after it is consumed here.
    if (this.bitcnt-- === 0) {
      this.tag = this.src[this.pos++] ?? 0;
      this.bitcnt = 7;
    }
    const b = this.tag & 1;
    this.tag >>>= 1;
    return b;
  }

  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v |= this.bit() << i;
    return v >>> 0;
  }

  /** Drop the partial byte — stored blocks are byte-aligned. */
  align(): void {
    this.bitcnt = 0;
  }
}

interface Tree {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildTree(lengths: Uint8Array, off: number, num: number): Tree {
  const counts = new Uint16Array(16);
  const symbols = new Uint16Array(num);
  for (let i = 0; i < num; i++) counts[lengths[off + i]]++;
  counts[0] = 0;

  const offs = new Uint16Array(16);
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    offs[i] = sum;
    sum += counts[i];
  }
  for (let i = 0; i < num; i++) {
    if (lengths[off + i]) symbols[offs[lengths[off + i]]++] = i;
  }
  return { counts, symbols };
}

function decodeSymbol(b: Bits, t: Tree): number {
  let sum = 0;
  let cur = 0;
  let len = 0;
  do {
    cur = 2 * cur + b.bit();
    len++;
    if (len > 15) throw new Error('inflate: corrupt Huffman code');
    sum += t.counts[len];
    cur -= t.counts[len];
  } while (cur >= 0);
  return t.symbols[sum + cur];
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_BITS = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** Code-length alphabet, in the permuted order RFC 1951 transmits it. */
const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function fixedTrees(): { lt: Tree; dt: Tree } {
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  const d = new Uint8Array(30).fill(5);
  return { lt: buildTree(l, 0, 288), dt: buildTree(d, 0, 30) };
}

function dynamicTrees(b: Bits): { lt: Tree; dt: Tree } {
  const hlit = b.bits(5) + 257;
  const hdist = b.bits(5) + 1;
  const hclen = b.bits(4) + 4;

  const clcLengths = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) clcLengths[CLC_ORDER[i]] = b.bits(3);
  const clcTree = buildTree(clcLengths, 0, 19);

  // Literal/length and distance lengths share one run-length encoded list.
  const lengths = new Uint8Array(hlit + hdist);
  let n = 0;
  while (n < hlit + hdist) {
    const sym = decodeSymbol(b, clcTree);
    if (sym === 16) {
      const prev = lengths[n - 1];
      for (let i = b.bits(2) + 3; i > 0; i--) lengths[n++] = prev;
    } else if (sym === 17) {
      for (let i = b.bits(3) + 3; i > 0; i--) lengths[n++] = 0;
    } else if (sym === 18) {
      for (let i = b.bits(7) + 11; i > 0; i--) lengths[n++] = 0;
    } else {
      lengths[n++] = sym;
    }
  }
  return { lt: buildTree(lengths, 0, hlit), dt: buildTree(lengths, hlit, hdist) };
}

/** Append-only output buffer that doubles rather than reallocating per byte. */
class Out {
  buf = new Uint8Array(1 << 16);
  len = 0;

  push(byte: number): void {
    if (this.len === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf[this.len++] = byte;
  }

  copy(dist: number, length: number): void {
    const from = this.len - dist;
    if (from < 0) throw new Error('inflate: back-reference before start of output');
    // Byte at a time on purpose: overlapping copies (dist < length) are legal
    // and are how DEFLATE encodes runs, so set() on a slice would be wrong.
    for (let i = 0; i < length; i++) this.push(this.buf[from + i]);
  }

  done(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

/** Inflate a raw DEFLATE stream (no zlib or gzip header). */
export function inflateRaw(src: Uint8Array): Uint8Array {
  const b = new Bits(src);
  const out = new Out();
  const fixed = fixedTrees();

  for (;;) {
    const final = b.bit();
    const type = b.bits(2);

    if (type === 0) {
      b.align();
      const len = (src[b.pos] ?? 0) | ((src[b.pos + 1] ?? 0) << 8);
      b.pos += 4; // LEN then its one's complement NLEN, which we do not verify
      for (let i = 0; i < len; i++) out.push(src[b.pos++] ?? 0);
    } else if (type === 1 || type === 2) {
      const { lt, dt } = type === 1 ? fixed : dynamicTrees(b);
      for (;;) {
        const sym = decodeSymbol(b, lt);
        if (sym === 256) break;
        if (sym < 256) {
          out.push(sym);
        } else {
          const i = sym - 257;
          if (i >= LENGTH_BASE.length) throw new Error('inflate: bad length symbol');
          const length = LENGTH_BASE[i] + b.bits(LENGTH_BITS[i]);
          const d = decodeSymbol(b, dt);
          if (d >= DIST_BASE.length) throw new Error('inflate: bad distance symbol');
          out.copy(DIST_BASE[d] + b.bits(DIST_BITS[d]), length);
        }
      }
    } else {
      throw new Error('inflate: reserved block type');
    }

    if (final) break;
    if (b.pos > src.length) throw new Error('inflate: ran off the end of the input');
  }
  return out.done();
}

/**
 * Inflate a zlib stream, tolerating a missing header.
 *
 * PDF `/FlateDecode` means zlib, but generators in the wild — and files that
 * have been through a repair tool — sometimes emit the raw DEFLATE payload
 * with no 0x78 header. Trying both costs one failed parse and rescues files
 * that would otherwise look like scans to the caller.
 */
export function inflate(src: Uint8Array): Uint8Array {
  if (src.length < 2) throw new Error('inflate: empty stream');
  const cmf = src[0];
  const flg = src[1];
  const looksZlib = (cmf & 0x0f) === 8 && ((cmf << 8) | flg) % 31 === 0;
  if (looksZlib) {
    try {
      return inflateRaw(src.subarray(2));
    } catch {
      /* fall through and try it raw */
    }
  }
  return inflateRaw(src);
}

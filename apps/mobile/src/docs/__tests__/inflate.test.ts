import zlib from 'node:zlib';

import { inflate, inflateRaw } from '../inflate';

/**
 * Checked against Node's zlib rather than against fixtures, because the risk
 * here is not "does it work on one file" — it is the block types and edge
 * cases a hand-written inflater gets wrong. Each case below targets one:
 * stored blocks, fixed Huffman, dynamic Huffman, and overlapping copies.
 */
function roundTrip(input: Buffer, level: number): string {
  const out = inflate(new Uint8Array(zlib.deflateSync(input, { level })));
  return Buffer.from(out).toString('binary');
}

describe('inflate', () => {
  it('reads a stored (uncompressed) block', () => {
    const data = Buffer.from(randomish(5000), 'binary');
    expect(roundTrip(data, 0)).toBe(data.toString('binary'));
  });

  it('reads fixed-Huffman blocks', () => {
    const data = Buffer.from('abc', 'utf8');
    expect(roundTrip(data, 9)).toBe('abc');
  });

  it('reads dynamic-Huffman blocks', () => {
    const data = Buffer.from(loremish(60000), 'utf8');
    expect(roundTrip(data, 9)).toBe(data.toString('binary'));
  });

  it('handles overlapping back-references (long runs)', () => {
    const data = Buffer.alloc(100000, 0x41);
    expect(roundTrip(data, 6)).toBe(data.toString('binary'));
  });

  it('handles binary data with every byte value', () => {
    const data = Buffer.from(Array.from({ length: 256 * 40 }, (_, i) => i % 256));
    expect(roundTrip(data, 6)).toBe(data.toString('binary'));
  });

  it('accepts a raw deflate stream with no zlib header', () => {
    const raw = zlib.deflateRawSync(Buffer.from(loremish(20000)));
    expect(Buffer.from(inflate(new Uint8Array(raw))).toString()).toBe(loremish(20000));
    expect(Buffer.from(inflateRaw(new Uint8Array(raw))).toString()).toBe(loremish(20000));
  });

  it('throws rather than returning junk on a corrupt stream', () => {
    expect(() => inflate(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toThrow();
  });
});

/** Deterministic pseudo-random bytes — no Math.random, so failures reproduce. */
function randomish(n: number): string {
  let s = '';
  let x = 12345;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += String.fromCharCode((x >>> 16) & 0xff);
  }
  return s;
}

function loremish(n: number): string {
  const words = ['bal', 'vikas', 'photosynthesis', 'ncert', 'chapter', 'the', 'cell', 'wall'];
  let s = '';
  let i = 0;
  while (s.length < n) s += words[i++ % words.length] + ' ';
  return s.slice(0, n);
}

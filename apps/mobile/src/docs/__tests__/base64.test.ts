import { base64ToBytes } from '../base64';

/**
 * The whole PDF arrives through this function — `readAsStringAsync` offers no
 * binary encoding but base64 — so an off-by-one here would corrupt every file
 * and surface as "that PDF could not be read", with nothing to point at.
 * Checked against Node's own decoder over every byte value and every padding
 * case.
 */
describe('base64ToBytes', () => {
  const roundTrip = (bytes: number[]): number[] =>
    Array.from(base64ToBytes(Buffer.from(bytes).toString('base64')));

  it('decodes all three padding lengths', () => {
    expect(roundTrip([1])).toEqual([1]);
    expect(roundTrip([1, 2])).toEqual([1, 2]);
    expect(roundTrip([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('decodes every byte value', () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    expect(roundTrip(all)).toEqual(all);
  });

  it('decodes a PDF header exactly', () => {
    expect(Buffer.from(base64ToBytes('JVBERi0xLjQK')).toString()).toBe('%PDF-1.4\n');
  });

  it('ignores whitespace and newlines in the encoded string', () => {
    expect(Buffer.from(base64ToBytes('JVBE\nRi0x\r\n Lj QK')).toString()).toBe('%PDF-1.4\n');
  });

  it('returns nothing for an empty string', () => {
    expect(base64ToBytes('')).toHaveLength(0);
  });
});

/**
 * Base64 → bytes.
 *
 * Its own module, with NO imports, for two reasons. The whole PDF arrives
 * through this one function — `readAsStringAsync` offers no binary encoding
 * but base64 — so it is worth testing directly; and anything that imports
 * expo-file-system cannot be loaded under jest, which does not transform
 * node_modules.
 *
 * Hermes has `atob`, but it returns a string, so reading it back out is a
 * per-character loop over a megabyte — long enough to be felt on the UI
 * thread. The table below decodes straight into a typed array instead.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const INDEX = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function base64ToBytes(b64: string): Uint8Array {
  // Sized from the input length, then trimmed: padding and any whitespace the
  // encoder wrapped the lines with mean the exact length is not known upfront.
  const out = new Uint8Array(Math.floor((b64.length * 3) / 4) + 3);
  let o = 0;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < b64.length; i++) {
    const v = INDEX[b64.charCodeAt(i) & 0xff];
    if (v === 255) continue; // padding, newlines, anything not in the alphabet
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

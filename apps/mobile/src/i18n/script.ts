/**
 * Script detection and run-splitting.
 *
 * WHY THIS EXISTS — the single most important technical fact about this app's
 * typography:
 *
 *   Mukta  ships `deva` + `latn`  — NO Gujarati.
 *   Mukta Vaani ships `gujr` + `latn` — NO Devanagari.
 *
 * They are siblings in one superfamily (Ek Type, OFL), designed on a shared
 * skeleton, but neither covers all three scripts. So a single `fontFamily` on
 * a <Text> is wrong the moment a string mixes scripts — and this app mixes
 * them ON PURPOSE, everywhere:
 *
 *   "કોષિકા (Cell)"          Gujarati + Latin
 *   "संज्ञानात्मक विकास (Cognitive Development)"   Devanagari + Latin
 *   "Q 24 / 180"             Latin digits inside a Hindi screen
 *
 * If we set one family, Android silently falls back to a system font for the
 * uncovered script. No tofu, so it LOOKS fine in a screenshot — but the
 * Gujarati would be rendered in Noto while the Latin is Mukta, and the page
 * quietly stops being one typeface. That is precisely the failure this whole
 * design system exists to avoid, and it would hit the NEET student hardest.
 *
 * The fix: split a string into script runs and render nested <Text> spans,
 * each with the family that actually covers it. React Native composes nested
 * Text into a single laid-out paragraph, so wrapping and selection still
 * behave as one block.
 */

export type Script = 'deva' | 'gujr' | 'latn';

// Devanagari block + Devanagari Extended.
const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;
// Gujarati block.
const GUJARATI = /[઀-૿]/;

/** Script of a single code point. Neutral characters resolve to 'latn'. */
function scriptOfChar(ch: string): Script {
  if (DEVANAGARI.test(ch)) return 'deva';
  if (GUJARATI.test(ch)) return 'gujr';
  return 'latn';
}

/**
 * The dominant script of a string — used to pick LINE HEIGHT, which is a
 * paragraph-level property and cannot vary per run.
 *
 * Deliberately NOT a simple majority: a Hindi sentence with a long English
 * technical term in it is still a Devanagari paragraph and still needs the
 * taller leading, because the matras are what clip. So any Indic presence at
 * all wins over Latin, and Devanagari wins ties.
 */
export function dominantScript(text: string): Script {
  if (DEVANAGARI.test(text)) return 'deva';
  if (GUJARATI.test(text)) return 'gujr';
  return 'latn';
}

export interface ScriptRun {
  text: string;
  script: Script;
}

/**
 * Split text into contiguous single-script runs.
 *
 * Neutral characters (spaces, digits, punctuation, brackets) are absorbed into
 * the PRECEDING run rather than starting a new one. Without that, "કોષિકા
 * (Cell)" would fragment into six runs and the spaces between them could be
 * measured by a different font than the words around them — which shows up as
 * uneven word spacing.
 */
export function splitScriptRuns(text: string): ScriptRun[] {
  if (!text) return [];

  // Fast path: the overwhelming majority of strings are single-script.
  const hasDeva = DEVANAGARI.test(text);
  const hasGujr = GUJARATI.test(text);
  if (!hasDeva && !hasGujr) return [{ text, script: 'latn' }];

  const runs: ScriptRun[] = [];
  let current = '';
  let currentScript: Script | null = null;

  for (const ch of text) {
    const s = scriptOfChar(ch);
    // A neutral char continues whatever run is open.
    const isNeutral = s === 'latn' && !/[A-Za-z]/.test(ch);

    if (currentScript === null) {
      currentScript = isNeutral ? 'latn' : s;
      current = ch;
    } else if (isNeutral || s === currentScript) {
      current += ch;
    } else {
      runs.push({ text: current, script: currentScript });
      current = ch;
      currentScript = s;
    }
  }

  if (current) runs.push({ text: current, script: currentScript ?? 'latn' });
  return runs;
}

/** Language code → the script it is written in. */
export const LANGUAGE_SCRIPT: Record<string, Script> = {
  en: 'latn',
  hi: 'deva',
  gu: 'gujr',
};

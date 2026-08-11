/**
 * Picking the right rendering of a question for the reader's language.
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE TERNARY
 * ----------------------------------------------
 * Every question surface had grown its own copy of:
 *
 *     const stem = (lang === 'hi' && q.stem_hi) || q.stem_en;
 *
 * Nine copies across four screens. Three problems with that:
 *
 * 1. It is hard-coded to Hindi. With `contentLang === 'gu'` the test is false,
 *    so a Gujarati reader silently got English — no warning, no fallback badge,
 *    just the wrong language. That is the sister's entire experience of the app.
 * 2. It cannot tell "no Gujarati exists yet" from "Gujarati was requested and
 *    given", so nothing downstream can show a language toggle that reflects what
 *    is actually available.
 * 3. Adding a language meant finding all nine sites.
 *
 * `available()` is what the in-place language toggle is built on: it offers only
 * renderings the question actually has, so the control can never switch to a
 * language and show English.
 *
 * ON GUJARATI
 * -----------
 * There is no `stem_gu` column yet. Gujarati content arrives with the NEET
 * pipeline, which sources the authentic Gujarati NEET papers rather than
 * translating the English ones. Until then `gu` resolves to English and says so
 * via `fellBack`. When the column lands, add it to LANG_COLUMNS and every
 * surface picks it up.
 */

import type { Lang } from '@/store/profile';

/**
 * The column a language is NATIVELY stored in.
 *
 * `gu` is listed even though no `_gu` column exists yet: the absence is then a
 * fact about the DATA ("this question has no Gujarati"), which `available()`
 * reads correctly, rather than a fact about this table. When the NEET pipeline
 * adds the column, nothing here changes.
 */
const NATIVE_COLUMN: Record<Lang, string> = { en: 'en', hi: 'hi', gu: 'gu' };

/**
 * Read order when the native column is empty. English is the anchor because it
 * is the one rendering every question is guaranteed to have.
 */
const LANG_COLUMNS: Record<Lang, string[]> = {
  en: ['en'],
  hi: ['hi', 'en'],
  gu: ['gu', 'en'],
};

/**
 * The row shapes this module reads. Declared structurally rather than importing
 * QuestionRow/OptionRow so the same helpers serve rows that carry only a subset
 * of the columns — a generated mock, a tutor payload, a review preview.
 */
export interface StemBearing {
  stem_en: string;
  stem_hi?: string | null;
  stem_gu?: string | null;
}

export interface PassageBearing {
  passage_en?: string | null;
  passage_hi?: string | null;
  passage_gu?: string | null;
}

export interface OptionBearing {
  text_en: string;
  text_hi?: string | null;
  text_gu?: string | null;
}

export interface ExplanationBearing {
  explanation_en?: string | null;
  explanation_hi?: string | null;
  explanation_gu?: string | null;
}

export interface Localised {
  text: string;
  /** The language actually rendered — may differ from the one requested. */
  lang: Lang;
  /** True when the requested language had no rendering and English was used. */
  fellBack: boolean;
}

const SUFFIX_TO_LANG: Record<string, Lang> = { en: 'en', hi: 'hi', gu: 'gu' };

/**
 * Resolve a `<field>_<lang>` family against a row.
 *
 * `field` is the column prefix ('stem', 'text', 'explanation'), so this works
 * for question stems, option text and explanations alike.
 */
function resolve(row: object | null | undefined, field: string, lang: Lang): Localised | null {
  if (!row) return null;
  const bag = row as Record<string, unknown>;
  const chain = LANG_COLUMNS[lang] ?? ['en'];
  for (const suffix of chain) {
    const value = bag[`${field}_${suffix}`];
    if (typeof value === 'string' && value.trim()) {
      return {
        text: value,
        lang: SUFFIX_TO_LANG[suffix] ?? 'en',
        // Measured against the language's OWN column, not the head of the
        // chain — otherwise a language with no column of its own reports a
        // clean hit while actually rendering English.
        fellBack: suffix !== NATIVE_COLUMN[lang],
      };
    }
  }
  return null;
}

export function stemFor(q: StemBearing, lang: Lang): Localised {
  return resolve(q, 'stem', lang) ?? { text: '', lang: 'en', fellBack: true };
}

export function optionTextFor(o: OptionBearing, lang: Lang): Localised {
  return resolve(o, 'text', lang) ?? { text: '', lang: 'en', fellBack: true };
}

/**
 * The comprehension passage, or null when the question stands alone.
 *
 * Null is the common case and is not a failure — most questions carry their own
 * material. Only comprehension blocks print a shared text.
 */
export function passageFor(q: PassageBearing, lang: Lang): Localised | null {
  return resolve(q, 'passage', lang);
}

/** Null rather than empty: "no explanation yet" is a real state with its own copy. */
export function explanationFor(q: ExplanationBearing, lang: Lang): Localised | null {
  return resolve(q, 'explanation', lang);
}

/**
 * Which languages this question is genuinely readable in.
 *
 * Drives the in-place language toggle. A language appears only if the stem AND
 * every option exist in it — a half-translated question is worse than an
 * untranslated one, because she cannot tell which half she is missing.
 */
export function available(q: StemBearing, options: OptionBearing[]): Lang[] {
  const langs: Lang[] = ['en', 'hi', 'gu'];
  return langs.filter((lang) => {
    // The NATIVE column, never the fallback. Checking the fallback would make
    // every language "available" the moment English was, and the toggle would
    // offer Gujarati and then render English.
    const column = NATIVE_COLUMN[lang];
    if (!column) return false;
    const has = (row: object, field: string) => {
      const v = (row as Record<string, unknown>)[`${field}_${column}`];
      return typeof v === 'string' && v.trim().length > 0;
    };
    if (!has(q, 'stem')) return false;
    return options.length > 0 && options.every((o) => has(o, 'text'));
  });
}

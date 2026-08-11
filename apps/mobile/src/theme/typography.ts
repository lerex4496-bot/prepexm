/**
 * Typography — the highest-risk part of this design system.
 *
 * Two rules here are non-obvious and are the reason most Indic mobile UI
 * looks broken:
 *
 * 1. LINE HEIGHT IS SCRIPT-DEPENDENT.
 *    Devanagari hangs matras above the shirorekha and below the baseline;
 *    Gujarati does the same without the headline. A 1.5 multiplier tuned on
 *    Latin clips both. Every token below therefore carries TWO multipliers and
 *    the Indic one is substantially taller.
 *
 * 2. DISPLAY SIZE STEPS DOWN FOR INDIC.
 *    "Warm Editorial" wants big confident headings, but Hindi and Gujarati run
 *    ~15-30% longer than the same English string and their glyphs are wider.
 *    34/800 Devanagari overflows a 360dp screen. So display and h1 drop one
 *    rung when the string is Indic. This is the concrete mitigation for the
 *    known risk of the chosen visual direction.
 */

import type { Script } from '@/i18n/script';

export type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';

/**
 * Font family routing. `Mukta` covers deva+latn, `MuktaVaani` covers
 * gujr+latn. Latin is served by Mukta so English text is visually consistent
 * with the Hindi side of the product.
 */
const FAMILY: Record<Script, Record<Weight, string>> = {
  deva: {
    regular: 'Mukta-Regular',
    medium: 'Mukta-Medium',
    semibold: 'Mukta-SemiBold',
    bold: 'Mukta-Bold',
    extrabold: 'Mukta-ExtraBold',
  },
  latn: {
    regular: 'Mukta-Regular',
    medium: 'Mukta-Medium',
    semibold: 'Mukta-SemiBold',
    bold: 'Mukta-Bold',
    extrabold: 'Mukta-ExtraBold',
  },
  gujr: {
    regular: 'MuktaVaani-Regular',
    medium: 'MuktaVaani-Medium',
    semibold: 'MuktaVaani-SemiBold',
    bold: 'MuktaVaani-Bold',
    extrabold: 'MuktaVaani-ExtraBold',
  },
};

export function fontFamily(script: Script, weight: Weight): string {
  return FAMILY[script][weight];
}

/** Every font file that must be loaded before first paint. */
export const FONT_ASSETS = {
  'Mukta-Regular': require('../../assets/fonts/Mukta-Regular.ttf'),
  'Mukta-Medium': require('../../assets/fonts/Mukta-Medium.ttf'),
  'Mukta-SemiBold': require('../../assets/fonts/Mukta-SemiBold.ttf'),
  'Mukta-Bold': require('../../assets/fonts/Mukta-Bold.ttf'),
  'Mukta-ExtraBold': require('../../assets/fonts/Mukta-ExtraBold.ttf'),
  'MuktaVaani-Regular': require('../../assets/fonts/MuktaVaani-Regular.ttf'),
  'MuktaVaani-Medium': require('../../assets/fonts/MuktaVaani-Medium.ttf'),
  'MuktaVaani-SemiBold': require('../../assets/fonts/MuktaVaani-SemiBold.ttf'),
  'MuktaVaani-Bold': require('../../assets/fonts/MuktaVaani-Bold.ttf'),
  'MuktaVaani-ExtraBold': require('../../assets/fonts/MuktaVaani-ExtraBold.ttf'),
};

export interface TypeToken {
  size: number;
  /** Size used when the string's dominant script is Devanagari or Gujarati. */
  indicSize?: number;
  weight: Weight;
  /** Line-height multiplier for Latin. */
  lh: number;
  /** Line-height multiplier for Devanagari/Gujarati — always taller. */
  indicLh: number;
  tracking?: number;
  tabular?: boolean;
}

export const type = {
  display: { size: 34, indicSize: 30, weight: 'extrabold', lh: 1.2, indicLh: 1.45, tracking: -0.5 },
  h1: { size: 26, indicSize: 24, weight: 'bold', lh: 1.25, indicLh: 1.5, tracking: -0.3 },
  h2: { size: 20, weight: 'bold', lh: 1.3, indicLh: 1.55 },
  h3: { size: 17, weight: 'semibold', lh: 1.35, indicLh: 1.6 },
  body: { size: 16, weight: 'regular', lh: 1.5, indicLh: 1.75 },
  bodyStrong: { size: 16, weight: 'semibold', lh: 1.5, indicLh: 1.75 },
  question: { size: 17, weight: 'medium', lh: 1.55, indicLh: 1.8 },
  option: { size: 16, weight: 'regular', lh: 1.5, indicLh: 1.75 },
  caption: { size: 13, weight: 'regular', lh: 1.4, indicLh: 1.65 },
  button: { size: 15, weight: 'semibold', lh: 1.2, indicLh: 1.35 },
  /**
   * Exam numerics — question numbers, marks, the timer. Always Latin digits
   * (that is what the real paper uses) and always tabular so the timer does
   * not jitter as the seconds tick.
   */
  numeric: { size: 15, weight: 'medium', lh: 1.2, indicLh: 1.2, tabular: true },
} as const satisfies Record<string, TypeToken>;

export type TypeVariant = keyof typeof type;

/** Resolve a token + script into concrete RN text style values. */
export function resolveType(variant: TypeVariant, script: Script) {
  const t = type[variant] as TypeToken;
  const isIndic = script !== 'latn';
  const size = isIndic && t.indicSize ? t.indicSize : t.size;
  const multiplier = isIndic ? t.indicLh : t.lh;
  return {
    fontSize: size,
    lineHeight: Math.round(size * multiplier),
    weight: t.weight,
    letterSpacing: t.tracking,
    tabular: t.tabular ?? false,
  };
}

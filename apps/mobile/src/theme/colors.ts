/**
 * StudyMate colour tokens — "Warm Editorial".
 *
 * Every value here was validated before being written down:
 *  - ink/brand/status pairs were checked for WCAG contrast against the actual
 *    StudyMate surfaces (cream #fdfbf4 / charcoal #16171a), not against a
 *    generic white/black.
 *  - the chart series palette passed the categorical six-checks validator in
 *    BOTH modes on those same surfaces (worst adjacent CVD dE 9.1 light /
 *    8.4 dark; worst normal-vision dE 19.6 / 19.3).
 *
 * Recorded contrast ratios (light vs #fdfbf4, dark vs #16171a) are in the
 * comments so a future edit can't quietly regress them.
 *
 * NEVER import a raw hex from this file into a component. Go through
 * useTheme().colors so light/dark and the exam accent resolve correctly.
 */

export type ExamCode = 'CTET' | 'NEET';
export type ThemeMode = 'light' | 'dark';

/** Chart series slots. Fixed order — this ordering IS the CVD-safety mechanism. */
const seriesLight = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const;
const seriesDark = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] as const;

/**
 * In light mode aqua (2.67:1), yellow (2.06:1) and magenta (2.56:1) sit below
 * 3:1 on cream. The validator returns a contrast WARN for these, which is not
 * dismissable: the relief rule applies, so any light-mode chart using slots
 * 3-5 MUST ship visible direct labels or a table view. This flag exists so
 * chart components can assert it rather than rely on someone remembering.
 */
export const LIGHT_SERIES_NEEDS_DIRECT_LABELS = true;

const palette = {
  light: {
    bg: '#fdfbf4',
    surface: '#ffffff',
    surfaceSunken: '#f6f4ea',
    ink: '#14150f', //  17.73:1
    inkSecondary: '#4a4940', //   8.75:1
    inkMuted: '#6e6c60', //   5.10:1
    inkInverse: '#fdfbf4',
    hairline: '#e3e0d4',
    hairlineStrong: '#d3cfbe',
    primary: '#31417d', //   9.29:1
    primaryInk: '#ffffff',
    primarySoft: '#e7eaf5',
    success: '#0ca30c',
    successText: '#006300', //   7.28:1
    successSoft: '#e4f3e2',
    warning: '#fab219', // 1.74:1 — icon + label ALWAYS, never colour alone
    warningText: '#7a5200',
    warningSoft: '#fdf1d8',
    error: '#c0392f', //   5.24:1
    errorSoft: '#f8e6e3',
    info: '#2a78d6',
    infoSoft: '#e4eefb',
    scrim: 'rgba(20, 21, 15, 0.45)',
    series: seriesLight,
  },
  dark: {
    bg: '#16171a',
    surface: '#202227',
    surfaceSunken: '#101114',
    ink: '#f5f3ea', //  16.12:1
    inkSecondary: '#c6c4b8', //  10.23:1
    inkMuted: '#96948a', //   5.89:1
    inkInverse: '#16171a',
    hairline: '#2e2f2b',
    hairlineStrong: '#3f403a',
    primary: '#8a9ce8', //   6.83:1
    primaryInk: '#16171a',
    primarySoft: '#242940',
    success: '#0ca30c',
    successText: '#2fbf2f',
    successSoft: '#162a16',
    warning: '#fab219',
    warningText: '#f0b53c',
    warningSoft: '#2e2513',
    error: '#e66767',
    errorSoft: '#2f1a1a',
    info: '#3987e5',
    infoSoft: '#152131',
    scrim: 'rgba(0, 0, 0, 0.6)',
    series: seriesDark,
  },
} as const;

/**
 * Exam accent. Used SPARINGLY — exam chip, active tab indicator, progress
 * ring, section rules. It is not a re-theme: `primary` indigo stays shared so
 * the app reads as one product across both exams.
 */
const examAccent = {
  CTET: {
    light: { accent: '#a8552f', accentInk: '#ffffff', accentSoft: '#f6e9e1' }, // 5.06:1
    dark: { accent: '#e0885f', accentInk: '#16171a', accentSoft: '#2c1f18' }, // 6.71:1
  },
  NEET: {
    light: { accent: '#0e6f6a', accentInk: '#ffffff', accentSoft: '#e0efee' }, // 5.79:1
    dark: { accent: '#3fb5ad', accentInk: '#16171a', accentSoft: '#12262a' }, // 7.19:1
  },
} as const;

export type Colors = (typeof palette)['light'] & (typeof examAccent)['CTET']['light'];

export function buildColors(mode: ThemeMode, exam: ExamCode): Colors {
  return { ...palette[mode], ...examAccent[exam][mode] } as Colors;
}

/**
 * Question-palette state colours for the exam player.
 *
 * Each state ALSO carries a distinct glyph (see `shape`) because colour must
 * never be the sole indicator — this is both an accessibility requirement and
 * the thing that keeps the palette readable for a colour-blind student under
 * exam pressure.
 */
export const questionStates = {
  notVisited: { shape: '○', key: 'notVisited' },
  notAnswered: { shape: '▢', key: 'notAnswered' },
  answered: { shape: '●', key: 'answered' },
  marked: { shape: '◆', key: 'marked' },
  answeredMarked: { shape: '◈', key: 'answeredMarked' },
} as const;

export type QuestionState = keyof typeof questionStates;

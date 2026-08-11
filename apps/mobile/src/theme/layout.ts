/** Spacing, radius, elevation and motion tokens. 4pt base scale. */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

/** Screen horizontal gutter. Editorial layouts breathe — this is deliberate. */
export const gutter = spacing.lg;

/** Vertical rhythm between major sections. The main source of "editorial". */
export const sectionGap = spacing['2xl'];

export const radius = {
  sm: 8, // chips, badges
  md: 12, // cards, inputs
  lg: 16, // sheets, modals
  full: 999, // pills, rings
} as const;

/**
 * Elevation is deliberately minimal — Warm Editorial reads as ink on paper,
 * not as floating material. `flat` (a hairline border, no shadow) is the
 * DEFAULT for cards. No list item ever gets a shadow.
 */
export const elevation = {
  flat: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  overlay: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

/** Minimum touch target. Enforced on every interactive component. */
export const HIT_TARGET = 48;

/**
 * Motion budget. Anything longer than these reads as sluggish on a mid-range
 * Android device, which is what both students actually use.
 *
 * Hard rule enforced at call sites: NONE of this runs inside an active exam.
 * During a timed test, state changes are instant colour swaps.
 */
export const motion = {
  micro: 150, // option fill, tap feedback
  transition: 250, // sheets, flips, bar fills
  celebratory: 400, // session complete, ring sweep
} as const;

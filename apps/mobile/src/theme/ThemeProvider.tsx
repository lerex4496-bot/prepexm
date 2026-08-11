import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { buildColors, type Colors, type ExamCode, type ThemeMode } from './colors';
import { elevation, gutter, HIT_TARGET, motion, radius, sectionGap, spacing } from './layout';
import { useProfile } from '@/store/profile';

export interface Theme {
  mode: ThemeMode;
  exam: ExamCode;
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  elevation: typeof elevation;
  motion: typeof motion;
  gutter: number;
  sectionGap: number;
  hitTarget: number;
  /** True when the student has asked for reduced motion. */
  reducedMotion: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const themePref = useProfile((s) => s.profile.theme);
  const exam = useProfile((s) => s.profile.exam) ?? 'CTET';
  const reducedMotion = useProfile((s) => s.profile.reducedMotion);

  const mode: ThemeMode =
    themePref === 'system' ? (system === 'dark' ? 'dark' : 'light') : themePref;

  const value = useMemo<Theme>(
    () => ({
      mode,
      exam,
      colors: buildColors(mode, exam),
      spacing,
      radius,
      elevation,
      motion,
      gutter,
      sectionGap,
      hitTarget: HIT_TARGET,
      reducedMotion,
    }),
    [mode, exam, reducedMotion]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

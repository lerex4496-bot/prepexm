import { useCallback } from 'react';

import { useProfile, type Lang } from '@/store/profile';
import { translate } from './strings';

/**
 * The language of the app itself — navigation, tabs, buttons, settings, labels.
 *
 * This is a CONSTANT, not a setting, and that is the point.
 *
 * The first version had a single `lang` field driving both the chrome and the
 * question content. Choosing Hindi translated "Practice", "Progress" and
 * "Submit" along with the questions, which made the app harder to move around
 * rather than easier: those words are the ones she already reads in English in
 * every other app on the phone, and a translated tab bar is a tab bar she has
 * to re-learn.
 *
 * So the split is: chrome in English, always; content in her language, always.
 *
 * It is deliberately not `profile.uiLang`. A settable field that must never be
 * set is a trap — someone eventually wires a control to it. If this decision is
 * ever reversed, this line changes and every dictionary is still here.
 */
export const UI_LANG: Lang = 'en';

/**
 * Translation hook.
 *
 * `t()` renders app chrome and is always English. `contentLang` is what she
 * chose for exam content, and is what question stems, options, explanations and
 * the tutor read. Components take one or the other explicitly, so a content
 * surface can never accidentally follow the chrome and vice versa.
 */
export function useT() {
  const contentLang = useProfile((s) => s.profile.contentLang);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(UI_LANG, key, params),
    []
  );

  return { t, uiLang: UI_LANG, contentLang };
}

export type { Lang };

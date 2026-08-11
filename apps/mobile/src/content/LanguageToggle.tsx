import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { LANGUAGE_LABEL } from '@/i18n/strings';
import { useProfile, type Lang } from '@/store/profile';
import { available, type OptionBearing, type StemBearing } from './localise';

/**
 * Switch the language of the question ON THE PAGE, without leaving it.
 *
 * WHY THIS IS IN-PLACE AND NOT A SETTING
 * --------------------------------------
 * Reading a question in Hindi and wanting to check a term against the English
 * original is a *mid-question* need, not a preference. It used to mean going to
 * Settings, changing the language, and coming back — by which time the exam
 * screen had remounted, so the answer, the timer position and the scroll offset
 * were gone. Nobody does that during a timed test, so in practice the second
 * rendering may as well not have existed.
 *
 * This writes the same `profile.contentLang` the rest of the app reads, so the
 * change is a re-render of the text nodes only. The component tree is not
 * remounted: her selected option, the running timer and her scroll position all
 * survive, because none of them are keyed on language.
 *
 * WHY IT TAKES THE QUESTION
 * -------------------------
 * The old control was a hard-coded English/Hindi flip shown whenever `stem_hi`
 * existed. It could switch to a language the OPTIONS had no rendering for,
 * leaving a Hindi stem above four English options. `available()` requires the
 * stem and every option, so an offered language always produces a fully
 * readable question — and Gujarati appears by itself once NEET content lands,
 * with no change here.
 */

/**
 * One-glyph labels, each written in its own script. Short enough for the exam
 * header, where horizontal space is contested by the timer and question count.
 */
const GLYPH: Record<Lang, string> = {
  en: 'A',
  hi: 'अ',
  gu: 'ગ',
};

export interface LanguageToggleProps {
  question: StemBearing;
  options: OptionBearing[];
  /** `compact` is the exam-header form: glyphs only, minimal padding. */
  compact?: boolean;
}

export function LanguageToggle({ question, options, compact = false }: LanguageToggleProps) {
  const { colors, radius } = useTheme();
  const contentLang = useProfile((s) => s.profile.contentLang);
  const setProfile = useProfile((s) => s.set);

  const langs = available(question, options);

  const choose = useCallback(
    (lang: Lang) => {
      if (lang !== contentLang) setProfile({ contentLang: lang });
    },
    [contentLang, setProfile]
  );

  // One language is not a choice. Rendering a single-option control would
  // suggest a second rendering exists when it does not.
  if (langs.length < 2) return null;

  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        overflow: 'hidden',
      }}
    >
      {langs.map((lang) => {
        const active = lang === contentLang;
        return (
          <Pressable
            key={lang}
            onPress={() => choose(lang)}
            hitSlop={compact ? 8 : 4}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={LANGUAGE_LABEL[lang]}
            style={{
              paddingHorizontal: compact ? 10 : 14,
              paddingVertical: compact ? 3 : 6,
              backgroundColor: active ? colors.accentSoft : 'transparent',
            }}
          >
            <Text variant="caption" tone={active ? 'accent' : 'secondary'}>
              {compact ? GLYPH[lang] : LANGUAGE_LABEL[lang]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, StepShell, Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { PAPER_TYPES, useProfile, type PaperType } from '@/store/profile';
import { useTheme } from '@/theme/ThemeProvider';
import { EXAM_LANGUAGES } from '@/i18n/strings';

/**
 * Step 2. Choosing the exam immediately repaints the accent colour, so the app
 * visibly becomes hers before she has answered anything else.
 *
 * It also resets the language to that exam's default, because the language
 * sets differ: CTET papers are natively English/Hindi and there is no Gujarati
 * CTET, so offering Gujarati here would be a lie.
 */
export default function ExamStep() {
  const { t } = useT();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const set = useProfile((s) => s.set);
  const selected = useProfile((s) => s.profile.exam);
  const paperType = useProfile((s) => s.profile.paperType);

  /**
   * CTET needs a second answer: Paper 1 and Paper 2 are separate exams, and
   * Paper 2 splits again by elective. It is disclosed here rather than given
   * its own step because it is the same question — "what are you sitting?" —
   * and a step that only appears for one of two exams makes the progress
   * counter lie about how much is left.
   */
  const choose = (exam: 'CTET' | 'NEET') => {
    set({ exam, contentLang: EXAM_LANGUAGES[exam][0] });
    if (exam === 'CTET') return; // stay, and reveal the paper choice below
    set({ paperType: null }); // NEET has no such split
    router.push('/onboarding/language');
  };

  const choosePaper = (paperType: PaperType) => {
    set({ paperType });
    router.push('/onboarding/language');
  };

  const options = [
    { code: 'CTET' as const, desc: t('ob.exam.ctet'), glyph: '✎' },
    { code: 'NEET' as const, desc: t('ob.exam.neet'), glyph: '⌬' },
  ];

  return (
    <StepShell step={1} total={6} title={t('ob.exam.title')} body={t('ob.exam.body')}>
      <View style={{ gap: spacing.md }}>
        {options.map((o) => {
          const active = selected === o.code;
          return (
            <Card
              key={o.code}
              onPress={() => choose(o.code)}
              accessibilityLabel={`${o.code}. ${o.desc}`}
              style={{
                borderColor: active ? colors.accent : colors.hairline,
                borderWidth: active ? 2 : 1,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
                <Text variant="display" color={colors.accent}>
                  {o.glyph}
                </Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="h1">{o.code}</Text>
                  <Text variant="caption" tone="secondary">
                    {o.desc}
                  </Text>
                </View>
              </View>
            </Card>
          );
        })}
      </View>

      {selected === 'CTET' ? (
        <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
          <Text variant="h3">{t('paper.title')}</Text>
          <Text variant="caption" tone="secondary">
            {t('paper.body')}
          </Text>
          {PAPER_TYPES.map((p) => {
            const active = paperType === p;
            return (
              <Card
                key={p}
                onPress={() => choosePaper(p)}
                accessibilityLabel={`${t(`paper.${p}`)}. ${t(`paper.${p}.desc`)}`}
                style={{
                  borderColor: active ? colors.accent : colors.hairline,
                  borderWidth: active ? 2 : 1,
                }}
              >
                <Text variant="bodyStrong">{t(`paper.${p}`)}</Text>
                <Text variant="caption" tone="secondary">
                  {t(`paper.${p}.desc`)}
                </Text>
              </Card>
            );
          })}
        </View>
      ) : null}
    </StepShell>
  );
}

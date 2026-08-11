import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, StepShell, Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { EXAM_LANGUAGES, LANGUAGE_LABEL } from '@/i18n/strings';
import { useProfile, type Lang } from '@/store/profile';
import { useTheme } from '@/theme/ThemeProvider';

/** English name of each language, shown as the support line. */
const ENDONYM_SUPPORT: Record<Lang, string> = {
  hi: 'Hindi',
  gu: 'Gujarati',
  en: 'English',
};

/**
 * Step 3. Each option is rendered IN ITS OWN SCRIPT, at display size — so this
 * screen doubles as the first real test of the font routing. "ગુજરાતી" here is
 * Mukta Vaani and "हिन्दी" is Mukta, chosen per run by the Text primitive.
 *
 * Selecting a language switches the whole UI instantly, so she sees the
 * consequence of the choice on the very next line rather than after a reload.
 */
export default function LanguageStep() {
  const { t } = useT();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const set = useProfile((s) => s.set);
  const exam = useProfile((s) => s.profile.exam) ?? 'CTET';
  const contentLang = useProfile((s) => s.profile.contentLang);

  const available = EXAM_LANGUAGES[exam];

  return (
    <StepShell
      step={2}
      total={6}
      title={t('ob.lang.title')}
      body={t('ob.lang.body')}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" tone="muted" align="center">
            {ENDONYM_SUPPORT[contentLang]}
          </Text>
        </View>
      }
    >
      <View style={{ gap: spacing.md }}>
        {available.map((code) => {
          const active = contentLang === code;
          return (
            <Card
              key={code}
              tone={active ? 'accent' : 'surface'}
              accessibilityLabel={`${LANGUAGE_LABEL[code]}, ${ENDONYM_SUPPORT[code]}`}
              onPress={() => {
                set({ contentLang: code });
                // Give the UI a beat to repaint in the new script before
                // navigating, so the switch is visible rather than instant-gone.
                setTimeout(() => router.push('/onboarding/target'), 260);
              }}
              style={{ borderColor: active ? colors.accent : colors.hairline, borderWidth: active ? 2 : 1 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="h1">{LANGUAGE_LABEL[code]}</Text>
                  <Text variant="caption" tone="muted">
                    {ENDONYM_SUPPORT[code]}
                  </Text>
                </View>
                {active ? (
                  <Text variant="h2" color={colors.accent}>
                    ✓
                  </Text>
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>

      {exam === 'CTET' ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.lg }}>
          {/* Honest about why Gujarati is absent here rather than silently omitting it. */}
          CTET is conducted in Hindi and English only.
        </Text>
      ) : null}
    </StepShell>
  );
}

import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, StepShell, Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { TARGETS } from '@/content/fixtures';
import { useProfile } from '@/store/profile';
import { useTheme } from '@/theme/ThemeProvider';

/** Step 4. Grounded in the real exam calendars, not a generic date picker. */
export default function TargetStep() {
  const { t, uiLang } = useT();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const set = useProfile((s) => s.set);
  const exam = useProfile((s) => s.profile.exam) ?? 'CTET';
  const target = useProfile((s) => s.profile.target);

  return (
    <StepShell step={3} total={6} title={t('ob.target.title')} body={t('ob.target.body')}>
      <View style={{ gap: spacing.md }}>
        {TARGETS[exam].map((o) => {
          const active = target === o.id;
          return (
            <Card
              key={o.id}
              onPress={() => {
                set({ target: o.id });
                router.push('/onboarding/level');
              }}
              accessibilityLabel={o.label[uiLang] ?? o.label.en}
              style={{ borderColor: active ? colors.accent : colors.hairline, borderWidth: active ? 2 : 1 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="h2" style={{ flexShrink: 1 }}>
                  {o.label[uiLang] ?? o.label.en}
                </Text>
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
    </StepShell>
  );
}

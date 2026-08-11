import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, StepShell, Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { useProfile } from '@/store/profile';
import { useTheme } from '@/theme/ThemeProvider';

const CHOICES = [5, 10, 20, 30, 60];

/** Step 6. Sets plan length. The same buckets reappear as the Today time chips. */
export default function TimeStep() {
  const { t } = useT();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const set = useProfile((s) => s.set);
  const daily = useProfile((s) => s.profile.dailyMinutes);

  return (
    <StepShell step={5} total={6} title={t('ob.time.title')} body={t('ob.time.body')}>
      <View style={{ gap: spacing.md }}>
        {CHOICES.map((m) => {
          const active = daily === m;
          return (
            <Card
              key={m}
              onPress={() => {
                set({ dailyMinutes: m });
                router.push('/onboarding/diagnostic');
              }}
              accessibilityLabel={`${m} ${t('common.minutes')}`}
              style={{ borderColor: active ? colors.accent : colors.hairline, borderWidth: active ? 2 : 1 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
                {/* Latin digits, tabular — consistent with every other number in the app. */}
                <Text variant="numeric" style={{ fontSize: 30 }}>
                  {m}
                </Text>
                <Text variant="body" tone="secondary">
                  {t('common.minutes')}
                  {m === 60 ? '+' : ''}
                </Text>
              </View>
            </Card>
          );
        })}
      </View>
    </StepShell>
  );
}

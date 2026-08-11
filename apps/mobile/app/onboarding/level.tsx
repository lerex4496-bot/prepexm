import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, StepShell, Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { useProfile, type PrepLevel } from '@/store/profile';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Step 5. This is the cold-start signal: combined with syllabus weightage it
 * seeds prior mastery, which is what lets step 7's diagnostic be genuinely
 * optional rather than optional-but-punished.
 */
export default function LevelStep() {
  const { t } = useT();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const set = useProfile((s) => s.set);
  const level = useProfile((s) => s.profile.level);

  const options: { code: PrepLevel; bars: number }[] = [
    { code: 'starting', bars: 1 },
    { code: 'revising', bars: 2 },
    { code: 'nearly', bars: 3 },
  ];

  return (
    <StepShell step={4} total={6} title={t('ob.level.title')}>
      <View style={{ gap: spacing.md }}>
        {options.map((o) => {
          const active = level === o.code;
          return (
            <Card
              key={o.code}
              onPress={() => {
                set({ level: o.code });
                router.push('/onboarding/time');
              }}
              accessibilityLabel={`${t(`ob.level.${o.code}`)}. ${t(`ob.level.${o.code}Hint`)}`}
              style={{ borderColor: active ? colors.accent : colors.hairline, borderWidth: active ? 2 : 1 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
                {/* Rising bars: a second, non-colour cue for "how far along". */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 26 }}>
                  {[1, 2, 3].map((b) => (
                    <View
                      key={b}
                      style={{
                        width: 6,
                        height: 8 + b * 6,
                        borderRadius: 2,
                        backgroundColor: b <= o.bars ? colors.accent : colors.hairline,
                      }}
                    />
                  ))}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="h2">{t(`ob.level.${o.code}`)}</Text>
                  <Text variant="caption" tone="secondary">
                    {t(`ob.level.${o.code}Hint`)}
                  </Text>
                </View>
              </View>
            </Card>
          );
        })}
      </View>
    </StepShell>
  );
}

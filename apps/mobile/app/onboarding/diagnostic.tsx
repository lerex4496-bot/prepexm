import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, StepShell, Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { useProfile } from '@/store/profile';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Step 7. The diagnostic.
 *
 * Both actions carry EQUAL visual weight — "Skip for now" is a full secondary
 * button, not a grey link buried under the primary. Skipping genuinely costs
 * her nothing (prior mastery seeds from syllabus weightage x declared level),
 * and the UI should not imply otherwise. A student who feels punished for
 * skipping a test on her first run is a student who does not come back.
 *
 * The 12 questions themselves land in Slice 2 with real content; here the
 * choice is recorded and honoured.
 */
export default function DiagnosticStep() {
  const { t } = useT();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const set = useProfile((s) => s.set);

  const finish = (didDiagnostic: boolean) => {
    set({ diagnosticDone: didDiagnostic, onboarded: true });
    router.replace('/(tabs)/today');
  };

  return (
    <StepShell
      step={6}
      total={6}
      title={t('ob.diag.title')}
      body={t('ob.diag.body')}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button label={t('ob.diag.start')} size="lg" fullWidth onPress={() => finish(true)} />
          <Button
            label={t('ob.diag.skip')}
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => finish(false)}
          />
        </View>
      }
    >
      <Card tone="sunken">
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
            <Text variant="numeric" style={{ fontSize: 34 }}>
              12
            </Text>
            <Text variant="body" tone="secondary">
              ·
            </Text>
            <Text variant="numeric" style={{ fontSize: 34 }}>
              6
            </Text>
            <Text variant="body" tone="secondary">
              {t('common.min')}
            </Text>
          </View>

          <View style={{ height: 2, backgroundColor: colors.hairlineStrong }} />

          <Text variant="caption" tone="muted">
            {t('ob.done.title')}
          </Text>
        </View>
      </Card>
    </StepShell>
  );
}

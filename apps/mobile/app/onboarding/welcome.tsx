import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Screen, Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Step 1. No progress marks and no back button — this is the cover, not a
 * question. A single line, a single action.
 */
export default function Welcome() {
  const { t } = useT();
  const { colors, spacing } = useTheme();
  const router = useRouter();

  return (
    <Screen
      scroll={false}
      footer={
        <Button
          label={t('ob.welcome.cta')}
          size="lg"
          fullWidth
          onPress={() => router.push('/onboarding/exam')}
        />
      }
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingBottom: spacing['3xl'] }}>
        {/* Wordmark. Latin-only by design — the product name is not translated. */}
        <Text variant="caption" tone="muted" style={{ letterSpacing: 2, marginBottom: spacing.sm }}>
          STUDYMATE
        </Text>

        <View style={{ height: 3, width: 44, backgroundColor: colors.accent, marginBottom: spacing.xl }} />

        <Text variant="display" style={{ marginBottom: spacing.md }}>
          {t('ob.welcome.title')}
        </Text>

        <Text variant="body" tone="secondary">
          {t('ob.welcome.body')}
        </Text>
      </View>
    </Screen>
  );
}

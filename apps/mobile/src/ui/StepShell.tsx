import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { Screen } from './Screen';
import { Text } from './Text';

/**
 * Shared chrome for the onboarding steps.
 *
 * This is an intake, not a form: one question per screen, large type, a lot of
 * air, and no visible progress bar racing her. Progress is a row of small
 * marks — present if she looks for it, invisible if she doesn't.
 */
export function StepShell({
  step,
  total,
  title,
  body,
  children,
  footer,
  canGoBack = true,
}: {
  step: number;
  total: number;
  title: string;
  body?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  canGoBack?: boolean;
}) {
  const { colors, spacing, hitTarget } = useTheme();
  const { t } = useT();
  const router = useRouter();

  return (
    <Screen footer={footer}>
      <View style={{ minHeight: hitTarget, justifyContent: 'center' }}>
        {canGoBack && router.canGoBack() ? (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={12}
            style={{ alignSelf: 'flex-start', paddingVertical: spacing.sm }}
          >
            <Text variant="button" tone="muted">
              ← {t('common.back')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Progress marks — deliberately quiet. */}
      <View style={{ flexDirection: 'row', gap: 5, marginBottom: spacing.xl }}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 2,
              backgroundColor: i < step ? colors.accent : colors.hairline,
            }}
          />
        ))}
      </View>

      <Text variant="display" style={{ marginBottom: body ? spacing.md : spacing.xl }}>
        {title}
      </Text>

      {body ? (
        <Text variant="body" tone="secondary" style={{ marginBottom: spacing.xl }}>
          {body}
        </Text>
      ) : null}

      {children}
    </Screen>
  );
}

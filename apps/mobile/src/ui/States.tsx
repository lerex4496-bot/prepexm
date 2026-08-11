import React from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

/**
 * The four states every data surface must ship. A component that renders
 * content but has no empty/error/offline story is not finished.
 */

export function EmptyState({
  glyph = '◇',
  title,
  body,
  ctaLabel,
  onCta,
}: {
  glyph?: string;
  title: string;
  body?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing['2xl'], gap: spacing.sm }}>
      <Text variant="display" color={colors.hairlineStrong}>
        {glyph}
      </Text>
      <Text variant="h2" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" align="center" style={{ maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {ctaLabel && onCta ? (
        <View style={{ marginTop: spacing.md }}>
          <Button label={ctaLabel} onPress={onCta} />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
  retryLabel: string;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing['2xl'], gap: spacing.sm }}>
      {/* icon + label, never colour alone */}
      <Text variant="h1" color={colors.error}>
        ⚠
      </Text>
      <Text variant="h2" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" align="center" style={{ maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {onRetry ? (
        <View style={{ marginTop: spacing.md }}>
          <Button label={retryLabel} variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Offline indicator. A quiet badge, never a blocker and never a modal —
 * almost everything in this app works offline by design, so shouting about it
 * would be both annoying and misleading.
 */
export function OfflineBadge({ label }: { label: string }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.sm,
        backgroundColor: colors.surfaceSunken,
      }}
      accessibilityLabel={label}
    >
      <Text variant="caption" tone="muted">
        ⦵ {label}
      </Text>
    </View>
  );
}

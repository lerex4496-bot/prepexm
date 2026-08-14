import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

/**
 * Card — the workhorse container.
 *
 * Default elevation is `flat`: a hairline border and no shadow. Warm Editorial
 * reads as ink on paper, so shadows are reserved for things that genuinely
 * float (sheets, modals). List items never get one.
 */
export function Card({
  children,
  onPress,
  style,
  padded = true,
  tone = 'surface',
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  padded?: boolean;
  tone?: 'surface' | 'sunken' | 'accent';
  accessibilityLabel?: string;
}) {
  const { colors, radius, spacing } = useTheme();

  const bg =
    tone === 'accent' ? colors.accentSoft : tone === 'sunken' ? colors.surfaceSunken : colors.surface;

  const body = (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.hairline,
          padding: padded ? spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.995 : 1 }] })}
    >
      {body}
    </Pressable>
  );
}

/** A small pill. Used for languages, filters, time chips. */
export function Chip({
  label,
  selected = false,
  onPress,
  sublabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  sublabel?: string;
}) {
  const { colors, radius, spacing, hitTarget } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.full,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.hairlineStrong,
        backgroundColor: selected ? colors.primarySoft : 'transparent',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text variant="button" tone={selected ? 'primary' : 'secondary'} align="center">
        {label}
      </Text>
      {sublabel ? (
        <Text variant="caption" tone="muted" align="center">
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Provenance badge — the visual guarantee that official and generated content
 * are never confused.
 *
 * The three kinds differ in fill, border AND glyph, not just colour, so the
 * distinction survives greyscale, colour-blindness and a screenshot sent to a
 * friend.
 *
 *   official  a paper CBSE actually printed, sat as printed
 *   mock      REAL questions from real papers, in a new order — not invented,
 *             but not a paper that ever existed either
 *   ai        generated content (none ships today)
 *
 * `mock` is deliberately its own kind rather than reusing `ai`. Every question
 * in a mock came off a real CTET paper with the board's own answer key behind
 * it; badging that as AI would understate it and teach her to distrust the one
 * thing here that is fully sourced.
 */
export function SourceBadge({ kind, label }: { kind: 'official' | 'mock' | 'ai'; label: string }) {
  const { colors, radius, spacing } = useTheme();
  const isOfficial = kind === 'official';
  const isMock = kind === 'mock';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radius.sm,
        borderWidth: 1.5,
        borderStyle: isOfficial || isMock ? 'solid' : 'dashed',
        borderColor: isOfficial ? colors.successText : isMock ? colors.accent : colors.warningText,
        backgroundColor: isOfficial ? colors.successSoft : isMock ? colors.accentSoft : colors.warningSoft,
      }}
      accessibilityLabel={label}
    >
      <Text variant="caption" color={isOfficial ? colors.successText : isMock ? colors.accent : colors.warningText}>
        {isOfficial ? '✓' : isMock ? '⟳' : '◆'}
      </Text>
      <Text variant="caption" color={isOfficial ? colors.successText : colors.warningText}>
        {label}
      </Text>
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth * 2,
        backgroundColor: colors.hairline,
        marginLeft: inset,
      }}
    />
  );
}

/** A section opener: hairline rule + label. The core editorial device. */
export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
        }}
      >
        <Text variant="h3" tone="secondary" style={{ flexShrink: 1 }}>
          {title}
        </Text>
        {action}
      </View>
      <View style={{ height: 2, backgroundColor: colors.hairlineStrong }} />
    </View>
  );
}

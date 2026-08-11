import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

/**
 * Progress ring. A meter, not a chart: one ratio against a limit, on a
 * same-hue track. Deliberately not a pie — a two-slice pie is the classic
 * wrong form for this job.
 */
export function ProgressRing({
  value,
  size = 72,
  stroke = 7,
  label,
}: {
  /** 0-100 */
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (clamped / 100) * circumference;

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      accessibilityLabel={label}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.hairline}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          // Start the sweep at 12 o'clock rather than 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          fill="none"
        />
      </Svg>
      {/* Latin digits + tabular figures: the number must not reflow as it changes. */}
      <Text variant="numeric" style={{ fontSize: size * 0.26 }}>
        {Math.round(clamped)}%
      </Text>
    </View>
  );
}

/**
 * Mastery bar. Magnitude on a single hue — sequential, not categorical,
 * because these bars compare the SAME measure across topics.
 *
 * The numeric value is always printed beside the bar: never rely on bar length
 * alone, and never rely on colour alone.
 */
export function MasteryBar({
  value,
  label,
  sublabel,
  width = 88,
}: {
  value: number;
  label?: string;
  sublabel?: string;
  /** A number for a fixed track, or '100%' to fill its parent. */
  width?: number | `${number}%`;
}) {
  const { colors, radius, spacing } = useTheme();
  const clamped = Math.max(0, Math.min(100, value));

  // Low mastery is information, not failure — warn only when it is actionable.
  const fill = clamped < 40 ? colors.error : clamped < 70 ? colors.accent : colors.successText;

  return (
    <View style={{ gap: 4 }}>
      {label ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
          <Text variant="caption" tone="secondary" style={{ flexShrink: 1 }}>
            {label}
          </Text>
          <Text variant="numeric" tone="secondary" style={{ fontSize: 13 }}>
            {Math.round(clamped)}%
          </Text>
        </View>
      ) : null}
      <View
        style={{
          height: 8,
          width,
          borderRadius: radius.full,
          backgroundColor: colors.hairline,
          overflow: 'hidden',
        }}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
        accessibilityLabel={label}
      >
        <View
          style={{ height: '100%', width: `${clamped}%`, backgroundColor: fill, borderRadius: radius.full }}
        />
      </View>
      {sublabel ? (
        <Text variant="caption" tone="muted">
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

/** Loading skeleton. Never a spinner for content — a spinner tells her nothing. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | `${number}%` }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ height, width, backgroundColor: colors.hairline, borderRadius: radius.sm }} />
  );
}

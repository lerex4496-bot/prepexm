import React, { useMemo } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { dominantScript, splitScriptRuns } from '@/i18n/script';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, resolveType, type TypeVariant } from '@/theme/typography';

export type TextTone =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'accent'
  | 'inverse'
  | 'success'
  | 'error'
  | 'warning';

export interface TextProps extends Omit<RNTextProps, 'style'> {
  children?: React.ReactNode;
  variant?: TypeVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  style?: TextStyle | TextStyle[];
  /** Force a colour that isn't in the tone set (charts, badges on accent fills). */
  color?: string;
}

/**
 * The script-aware text primitive. Every string in the app goes through here.
 *
 * Two things happen that a plain <Text> cannot do:
 *
 *  1. LINE HEIGHT resolves from the string's dominant script, so Devanagari
 *     and Gujarati get their taller leading and their matras are not clipped.
 *
 *  2. MIXED-SCRIPT STRINGS are split into runs and each run is rendered in the
 *     family that actually covers it. Mukta has no Gujarati and Mukta Vaani
 *     has no Devanagari, so "કોષિકા (Cell)" needs MuktaVaani for the Gujarati
 *     and Mukta for the Latin. Without this the OS silently substitutes a
 *     system font for the uncovered run and the page stops being one typeface.
 *
 * Nested <Text> composes into a single laid-out paragraph in React Native, so
 * wrapping, alignment and truncation still behave as one block.
 */
export function Text({
  children,
  variant = 'body',
  tone = 'default',
  align,
  style,
  color,
  ...rest
}: TextProps) {
  const { colors } = useTheme();

  const toneColor =
    color ??
    {
      default: colors.ink,
      secondary: colors.inkSecondary,
      muted: colors.inkMuted,
      primary: colors.primary,
      accent: colors.accent,
      inverse: colors.inkInverse,
      success: colors.successText,
      error: colors.error,
      warning: colors.warningText,
    }[tone];

  // Only strings can be script-analysed. Nested elements pass straight through.
  const raw = typeof children === 'string' || typeof children === 'number' ? String(children) : null;

  const script = raw ? dominantScript(raw) : 'latn';
  const resolved = resolveType(variant, script);

  const base: TextStyle = {
    fontSize: resolved.fontSize,
    lineHeight: resolved.lineHeight,
    letterSpacing: resolved.letterSpacing,
    color: toneColor,
    textAlign: align,
    ...(resolved.tabular ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
  };

  const runs = useMemo(() => (raw ? splitScriptRuns(raw) : null), [raw]);

  // Single-script string (the common case): one family, no nesting.
  if (runs && runs.length === 1) {
    return (
      <RNText
        {...rest}
        style={[base, { fontFamily: fontFamily(runs[0].script, resolved.weight) }, style as TextStyle]}
      >
        {raw}
      </RNText>
    );
  }

  // Mixed script: parent carries paragraph metrics, children carry families.
  if (runs && runs.length > 1) {
    return (
      <RNText
        {...rest}
        style={[base, { fontFamily: fontFamily(script, resolved.weight) }, style as TextStyle]}
      >
        {runs.map((run, i) => (
          <RNText key={i} style={{ fontFamily: fontFamily(run.script, resolved.weight) }}>
            {run.text}
          </RNText>
        ))}
      </RNText>
    );
  }

  // Non-string children (icons, nested components).
  return (
    <RNText
      {...rest}
      style={[base, { fontFamily: fontFamily('latn', resolved.weight) }, style as TextStyle]}
    >
      {children}
    </RNText>
  );
}

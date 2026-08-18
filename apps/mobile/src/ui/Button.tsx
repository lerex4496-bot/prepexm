import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { usePressScale } from './press';

// Pressable itself is animated so the spring drives the button's own transform
// rather than a wrapper view, which would fight the fullWidth stretch.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Optional leading glyph. Kept as text so it inherits the type scale. */
  icon?: string;
  style?: ViewStyle;
  accessibilityHint?: string;
}

const HEIGHTS: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 56 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  style,
  accessibilityHint,
}: ButtonProps) {
  const { colors, radius, reducedMotion } = useTheme();
  const inactive = disabled || loading;
  const { scale, onPressIn, onPressOut } = usePressScale(!inactive);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: colors.error },
  };

  const inkFor: Record<ButtonVariant, string> = {
    primary: colors.primaryInk,
    secondary: colors.primary,
    ghost: colors.primary,
    danger: '#ffffff',
  };

  const handle = () => {
    if (inactive) return;
    if (!reducedMotion) void Haptics.selectionAsync();
    onPress?.();
  };

  return (
    <AnimatedPressable
      onPress={handle}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      // ARRAY, NEVER A FUNCTION — this shipped broken and made every button in
      // the app invisible.
      //
      // An animated component cannot resolve a `({ pressed }) => [...]` style.
      // Reanimated does not warn; it drops the WHOLE array, so styles.base, the
      // variant surface, minHeight and borderRadius all vanish and the button
      // renders with no background and no size. It is still mounted and still
      // tappable, which is what made it so hard to see in a screenshot: the
      // onboarding screen looked like it simply had no Continue button.
      //
      // The `pressed` flag was only feeding an opacity dip anyway, and the
      // spring scale below is the feedback now, so nothing is lost by dropping
      // the function form entirely.
      style={[
        styles.base,
        surface[variant],
        {
          // minHeight, not height: Devanagari and Gujarati wrap to two lines on
          // narrow screens and a fixed height would clip the descenders.
          minHeight: HEIGHTS[size],
          borderRadius: radius.md,
          opacity: inactive ? 0.45 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
        animated,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={inkFor[variant]} size="small" />
      ) : (
        <View style={styles.row}>
          {icon ? (
            <Text variant="button" color={inkFor[variant]} style={styles.icon}>
              {icon}
            </Text>
          ) : null}
          <Text variant="button" color={inkFor[variant]} align="center" style={styles.label}>
            {label}
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { marginTop: -1 },
  // flexShrink lets a long Hindi/Gujarati label wrap instead of overflowing —
  // translated labels run 15-30% longer than the English source.
  label: { flexShrink: 1 },
});

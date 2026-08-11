import React from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Screen chrome: background, safe areas and the editorial gutter in one place.
 *
 * `scroll` is the default because every screen in this app can grow — Hindi
 * and Gujarati strings run 15-30% longer than their English source, and a
 * layout that fits in English will overflow in Gujarati at 200% text size.
 */
export function Screen({
  children,
  scroll = true,
  gutter: withGutter = true,
  style,
  footer,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  gutter?: boolean;
  style?: ViewStyle;
  /** Pinned below the scroll area — used for onboarding's persistent CTA. */
  footer?: React.ReactNode;
}) {
  const { colors, gutter, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const padding: ViewStyle = {
    paddingHorizontal: withGutter ? gutter : 0,
  };

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[
        padding,
        { paddingTop: spacing.md, paddingBottom: spacing['3xl'] },
        style,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padding, style]}>{children}</View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {body}
      {footer ? (
        <View
          style={[
            padding,
            {
              paddingTop: spacing.md,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              backgroundColor: colors.bg,
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

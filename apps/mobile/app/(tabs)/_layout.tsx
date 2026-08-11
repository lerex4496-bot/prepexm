import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';

import { Text } from '@/ui';
import { useT } from '@/i18n/useT';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Five tabs.
 *
 * It was four for a long time, and the reasoning still holds for what it
 * excluded: Profile is NOT a tab. In a one-student-per-device app it is visited
 * rarely, and spending a slot on it would raise the cognitive load of the
 * most-used surface to save one tap on the least-used. It lives behind the
 * avatar in the Today header.
 *
 * Ask earns its slot on the opposite argument. It is the surface she reaches
 * for mid-revision, when something has not landed — the moment she is most
 * likely to give up and go to a general chatbot that will answer her
 * confidently from nothing. Putting it two taps deep to keep a tidy tab bar
 * would be optimising the wrong thing.
 *
 * Labels render in her language, and icon + label are BOTH always visible:
 * icon-only tabs are unreadable in an unfamiliar app, and these glyphs are not
 * conventional enough to stand alone.
 */
function TabIcon({ glyph, label, focused }: { glyph: string; label: string; focused: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 2, width: '100%' }}>
      <Text variant="h3" color={focused ? colors.accent : colors.inkMuted}>
        {glyph}
      </Text>
      <Text
        variant="caption"
        color={focused ? colors.accent : colors.inkMuted}
        align="center"
        numberOfLines={1}
        style={{ fontSize: 11 }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useT();
  const { colors } = useTheme();

  const tabs = [
    { name: 'today', glyph: '◈', key: 'tab.today' },
    { name: 'learn', glyph: '◫', key: 'tab.learn' },
    { name: 'practice', glyph: '◎', key: 'tab.practice' },
    { name: 'progress', glyph: '◪', key: 'tab.progress' },
    { name: 'ask', glyph: '◌', key: 'tab.ask' },
  ];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.hairline,
          borderTopWidth: 1,
          height: 68,
          paddingTop: 8,
        },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.key),
            tabBarAccessibilityLabel: t(tab.key),
            tabBarIcon: ({ focused }) => (
              <TabIcon glyph={tab.glyph} label={t(tab.key)} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

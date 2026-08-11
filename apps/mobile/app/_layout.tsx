import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { FONT_ASSETS } from '@/theme/typography';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useProfile } from '@/store/profile';
import { useAccount } from '@/account/sync';

void SplashScreen.preventAutoHideAsync();

function Chrome() {
  const { mode, colors } = useTheme();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        {/* The exam player lives OUTSIDE the tab navigator: no tab bar during a
            timed test, and no gesture that could drop her out of one. */}
        <Stack.Screen
          name="exam/[paperId]"
          options={{ gestureEnabled: false, animation: 'fade' }}
        />
        <Stack.Screen name="exam/result/[attemptId]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="practice/quick" />
        <Stack.Screen name="dev/gallery" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // All ten faces must be resident before first paint. Loading them lazily
  // would show a frame of system-font Devanagari/Gujarati, which is exactly
  // the substitution this design system exists to prevent.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);

  const hydrate = useProfile((s) => s.hydrate);
  // Restores a saved session so she is not asked to sign in on every launch.
  // Not awaited in `ready` — an account is optional, and a slow or missing one
  // must never hold up the app starting.
  const hydrateAccount = useAccount((s) => s.hydrate);
  const hydrated = useProfile((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
    void hydrateAccount();
  }, [hydrate, hydrateAccount]);

  const ready = (fontsLoaded || !!fontError) && hydrated;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: '#fdfbf4' }} />;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Chrome />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

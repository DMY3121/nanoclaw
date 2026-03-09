import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  BackHandler,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import {
  PaperProvider,
  MD3DarkTheme,
  Text,
  FAB,
  Button,
  ProgressBar,
  Surface,
  ActivityIndicator,
  useTheme,
  adaptNavigationTheme,
} from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as SecureStore from 'expo-secure-store';

import SetupScreen from './src/screens/SetupScreen';
import { transcribeAudio } from './src/services/transcription';
import { uploadFile, AuthExpiredError } from './src/services/googleDrive';
import { buildNote, buildFilename } from './src/services/noteBuilder';
import { AUTO_CLOSE_SECONDS } from './src/config';

// ── Theme ──────────────────────────────────────────────────────────────────
const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    // Teal primary for a clean voice-note feel
    primary: '#80CBC4',
    primaryContainer: '#004D47',
    onPrimaryContainer: '#9EEAE3',
    secondary: '#B0CCC9',
    secondaryContainer: '#1B3533',
    surface: '#1A1C1E',
    surfaceVariant: '#3F4948',
    background: '#0F1312',
    error: '#FF5449',
    errorContainer: '#93000A',
  },
};

type AppState =
  | 'loading'
  | 'setup'
  | 'ready'
  | 'recording'
  | 'transcribing'
  | 'uploading'
  | 'done'
  | 'error';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Inner app (has access to theme) ───────────────────────────────────────
function VoiceNoteApp() {
  const t = useTheme();

  const [appState, setAppState] = useState<AppState>('loading');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [savedFilename, setSavedFilename] = useState('');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const countdownProgress = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Startup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    const [apiKey, token, folderId] = await Promise.all([
      SecureStore.getItemAsync('openai_api_key'),
      SecureStore.getItemAsync('google_access_token'),
      SecureStore.getItemAsync('drive_folder_id'),
    ]);
    setAppState(apiKey && token && folderId ? 'ready' : 'setup');
  };

  // Auto-start recording
  useEffect(() => {
    if (appState === 'ready') {
      const timer = setTimeout(startRecording, 400);
      return () => clearTimeout(timer);
    }
  }, [appState]);

  // Pulse animation while recording
  useEffect(() => {
    if (appState === 'recording') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.6,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [appState]);

  // Countdown when done
  useEffect(() => {
    if (appState === 'done') {
      setCountdown(AUTO_CLOSE_SECONDS);
      countdownProgress.setValue(1);

      Animated.timing(countdownProgress, {
        toValue: 0,
        duration: AUTO_CLOSE_SECONDS * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();

      let remaining = AUTO_CLOSE_SECONDS;
      countdownInterval.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(countdownInterval.current!);
          closeApp();
        }
      }, 1000);

      return () => {
        clearInterval(countdownInterval.current!);
        countdownProgress.stopAnimation();
      };
    }
  }, [appState]);

  // ── Recording ────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        showError('Microphone permission is required.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setRecordingSeconds(0);
      setAppState('recording');
      recordingInterval.current = setInterval(
        () => setRecordingSeconds((s) => s + 1),
        1000
      );
    } catch (e) {
      showError(`Could not start recording: ${e}`);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recording) return;
    clearInterval(recordingInterval.current!);
    const durationSecs = recordingSeconds;

    setAppState('transcribing');
    setStatusText('Transcribing…');

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) throw new Error('No audio URI returned.');

      const apiKey = await SecureStore.getItemAsync('openai_api_key');
      if (!apiKey) throw new Error('OpenAI API key not found.');

      const transcription = await transcribeAudio(uri, apiKey);

      setAppState('uploading');
      setStatusText('Saving to Google Drive…');

      const [accessToken, folderId] = await Promise.all([
        SecureStore.getItemAsync('google_access_token'),
        SecureStore.getItemAsync('drive_folder_id'),
      ]);
      if (!accessToken || !folderId) throw new Error('Drive credentials missing.');

      const content = buildNote(transcription, durationSecs);
      const filename = buildFilename();
      await uploadFile(content, filename, accessToken, folderId);

      setSavedFilename(filename);
      setAppState('done');
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        await SecureStore.deleteItemAsync('google_access_token');
        showError('Google session expired — tap to reconnect.');
      } else {
        showError(`${e}`);
      }
    }
  }, [recording, recordingSeconds]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const showError = (msg: string) => {
    setErrorMessage(msg);
    setAppState('error');
  };

  const closeApp = () => {
    if (Platform.OS === 'android') BackHandler.exitApp();
    else resetToReady();
  };

  const resetToReady = () => {
    clearInterval(countdownInterval.current!);
    countdownProgress.stopAnimation();
    setRecordingSeconds(0);
    setSavedFilename('');
    setErrorMessage('');
    setAppState('ready');
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (appState === 'loading') return null;

  if (appState === 'setup') {
    return <SetupScreen onComplete={() => setAppState('ready')} />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: t.colors.background }]}>
      <StatusBar style="light" />
      <View style={styles.container}>

        {/* ── RECORDING ─────────────────────────────────────────────── */}
        {appState === 'recording' && (
          <View style={styles.center}>
            {/* Ripple rings */}
            <Animated.View
              style={[
                styles.pulseRing,
                styles.pulseRingOuter,
                {
                  backgroundColor: t.colors.errorContainer,
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.pulseRing,
                styles.pulseRingInner,
                {
                  backgroundColor: t.colors.error + '55',
                  transform: [
                    {
                      scale: pulseAnim.interpolate({
                        inputRange: [1, 1.6],
                        outputRange: [1, 1.3],
                      }),
                    },
                  ],
                },
              ]}
            />

            <FAB
              icon="microphone"
              size="large"
              style={[styles.fab, { backgroundColor: t.colors.error }]}
              color="#fff"
              onPress={stopRecording}
            />

            <Text
              variant="displayMedium"
              style={[styles.timer, { color: t.colors.onSurface }]}
            >
              {formatTime(recordingSeconds)}
            </Text>

            <Text variant="bodyMedium" style={{ color: t.colors.onSurfaceVariant, marginTop: 8 }}>
              Tap to stop
            </Text>
          </View>
        )}

        {/* ── PROCESSING ────────────────────────────────────────────── */}
        {(appState === 'transcribing' || appState === 'uploading') && (
          <View style={styles.center}>
            <ActivityIndicator size={56} color={t.colors.primary} />
            <Text
              variant="titleMedium"
              style={{ color: t.colors.onSurfaceVariant, marginTop: 28 }}
            >
              {statusText}
            </Text>
          </View>
        )}

        {/* ── DONE ──────────────────────────────────────────────────── */}
        {appState === 'done' && (
          <View style={styles.center}>
            <Surface
              style={[styles.iconSurface, { backgroundColor: t.colors.primaryContainer }]}
              elevation={0}
            >
              <Text style={[styles.iconText, { color: t.colors.onPrimaryContainer }]}>✓</Text>
            </Surface>

            <Text
              variant="headlineMedium"
              style={[styles.doneTitle, { color: t.colors.onSurface }]}
            >
              Note saved
            </Text>

            {savedFilename ? (
              <Text
                variant="bodySmall"
                style={{ color: t.colors.onSurfaceVariant, marginTop: 4, textAlign: 'center' }}
              >
                {savedFilename}
              </Text>
            ) : null}

            {/* Countdown progress */}
            <View style={styles.countdownArea}>
              <Animated.View style={{ width: '100%' }}>
                <ProgressBar
                  progress={countdownProgress as unknown as number}
                  color={t.colors.primary}
                  style={styles.progressBar}
                />
              </Animated.View>
              <Text
                variant="labelSmall"
                style={{ color: t.colors.onSurfaceVariant, marginTop: 6, alignSelf: 'flex-end' }}
              >
                Closing in {countdown}s
              </Text>
            </View>

            <Button
              mode="contained-tonal"
              onPress={resetToReady}
              style={styles.moreButton}
              contentStyle={styles.moreButtonContent}
              labelStyle={{ fontSize: 16 }}
            >
              One More Note
            </Button>
          </View>
        )}

        {/* ── READY (brief flash) ────────────────────────────────────── */}
        {appState === 'ready' && (
          <View style={styles.center}>
            <FAB
              icon="microphone"
              size="large"
              style={[styles.fab, { backgroundColor: t.colors.primary, opacity: 0.4 }]}
              color={t.colors.onPrimary}
              onPress={() => {}}
            />
            <Text
              variant="bodyMedium"
              style={{ color: t.colors.onSurfaceVariant, marginTop: 24 }}
            >
              Starting…
            </Text>
          </View>
        )}

        {/* ── ERROR ─────────────────────────────────────────────────── */}
        {appState === 'error' && (
          <View style={styles.center}>
            <Surface
              style={[styles.iconSurface, { backgroundColor: t.colors.errorContainer }]}
              elevation={0}
            >
              <Text style={[styles.iconText, { color: t.colors.error }]}>✕</Text>
            </Surface>

            <Text
              variant="bodyMedium"
              style={[styles.errorText, { color: t.colors.onSurfaceVariant }]}
            >
              {errorMessage}
            </Text>

            <Button
              mode="contained"
              onPress={resetToReady}
              style={[styles.moreButton, { marginTop: 28 }]}
              contentStyle={styles.moreButtonContent}
            >
              Try Again
            </Button>

            {errorMessage.toLowerCase().includes('google') && (
              <Button
                mode="outlined"
                onPress={() => setAppState('setup')}
                style={[styles.moreButton, { marginTop: 12 }]}
                contentStyle={styles.moreButtonContent}
              >
                Reconnect Google Drive
              </Button>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <VoiceNoteApp />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // Recording
  pulseRing: {
    position: 'absolute',
    borderRadius: 999,
  },
  pulseRingOuter: {
    width: 200,
    height: 200,
    opacity: 0.25,
  },
  pulseRingInner: {
    width: 160,
    height: 160,
    opacity: 0.35,
  },
  fab: {
    borderRadius: 999,
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: {
    marginTop: 40,
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },

  // Done / Error shared
  iconSurface: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 44,
    fontWeight: '300',
  },
  doneTitle: {
    marginTop: 24,
  },
  countdownArea: {
    width: '100%',
    marginTop: 40,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
  },
  moreButton: {
    marginTop: 32,
    borderRadius: 12,
  },
  moreButtonContent: {
    paddingVertical: 8,
    paddingHorizontal: 24,
  },

  // Error
  errorText: {
    marginTop: 20,
    textAlign: 'center',
    lineHeight: 22,
  },
});

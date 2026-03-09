import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
  Platform,
  Animated,
  Easing,
  SafeAreaView,
} from 'react-native';
import { Audio } from 'expo-av';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';

import SetupScreen from './src/screens/SetupScreen';
import { transcribeAudio } from './src/services/transcription';
import { uploadFile, AuthExpiredError } from './src/services/googleDrive';
import { buildNote, buildFilename } from './src/services/noteBuilder';
import { AUTO_CLOSE_SECONDS } from './src/config';

type AppState = 'loading' | 'setup' | 'ready' | 'recording' | 'transcribing' | 'uploading' | 'done' | 'error';

const COLORS = {
  bg: '#0a0a0a',
  red: '#ff3b30',
  green: '#34c759',
  white: '#ffffff',
  gray: '#8e8e93',
  darkGray: '#1c1c1e',
  border: '#2c2c2e',
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [savedFilename, setSavedFilename] = useState('');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const countdownAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Startup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    const [apiKey, token, folderId] = await Promise.all([
      SecureStore.getItemAsync('openai_api_key'),
      SecureStore.getItemAsync('google_access_token'),
      SecureStore.getItemAsync('drive_folder_id'),
    ]);
    if (apiKey && token && folderId) {
      setAppState('ready');
    } else {
      setAppState('setup');
    }
  };

  // ── Auto-start recording when ready ───────────────────────────────────────
  useEffect(() => {
    if (appState === 'ready') {
      const t = setTimeout(startRecording, 400);
      return () => clearTimeout(t);
    }
  }, [appState]);

  // ── Pulse animation while recording ───────────────────────────────────────
  useEffect(() => {
    if (appState === 'recording') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.35,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
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

  // ── Countdown when done ────────────────────────────────────────────────────
  useEffect(() => {
    if (appState === 'done') {
      setCountdown(AUTO_CLOSE_SECONDS);
      countdownAnim.setValue(1);

      // Animate countdown bar
      Animated.timing(countdownAnim, {
        toValue: 0,
        duration: AUTO_CLOSE_SECONDS * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();

      // Tick counter
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
        countdownAnim.stopAnimation();
      };
    }
  }, [appState]);

  // ── Recording logic ────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        showError('Microphone permission is required.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();

      setRecording(rec);
      setRecordingSeconds(0);
      setAppState('recording');

      recordingInterval.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      showError(`Could not start recording: ${e}`);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recording) return;

    clearInterval(recordingInterval.current!);
    const durationSecs = recordingSeconds;

    setAppState('transcribing');
    setStatusText('Transcribing audio…');

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
        // Clear token so setup re-runs Google auth
        await SecureStore.deleteItemAsync('google_access_token');
        showError('Google session expired. Tap to reconnect.');
      } else {
        showError(`${e}`);
      }
    }
  }, [recording, recordingSeconds]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const showError = (msg: string) => {
    setErrorMessage(msg);
    setAppState('error');
  };

  const closeApp = () => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      // iOS: reset to ready (will auto-start recording for next note)
      resetToReady();
    }
  };

  const resetToReady = () => {
    clearInterval(countdownInterval.current!);
    countdownAnim.stopAnimation();
    setRecordingSeconds(0);
    setStatusText('');
    setSavedFilename('');
    setErrorMessage('');
    setAppState('ready');
  };

  const handleSetupComplete = () => setAppState('ready');

  const handleReconnectDrive = () => setAppState('setup');

  // ── Render ─────────────────────────────────────────────────────────────────
  if (appState === 'loading') return null;

  if (appState === 'setup') {
    return <SetupScreen onComplete={handleSetupComplete} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        {/* ── RECORDING ── */}
        {appState === 'recording' && (
          <View style={styles.center}>
            <TouchableOpacity onPress={stopRecording} activeOpacity={0.8}>
              <Animated.View
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              />
              <View style={styles.micButton}>
                <Text style={styles.micIcon}>🎙</Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.timer}>{formatTime(recordingSeconds)}</Text>
            <Text style={styles.hint}>Tap to stop</Text>
          </View>
        )}

        {/* ── TRANSCRIBING / UPLOADING ── */}
        {(appState === 'transcribing' || appState === 'uploading') && (
          <View style={styles.center}>
            <ProcessingSpinner />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ── DONE ── */}
        {appState === 'done' && (
          <View style={styles.center}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkIcon}>✓</Text>
            </View>

            <Text style={styles.doneTitle}>Note saved!</Text>
            {savedFilename ? (
              <Text style={styles.filename}>{savedFilename}</Text>
            ) : null}

            {/* Countdown bar */}
            <View style={styles.countdownTrack}>
              <Animated.View
                style={[
                  styles.countdownBar,
                  {
                    width: countdownAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
            <Text style={styles.countdownText}>Closing in {countdown}s</Text>

            <TouchableOpacity style={styles.moreButton} onPress={resetToReady}>
              <Text style={styles.moreButtonText}>One More Note</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── READY (brief flash before auto-start) ── */}
        {appState === 'ready' && (
          <View style={styles.center}>
            <View style={[styles.micButton, { opacity: 0.4 }]}>
              <Text style={styles.micIcon}>🎙</Text>
            </View>
            <Text style={styles.hint}>Starting…</Text>
          </View>
        )}

        {/* ── ERROR ── */}
        {appState === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorIcon}>✕</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>

            <TouchableOpacity style={styles.moreButton} onPress={resetToReady}>
              <Text style={styles.moreButtonText}>Try Again</Text>
            </TouchableOpacity>

            {errorMessage.toLowerCase().includes('google') && (
              <TouchableOpacity style={[styles.moreButton, styles.secondaryButton]} onPress={handleReconnectDrive}>
                <Text style={styles.secondaryButtonText}>Reconnect Google Drive</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────────────
function ProcessingSpinner() {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // Recording
  pulseRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: `${COLORS.red}30`,
    alignSelf: 'center',
    top: -10,
    left: -10,
  },
  micButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIcon: {
    fontSize: 52,
  },
  timer: {
    marginTop: 36,
    fontSize: 48,
    fontWeight: '200',
    color: COLORS.white,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.gray,
  },

  // Processing
  spinner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: COLORS.border,
    borderTopColor: COLORS.white,
  },
  statusText: {
    marginTop: 24,
    fontSize: 17,
    color: COLORS.gray,
  },

  // Done
  checkCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIcon: {
    fontSize: 48,
    color: COLORS.white,
    fontWeight: '600',
  },
  doneTitle: {
    marginTop: 28,
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.white,
  },
  filename: {
    marginTop: 8,
    fontSize: 13,
    color: COLORS.gray,
    textAlign: 'center',
  },
  countdownTrack: {
    marginTop: 40,
    width: '100%',
    height: 3,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  countdownBar: {
    height: 3,
    backgroundColor: COLORS.green,
    borderRadius: 2,
  },
  countdownText: {
    marginTop: 8,
    fontSize: 13,
    color: COLORS.gray,
  },
  moreButton: {
    marginTop: 32,
    paddingVertical: 16,
    paddingHorizontal: 48,
    backgroundColor: COLORS.darkGray,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  moreButtonText: {
    fontSize: 17,
    fontWeight: '500',
    color: COLORS.white,
  },

  // Error
  errorIcon: {
    fontSize: 56,
    color: COLORS.red,
    fontWeight: '300',
  },
  errorText: {
    marginTop: 16,
    fontSize: 15,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 22,
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: 'transparent',
    borderColor: COLORS.border,
  },
  secondaryButtonText: {
    fontSize: 15,
    color: COLORS.gray,
  },
});

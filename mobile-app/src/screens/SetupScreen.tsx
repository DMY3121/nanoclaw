import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { listFolders, DriveFolder } from '../services/googleDrive';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../config';

WebBrowser.maybeCompleteAuthSession();

type Step = 'api_key' | 'google_auth' | 'folder_picker' | 'done';

const COLORS = {
  bg: '#0a0a0a',
  card: '#1c1c1e',
  white: '#ffffff',
  gray: '#8e8e93',
  border: '#2c2c2e',
  accent: '#0a84ff',
  green: '#34c759',
  red: '#ff3b30',
};

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

interface Props {
  onComplete: () => void;
}

export default function SetupScreen({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [validatingKey, setValidatingKey] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<DriveFolder | null>(null);

  const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });

  const [request, authResponse, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      redirectUri,
      scopes: GOOGLE_SCOPES,
      responseType: AuthSession.ResponseType.Token,
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
    GOOGLE_DISCOVERY
  );

  // Handle Google OAuth response
  useEffect(() => {
    if (authResponse?.type === 'success') {
      const token = authResponse.params.access_token;
      if (token) {
        setAccessToken(token);
        fetchFolders(token);
      }
    } else if (authResponse?.type === 'error') {
      Alert.alert('Auth Error', authResponse.error?.message ?? 'Google sign-in failed.');
    }
  }, [authResponse]);

  const validateApiKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed.startsWith('sk-')) {
      Alert.alert('Invalid Key', 'OpenAI API keys start with "sk-".');
      return;
    }

    setValidatingKey(true);
    try {
      // Quick check: list models (cheap, requires valid key)
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!res.ok) {
        Alert.alert('Invalid Key', 'The API key was rejected by OpenAI.');
        return;
      }
      await SecureStore.setItemAsync('openai_api_key', trimmed);
      setStep('google_auth');
    } catch {
      Alert.alert('Network Error', 'Could not reach OpenAI. Check your connection.');
    } finally {
      setValidatingKey(false);
    }
  };

  const fetchFolders = async (token: string) => {
    setLoadingFolders(true);
    setStep('folder_picker');
    try {
      const list = await listFolders(token);
      setFolders(list);
    } catch (e) {
      Alert.alert('Drive Error', `Could not list folders: ${e}`);
    } finally {
      setLoadingFolders(false);
    }
  };

  const confirmFolder = async () => {
    if (!selectedFolder) return;
    await Promise.all([
      SecureStore.setItemAsync('google_access_token', accessToken),
      SecureStore.setItemAsync('drive_folder_id', selectedFolder.id),
      SecureStore.setItemAsync('drive_folder_name', selectedFolder.name),
    ]);
    setStep('done');
    setTimeout(onComplete, 800);
  };

  // ── Step: API Key ──────────────────────────────────────────────────────────
  if (step === 'api_key') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.inner}>
          <Text style={styles.stepLabel}>Step 1 of 3</Text>
          <Text style={styles.title}>OpenAI API Key</Text>
          <Text style={styles.subtitle}>
            Used to transcribe your voice notes via Whisper.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="sk-..."
            placeholderTextColor={COLORS.gray}
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={validateApiKey}
          />

          <TouchableOpacity
            style={[styles.button, (!apiKey.trim() || validatingKey) && styles.buttonDisabled]}
            onPress={validateApiKey}
            disabled={!apiKey.trim() || validatingKey}
          >
            {validatingKey ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.buttonText}>Continue</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Get your key at platform.openai.com → API keys
          </Text>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Step: Google Auth ──────────────────────────────────────────────────────
  if (step === 'google_auth') {
    const clientIdMissing = !GOOGLE_CLIENT_ID;
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.stepLabel}>Step 2 of 3</Text>
          <Text style={styles.title}>Connect Google Drive</Text>
          <Text style={styles.subtitle}>
            Your notes will be saved as .md files in a folder you choose.
          </Text>

          {clientIdMissing && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️  Open{' '}
                <Text style={styles.code}>mobile-app/src/config.ts</Text> and
                set your{' '}
                <Text style={styles.code}>GOOGLE_CLIENT_ID</Text> before signing in.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, clientIdMissing && styles.buttonDisabled]}
            onPress={() => promptAsync({ useProxy: true })}
            disabled={!request || clientIdMissing}
          >
            <Text style={styles.buttonText}>Sign in with Google</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Only "drive.file" scope is requested — the app can only see files it creates.
          </Text>
        </View>
      </View>
    );
  }

  // ── Step: Folder Picker ────────────────────────────────────────────────────
  if (step === 'folder_picker') {
    return (
      <View style={styles.container}>
        <View style={styles.headerArea}>
          <Text style={styles.stepLabel}>Step 3 of 3</Text>
          <Text style={styles.title}>Choose a folder</Text>
          <Text style={styles.subtitle}>Notes will be saved here.</Text>
        </View>

        {loadingFolders ? (
          <View style={styles.centerFlex}>
            <ActivityIndicator color={COLORS.white} size="large" />
            <Text style={[styles.subtitle, { marginTop: 16 }]}>Loading folders…</Text>
          </View>
        ) : (
          <ScrollView style={styles.folderList} contentContainerStyle={{ paddingBottom: 120 }}>
            {folders.length === 0 && (
              <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 32 }]}>
                No folders found. Create one in Google Drive first.
              </Text>
            )}
            {folders.map((folder) => {
              const selected = selectedFolder?.id === folder.id;
              return (
                <TouchableOpacity
                  key={folder.id}
                  style={[styles.folderRow, selected && styles.folderRowSelected]}
                  onPress={() => setSelectedFolder(folder)}
                >
                  <Text style={styles.folderIcon}>📁</Text>
                  <Text style={[styles.folderName, selected && styles.folderNameSelected]}>
                    {folder.name}
                  </Text>
                  {selected && <Text style={styles.checkMark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.button, !selectedFolder && styles.buttonDisabled]}
            onPress={confirmFolder}
            disabled={!selectedFolder}
          >
            <Text style={styles.buttonText}>
              {selectedFolder ? `Use "${selectedFolder.name}"` : 'Select a folder'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Step: Done ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <Text style={[styles.title, { color: COLORS.green }]}>All set!</Text>
        <Text style={styles.subtitle}>Starting voice recorder…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  inner: {
    flex: 1,
    padding: 32,
    justifyContent: 'center',
  },
  headerArea: {
    padding: 32,
    paddingBottom: 16,
  },
  centerFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontSize: 13,
    color: COLORS.gray,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.gray,
    lineHeight: 22,
    marginBottom: 32,
  },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.white,
    marginBottom: 20,
  },
  button: {
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.white,
  },
  footnote: {
    marginTop: 16,
    fontSize: 12,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 18,
  },
  warningBox: {
    backgroundColor: '#2c1c00',
    borderRadius: 10,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#ff9500',
  },
  warningText: {
    color: '#ff9500',
    fontSize: 13,
    lineHeight: 20,
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },

  // Folder picker
  folderList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  folderRowSelected: {
    borderColor: COLORS.accent,
    backgroundColor: '#0a1a2e',
  },
  folderIcon: {
    fontSize: 22,
    marginRight: 12,
  },
  folderName: {
    flex: 1,
    fontSize: 16,
    color: COLORS.white,
  },
  folderNameSelected: {
    color: COLORS.accent,
    fontWeight: '500',
  },
  checkMark: {
    fontSize: 18,
    color: COLORS.accent,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: 40,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});

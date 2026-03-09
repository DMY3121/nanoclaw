import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  List,
  Divider,
  ActivityIndicator,
  useTheme,
  Appbar,
  Banner,
  HelperText,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { listFolders, DriveFolder } from '../services/googleDrive';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../config';

WebBrowser.maybeCompleteAuthSession();

type Step = 'api_key' | 'google_auth' | 'folder_picker' | 'done';

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

interface Props {
  onComplete: () => void;
}

export default function SetupScreen({ onComplete }: Props) {
  const t = useTheme();

  const [step, setStep] = useState<Step>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [validatingKey, setValidatingKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<DriveFolder | null>(null);

  const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });

  const [request, authResponse, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      redirectUri,
      scopes: GOOGLE_SCOPES,
      responseType: AuthSession.ResponseType.Token,
      extraParams: { access_type: 'offline', prompt: 'consent' },
    },
    GOOGLE_DISCOVERY
  );

  useEffect(() => {
    if (authResponse?.type === 'success') {
      const token = authResponse.params.access_token;
      if (token) {
        setAccessToken(token);
        fetchFolders(token);
      }
    } else if (authResponse?.type === 'error') {
      setFolderError(authResponse.error?.message ?? 'Google sign-in failed.');
    }
  }, [authResponse]);

  const validateApiKey = async () => {
    const trimmed = apiKey.trim();
    setKeyError('');
    if (!trimmed.startsWith('sk-')) {
      setKeyError('OpenAI keys start with "sk-"');
      return;
    }
    setValidatingKey(true);
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!res.ok) {
        setKeyError('Key rejected by OpenAI — check it and try again.');
        return;
      }
      await SecureStore.setItemAsync('openai_api_key', trimmed);
      setStep('google_auth');
    } catch {
      setKeyError('Network error — check your connection.');
    } finally {
      setValidatingKey(false);
    }
  };

  const fetchFolders = async (token: string) => {
    setLoadingFolders(true);
    setFolderError('');
    setStep('folder_picker');
    try {
      const list = await listFolders(token);
      setFolders(list);
    } catch (e) {
      setFolderError(`Could not load folders: ${e}`);
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
    setTimeout(onComplete, 600);
  };

  const bg = t.colors.background;
  const surface = t.colors.surface;

  // ── Step 1: API Key ──────────────────────────────────────────────────────
  if (step === 'api_key') {
    return (
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.flex}>
          <Appbar.Header style={{ backgroundColor: 'transparent' }} elevated={false}>
            <Appbar.Content title="Setup (1 / 3)" />
          </Appbar.Header>

          <View style={styles.inner}>
            <Text variant="headlineMedium" style={[styles.title, { color: t.colors.onSurface }]}>
              OpenAI API Key
            </Text>
            <Text variant="bodyMedium" style={{ color: t.colors.onSurfaceVariant, marginBottom: 28 }}>
              Used to transcribe your voice notes via Whisper.
            </Text>

            <TextInput
              label="API Key"
              value={apiKey}
              onChangeText={(v) => { setApiKey(v); setKeyError(''); }}
              mode="outlined"
              secureTextEntry={!apiKeyVisible}
              autoCapitalize="none"
              autoCorrect={false}
              right={
                <TextInput.Icon
                  icon={apiKeyVisible ? 'eye-off' : 'eye'}
                  onPress={() => setApiKeyVisible((v) => !v)}
                />
              }
              error={!!keyError}
              onSubmitEditing={validateApiKey}
              returnKeyType="done"
            />
            <HelperText type={keyError ? 'error' : 'info'} visible>
              {keyError || 'Find your key at platform.openai.com → API keys'}
            </HelperText>

            <Button
              mode="contained"
              onPress={validateApiKey}
              disabled={!apiKey.trim() || validatingKey}
              loading={validatingKey}
              style={styles.button}
              contentStyle={styles.buttonContent}
            >
              Continue
            </Button>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step 2: Google Auth ──────────────────────────────────────────────────
  if (step === 'google_auth') {
    const clientIdMissing = !GOOGLE_CLIENT_ID;
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: bg }]}>
        <Appbar.Header style={{ backgroundColor: 'transparent' }} elevated={false}>
          <Appbar.BackAction onPress={() => setStep('api_key')} />
          <Appbar.Content title="Setup (2 / 3)" />
        </Appbar.Header>

        <View style={styles.inner}>
          <Text variant="headlineMedium" style={[styles.title, { color: t.colors.onSurface }]}>
            Connect Google Drive
          </Text>
          <Text variant="bodyMedium" style={{ color: t.colors.onSurfaceVariant, marginBottom: 28 }}>
            Notes will be saved as .md files in a Drive folder you choose.
          </Text>

          {clientIdMissing && (
            <Banner
              visible
              icon="alert"
              style={{ marginBottom: 20, borderRadius: 12 }}
            >
              Open{' '}
              <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 }}>
                src/config.ts
              </Text>{' '}
              and set your GOOGLE_CLIENT_ID before signing in.
            </Banner>
          )}

          <Surface style={[styles.infoCard, { backgroundColor: t.colors.secondaryContainer }]} elevation={0}>
            <List.Icon icon="shield-check" color={t.colors.onSecondaryContainer} />
            <Text variant="bodySmall" style={{ color: t.colors.onSecondaryContainer, flex: 1 }}>
              Only "drive.file" scope — the app can only see files it creates.
            </Text>
          </Surface>

          <Button
            mode="contained"
            icon="google"
            onPress={() => promptAsync({ useProxy: true })}
            disabled={!request || clientIdMissing}
            style={[styles.button, { marginTop: 32 }]}
            contentStyle={styles.buttonContent}
          >
            Sign in with Google
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // ── Step 3: Folder Picker ────────────────────────────────────────────────
  if (step === 'folder_picker') {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: bg }]}>
        <Appbar.Header style={{ backgroundColor: 'transparent' }} elevated={false}>
          <Appbar.BackAction onPress={() => setStep('google_auth')} />
          <Appbar.Content title="Setup (3 / 3)" />
        </Appbar.Header>

        <Text variant="headlineMedium" style={[styles.title, styles.titlePadded, { color: t.colors.onSurface }]}>
          Choose a folder
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitlePadded, { color: t.colors.onSurfaceVariant }]}>
          Voice notes will be saved here.
        </Text>

        {loadingFolders ? (
          <View style={styles.centerFlex}>
            <ActivityIndicator size={40} />
            <Text variant="bodyMedium" style={{ color: t.colors.onSurfaceVariant, marginTop: 16 }}>
              Loading folders…
            </Text>
          </View>
        ) : (
          <>
            {folderError ? (
              <Banner visible icon="alert-circle" style={{ margin: 16, borderRadius: 12 }}>
                {folderError}
              </Banner>
            ) : null}

            <ScrollView style={styles.flex} contentContainerStyle={{ paddingBottom: 120 }}>
              {folders.length === 0 && !loadingFolders && (
                <Text
                  variant="bodyMedium"
                  style={{ color: t.colors.onSurfaceVariant, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 }}
                >
                  No folders found. Create one in Google Drive first.
                </Text>
              )}
              <Surface style={{ marginHorizontal: 16, borderRadius: 16, overflow: 'hidden' }} elevation={0}>
                {folders.map((folder, index) => {
                  const selected = selectedFolder?.id === folder.id;
                  return (
                    <React.Fragment key={folder.id}>
                      <List.Item
                        title={folder.name}
                        titleStyle={{ color: selected ? t.colors.primary : t.colors.onSurface }}
                        left={() => (
                          <List.Icon
                            icon="folder"
                            color={selected ? t.colors.primary : t.colors.onSurfaceVariant}
                          />
                        )}
                        right={() =>
                          selected ? (
                            <List.Icon icon="check" color={t.colors.primary} />
                          ) : null
                        }
                        onPress={() => setSelectedFolder(folder)}
                        style={[
                          styles.folderRow,
                          selected && { backgroundColor: t.colors.primaryContainer },
                        ]}
                      />
                      {index < folders.length - 1 && <Divider />}
                    </React.Fragment>
                  );
                })}
              </Surface>
            </ScrollView>

            <View style={[styles.bottomBar, { backgroundColor: bg, borderTopColor: t.colors.surfaceVariant }]}>
              <Button
                mode="contained"
                onPress={confirmFolder}
                disabled={!selectedFolder}
                style={styles.button}
                contentStyle={styles.buttonContent}
              >
                {selectedFolder ? `Use "${selectedFolder.name}"` : 'Select a folder'}
              </Button>
            </View>
          </>
        )}
      </SafeAreaView>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: bg }]}>
      <View style={styles.centerFlex}>
        <Text variant="headlineMedium" style={{ color: t.colors.primary }}>All set!</Text>
        <Text variant="bodyMedium" style={{ color: t.colors.onSurfaceVariant, marginTop: 8 }}>
          Starting voice recorder…
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  title: {
    marginBottom: 8,
  },
  titlePadded: {
    paddingHorizontal: 24,
  },
  subtitlePadded: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  centerFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  folderRow: {
    paddingHorizontal: 8,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

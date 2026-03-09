/**
 * Fill in your credentials before building.
 *
 * Google Client ID: Create a project at https://console.cloud.google.com,
 * enable the Drive API, and create an OAuth 2.0 Web client credential.
 * Add "https://auth.expo.io/@your-expo-username/voice-note-drive" as an
 * Authorized Redirect URI.
 *
 * OpenAI API key: entered by the user at first-run setup.
 */
export const GOOGLE_CLIENT_ID = ''; // e.g. "1234567890-abc.apps.googleusercontent.com"

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export const WHISPER_MODEL = 'whisper-1';

export const AUTO_CLOSE_SECONDS = 10;

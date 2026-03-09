/**
 * Fill in your credentials before building.
 *
 * Google Client ID: Create a project at https://console.cloud.google.com,
 * enable the Drive API, and create an OAuth 2.0 Web client credential.
 * Add "https://auth.expo.io/@your-expo-username/voice-note-drive" as an
 * Authorized Redirect URI.
 *
 * API keys are entered by the user at first-run setup and stored securely on-device:
 *   - Gemini API key  → audio transcription (Gemini 1.5 Flash)
 *   - Anthropic key   → title + tag deduction (Claude Haiku)
 */
export const GOOGLE_CLIENT_ID = ''; // e.g. "1234567890-abc.apps.googleusercontent.com"

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export const GEMINI_MODEL = 'gemini-1.5-flash';
export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

export const AUTO_CLOSE_SECONDS = 10;

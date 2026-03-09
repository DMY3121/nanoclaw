# Voice Note — Mobile App

Record a voice note → auto-transcribes → saves a `.md` file to Google Drive.

## Flow

1. App opens → microphone starts **immediately**
2. Speak your note
3. Tap the red button to stop
4. Whisper transcribes the audio
5. A `.md` file with YAML front matter is uploaded to your chosen Drive folder
6. Success screen shows a 10-second countdown, then closes
7. Tap **One More Note** to record another without closing

---

## Quick Start

### 1. Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/): `npm install -g expo-cli`
- [Expo Go](https://expo.dev/client) app on your phone

### 2. Install dependencies

```bash
cd mobile-app
npm install
```

### 3. Get an OpenAI API key

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new key
3. You'll enter it in the app on first launch

### 4. Set up Google Drive API

#### a. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Google Drive API**:
   - APIs & Services → Library → search "Drive API" → Enable

#### b. Create OAuth credentials

1. APIs & Services → Credentials → **Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `Voice Note App`
4. Authorized redirect URIs — add:
   ```
   https://auth.expo.io/@YOUR_EXPO_USERNAME/voice-note-drive
   ```
   Replace `YOUR_EXPO_USERNAME` with your username from `expo whoami`.
5. Click **Create** and copy the **Client ID**

#### c. Configure the app

Open `src/config.ts` and paste your Client ID:

```typescript
export const GOOGLE_CLIENT_ID = '1234567890-xxxx.apps.googleusercontent.com';
```

### 5. Run the app

```bash
npx expo start
```

Scan the QR code with **Expo Go** on your phone.

---

## First-Run Setup (in-app)

On the first launch the app guides you through 3 steps:

| Step | What happens |
|------|-------------|
| **1 — OpenAI key** | Enter your `sk-...` key. It's validated and stored securely on-device. |
| **2 — Google sign-in** | Tap to open Google OAuth in a browser. Only `drive.file` scope is requested (the app can only see files *it* creates). |
| **3 — Choose folder** | Pick a folder from your Drive. Notes go there. |

---

## Output Format

Each note is saved as:

```
note-YYYY-MM-DD-HHmmss.md
```

Contents:

```markdown
---
date: 2026-03-09T14:30:00.000Z
title: "First ~60 characters of the transcription"
duration: 1m 23s
source: voice
---

Full transcription text here.
```

---

## Building for Production

To install the app directly (without Expo Go):

```bash
npx eas build --platform ios    # or android
npx eas submit                   # submit to App Store / Play Store
```

You'll need separate OAuth client IDs for iOS and Android builds — add them to `app.json` under `expo.extra` and update `src/config.ts`.

---

## Re-connecting Google Drive

If the Google session expires, the app shows an error with a **Reconnect Google Drive** button that re-runs the OAuth flow.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Microphone permission required" | Grant mic access in iOS Settings / Android App Info |
| "Google Client ID missing" warning | Fill in `GOOGLE_CLIENT_ID` in `src/config.ts` |
| Upload fails with 401 | Tap "Reconnect Google Drive" to refresh auth |
| Whisper returns empty text | Speak clearly; check your OpenAI account has credits |

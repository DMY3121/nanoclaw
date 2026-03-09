import { WHISPER_MODEL } from '../config';

/**
 * Sends an audio file to OpenAI Whisper and returns the transcription text.
 * @param audioUri  Local file URI from expo-av
 * @param apiKey    OpenAI API key
 */
export async function transcribeAudio(audioUri: string, apiKey: string): Promise<string> {
  const formData = new FormData();

  // React Native FormData accepts a file object via uri/name/type
  formData.append('file', {
    uri: audioUri,
    name: 'recording.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);

  formData.append('model', WHISPER_MODEL);
  formData.append('response_format', 'json');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Do NOT set Content-Type — fetch sets multipart boundary automatically
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.status.toString());
    throw new Error(`Whisper API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}

import * as FileSystem from 'expo-file-system';

/**
 * Transcribes an audio file using Google Gemini 1.5 Flash.
 * Audio is read as base64 and sent as inline data (supports m4a up to ~20 MB).
 */
export async function transcribeAudio(audioUri: string, geminiApiKey: string): Promise<string> {
  // Read audio file as base64
  const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: 'audio/m4a',
                  data: base64Audio,
                },
              },
              {
                text: 'Transcribe this audio accurately and completely. Return only the transcription text, no timestamps, no speaker labels, nothing else.',
              },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text().catch(() => response.status.toString());
    throw new Error(`Gemini transcription error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) throw new Error('Gemini returned an empty transcription.');
  return text.trim();
}

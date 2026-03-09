import * as Location from 'expo-location';

export interface NoteMetadata {
  title: string;
  tags: string[];
  location: { latitude: number; longitude: number } | null;
}

/**
 * Gathers all enriched metadata for a note in parallel:
 * - GPS location (best-effort, null if unavailable)
 * - Title + tags deduced from the transcription via GPT-4o-mini
 */
export async function gatherMetadata(
  transcription: string,
  apiKey: string
): Promise<NoteMetadata> {
  const [locationResult, aiResult] = await Promise.allSettled([
    getLocation(),
    deduceMetadata(transcription, apiKey),
  ]);

  const location =
    locationResult.status === 'fulfilled' ? locationResult.value : null;

  const { title, tags } =
    aiResult.status === 'fulfilled'
      ? aiResult.value
      : { title: fallbackTitle(), tags: [] };

  return { title, tags, location };
}

// ── Location ─────────────────────────────────────────────────────────────

async function getLocation(): Promise<{ latitude: number; longitude: number } | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
  };
}

// ── AI title + tags ───────────────────────────────────────────────────────

interface AiResult {
  title: string;
  tags: string[];
}

async function deduceMetadata(transcription: string, apiKey: string): Promise<AiResult> {
  const text = transcription.trim().slice(0, 2000); // cap to keep cost low

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content:
            'You are a metadata extractor for personal voice notes. ' +
            'Given a transcription, return a JSON object with exactly two keys:\n' +
            '- "title": a concise title (max 8 words, no quotes)\n' +
            '- "tags": an array of 1–5 lowercase single-word or short-phrase tags ' +
            'that best describe the topic (no "#" prefix)\n' +
            'Return only valid JSON, nothing else.',
        },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!response.ok) throw new Error(`GPT error ${response.status}`);

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const parsed = JSON.parse(data.choices[0].message.content) as {
    title?: string;
    tags?: unknown;
  };

  const title =
    typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : fallbackTitle();

  const tags = Array.isArray(parsed.tags)
    ? (parsed.tags as unknown[])
        .filter((tag): tag is string => typeof tag === 'string')
        .slice(0, 5)
    : [];

  return { title, tags };
}

function fallbackTitle(): string {
  const now = new Date();
  return `Note ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

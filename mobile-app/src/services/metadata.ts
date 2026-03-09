import * as Location from 'expo-location';

export interface NoteMetadata {
  title: string;
  tags: string[];
  location: { latitude: number; longitude: number } | null;
}

/**
 * Gathers all enriched metadata for a note in parallel:
 * - GPS location via expo-location (best-effort, null if unavailable)
 * - Title + tags deduced from the transcription via Claude Haiku
 */
export async function gatherMetadata(
  transcription: string,
  anthropicApiKey: string
): Promise<NoteMetadata> {
  const [locationResult, aiResult] = await Promise.allSettled([
    getLocation(),
    deduceMetadata(transcription, anthropicApiKey),
  ]);

  const location =
    locationResult.status === 'fulfilled' ? locationResult.value : null;

  const { title, tags } =
    aiResult.status === 'fulfilled'
      ? aiResult.value
      : { title: fallbackTitle(), tags: [] };

  return { title, tags, location };
}

// ── Location ──────────────────────────────────────────────────────────────

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

// ── Claude title + tags ───────────────────────────────────────────────────

interface AiResult {
  title: string;
  tags: string[];
}

async function deduceMetadata(transcription: string, anthropicApiKey: string): Promise<AiResult> {
  const text = transcription.trim().slice(0, 2000);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content:
            'Extract metadata from this voice note transcription.\n' +
            'Return a JSON object with exactly two keys:\n' +
            '- "title": concise title, max 8 words, no surrounding quotes\n' +
            '- "tags": array of 1–5 lowercase tags (single words or short phrases, no # prefix)\n' +
            'Return only valid JSON, nothing else.\n\n' +
            `Transcription:\n${text}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.status.toString());
    throw new Error(`Claude metadata error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const raw = data.content?.find((b) => b.type === 'text')?.text ?? '{}';

  // Strip markdown code fences if Claude wrapped the JSON
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  const parsed = JSON.parse(jsonStr) as { title?: string; tags?: unknown };

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
  return `Note ${now.toLocaleDateString()} ${now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

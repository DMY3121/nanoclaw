import { NoteMetadata } from './metadata';

/**
 * Builds the .md file content with YAML front matter.
 */
export function buildNote(
  transcription: string,
  durationSeconds: number,
  meta: NoteMetadata
): string {
  const now = new Date();

  const locationLine =
    meta.location
      ? `location: "${meta.location.latitude.toFixed(6)}, ${meta.location.longitude.toFixed(6)}"`
      : 'location: null';

  const tagsLine =
    meta.tags.length > 0
      ? `tags: [${meta.tags.map((t) => `"${t}"`).join(', ')}]`
      : 'tags: []';

  const mins = Math.floor(durationSeconds / 60);
  const secs = durationSeconds % 60;
  const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return [
    '---',
    `title: "${meta.title.replace(/"/g, "'")}"`,
    `created: ${now.toISOString()}`,
    locationLine,
    tagsLine,
    `duration: ${duration}`,
    '---',
    '',
    transcription.trim(),
    '',
  ].join('\n');
}

export function buildFilename(title: string): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // Slugify title: lowercase, replace spaces/special chars with hyphens, max 40 chars
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  return `${datePart}-${timePart}-${slug || 'note'}.md`;
}

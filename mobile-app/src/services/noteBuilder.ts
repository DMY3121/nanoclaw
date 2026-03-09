/**
 * Builds the .md file content and filename for a voice note.
 */
export function buildNote(transcription: string, durationSeconds: number): string {
  const now = new Date();
  const isoDate = now.toISOString();

  // Use first ~60 chars of transcription as title, fallback to timestamp
  const rawTitle = transcription.trim().slice(0, 60);
  const title = rawTitle.length > 0 ? rawTitle.replace(/"/g, "'") : `Voice note ${isoDate}`;

  const mins = Math.floor(durationSeconds / 60);
  const secs = durationSeconds % 60;
  const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return [
    '---',
    `date: ${isoDate}`,
    `title: "${title}"`,
    `duration: ${duration}`,
    `source: voice`,
    '---',
    '',
    transcription.trim(),
    '',
  ].join('\n');
}

export function buildFilename(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `note-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
}

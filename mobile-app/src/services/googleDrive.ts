export interface DriveFolder {
  id: string;
  name: string;
}

/**
 * Lists all non-trashed folders visible to the app.
 */
export async function listFolders(accessToken: string): Promise<DriveFolder[]> {
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.folder' and trashed=false"
  );
  const fields = encodeURIComponent('files(id,name)');

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=name&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 401) throw new AuthExpiredError();
  if (!response.ok) throw new Error(`Drive API ${response.status}`);

  const data = (await response.json()) as { files: DriveFolder[] };
  return data.files ?? [];
}

/**
 * Uploads a markdown file to the specified Drive folder using multipart upload.
 */
export async function uploadFile(
  content: string,
  filename: string,
  accessToken: string,
  folderId: string
): Promise<void> {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (response.status === 401) throw new AuthExpiredError();
  if (!response.ok) {
    const err = await response.text().catch(() => response.status.toString());
    throw new Error(`Upload failed ${response.status}: ${err}`);
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super('Google auth expired — please reconnect.');
    this.name = 'AuthExpiredError';
  }
}

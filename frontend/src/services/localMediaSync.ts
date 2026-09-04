import { getDownloadedFile } from './opfsStorage';

export interface LocalMediaSyncResult {
  available: boolean;
  streamUrl?: string;
  error?: string;
}

/**
 * Ensures a locally downloaded file from browser OPFS is accessible
 * on the backend server for local network streaming (e.g. Google Cast / Smart TVs).
 */
export async function ensureBackendMediaAvailable(fileName: string): Promise<LocalMediaSyncResult> {
  if (!fileName) {
    return { available: false, error: 'No file name provided' };
  }

  try {
    // 1. Check if backend already has this file
    const checkRes = await fetch(`/api/downloads/check/${encodeURIComponent(fileName)}`);
    if (checkRes.ok) {
      const data = await checkRes.json();
      if (data.exists && data.streamUrl) {
        return { available: true, streamUrl: data.streamUrl };
      }
    }

    // 2. Fetch the file handle/blob from local OPFS storage
    const file = await getDownloadedFile(fileName);
    if (!file) {
      return { available: false, error: 'File not found in local OPFS' };
    }

    // 3. Fast stream upload to backend loopback storage
    console.log(`[LocalMediaSync] Uploading "${fileName}" (${(file.size / 1024 / 1024).toFixed(1)} MB) to local backend for Cast streaming...`);
    const uploadRes = await fetch(`/api/downloads/upload-local/${encodeURIComponent(fileName)}`, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload to backend returned HTTP ${uploadRes.status}`);
    }

    const uploadData = await uploadRes.json();
    console.log(`[LocalMediaSync] "${fileName}" is now available at ${uploadData.streamUrl}`);

    return {
      available: true,
      streamUrl: uploadData.streamUrl || `/api/downloads/stream/${fileName}`,
    };
  } catch (err) {
    console.warn(`[LocalMediaSync] Failed to ensure backend media for "${fileName}":`, err);
    return { available: false, error: (err as Error).message };
  }
}

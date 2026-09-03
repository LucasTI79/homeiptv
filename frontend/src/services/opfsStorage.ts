/**
 * Origin Private File System (OPFS) Storage Service
 *
 * Provides persistent, low-overhead file system storage for downloaded video media,
 * isolating multi-gigabyte media streams from browser memory.
 */

const DOWNLOADS_DIR_NAME = 'downloads';

export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

export async function requestStoragePersistence(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (err) {
    console.warn('[OPFS] Storage persistence request failed:', err);
  }
  return false;
}

export async function getDiskStorageEstimate(): Promise<{ usedBytes: number; quotaBytes: number }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usedBytes: estimate.usage || 0,
        quotaBytes: estimate.quota || 0,
      };
    }
  } catch (err) {
    console.warn('[OPFS] Failed to estimate storage quota:', err);
  }
  return { usedBytes: 0, quotaBytes: 0 };
}

export async function getDownloadsDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsSupported()) {
    throw new Error('OPFS is not supported in this environment');
  }
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(DOWNLOADS_DIR_NAME, { create: true });
}

export async function getDownloadedFileHandle(
  fileName: string,
  create = false
): Promise<FileSystemFileHandle | null> {
  try {
    const dir = await getDownloadsDirectory();
    return await dir.getFileHandle(fileName, { create });
  } catch (err) {
    if (!create && (err as { name?: string }).name === 'NotFoundError') {
      return null;
    }
    throw err;
  }
}

export async function getDownloadedFile(fileName: string): Promise<File | null> {
  try {
    const fileHandle = await getDownloadedFileHandle(fileName, false);
    if (!fileHandle) return null;
    return await fileHandle.getFile();
  } catch (err) {
    console.warn(`[OPFS] Error getting file ${fileName}:`, err);
    return null;
  }
}

export async function deleteDownloadedFile(fileName: string): Promise<boolean> {
  try {
    const dir = await getDownloadsDirectory();
    await dir.removeEntry(fileName);
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'NotFoundError') {
      return true; // Already removed
    }
    console.warn(`[OPFS] Error deleting file ${fileName}:`, err);
    return false;
  }
}

export interface OfflineProgressItem {
  id: string;            // Unique identifier for the item (e.g. movie id, or `${seriesId}_s${season}_e${episodeIndex}`)
  seriesId?: string;
  seriesName?: string;
  season?: string;
  episodeIndex?: number;
  episodes?: { name: string; url: string }[];
  nextEpisode?: { url: string; name: string; season: string; episodeIndex: number };
  title: string;
  type: 'movie' | 'series';
  url: string;
  logo?: string;
  currentTime: number;
  duration: number;
  updatedAt: number;     // timestamp in ms
}

export interface SeriesAudioFingerprint {
  id: string; // `${seasonClusterId}_ep${episode}`
  seasonClusterId: string;
  episode: number;
  fingerprints: number[];
  createdAt: number;
}

export interface ContentSegment {
  id: string; // `${seasonClusterId}_${type}`
  seasonClusterId: string;
  type: 'INTRO' | 'CREDITS';
  startSec: number;
  endSec: number;
  confidence: number;
  source: 'audio_match' | 'user_seek' | 'manual';
  updatedAt: number;
}

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadTask {
  id: string;
  mediaType: 'movie' | 'series';
  seriesId?: string;
  seriesName?: string;
  season?: string;
  episodeIndex?: number;
  title: string;
  remoteUrl: string;
  logo?: string;
  totalBytes: number;
  downloadedBytes: number;
  status: DownloadStatus;
  speedBytesPerSec?: number;
  errorMessage?: string;
  createdAt: number;
  completedAt?: number;
  fileName: string;
}

const DB_NAME = 'viniplay_offline_db';
const DB_VERSION = 3;
const STORE_PROGRESS = 'vod_progress';
const STORE_FAVORITES = 'vod_favorites';
const STORE_FINGERPRINTS = 'series_audio_fingerprints';
const STORE_SEGMENTS = 'content_segments';
const STORE_DOWNLOAD_TASKS = 'download_tasks';
const MIGRATION_FLAG_KEY = 'viniplay_idb_migrated_v1';

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Store for VOD Progress (Continue Watching)
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        const progressStore = db.createObjectStore(STORE_PROGRESS, { keyPath: 'id' });
        progressStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
        progressStore.createIndex('by_seriesId', 'seriesId', { unique: false });
      }

      // 2. Store for VOD Favorites
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        db.createObjectStore(STORE_FAVORITES, { keyPath: 'id' });
      }

      // 3. Store for Series Audio Fingerprints
      if (!db.objectStoreNames.contains(STORE_FINGERPRINTS)) {
        const fpStore = db.createObjectStore(STORE_FINGERPRINTS, { keyPath: 'id' });
        fpStore.createIndex('by_seasonClusterId', 'seasonClusterId', { unique: false });
      }

      // 4. Store for Detected Content Segments (Intros, Credits)
      if (!db.objectStoreNames.contains(STORE_SEGMENTS)) {
        const segStore = db.createObjectStore(STORE_SEGMENTS, { keyPath: 'id' });
        segStore.createIndex('by_seasonClusterId', 'seasonClusterId', { unique: false });
      }

      // 5. Store for Download Tasks (Offline Media Queue & Status)
      if (!db.objectStoreNames.contains(STORE_DOWNLOAD_TASKS)) {
        const dtStore = db.createObjectStore(STORE_DOWNLOAD_TASKS, { keyPath: 'id' });
        dtStore.createIndex('by_status', 'status', { unique: false });
        dtStore.createIndex('by_seriesId', 'seriesId', { unique: false });
        dtStore.createIndex('by_createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbPromise = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

export async function getProgressList(): Promise<OfflineProgressItem[]> {
  try {
    const db = await openDb();
    return await new Promise<OfflineProgressItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readonly');
      const store = tx.objectStore(STORE_PROGRESS);
      const index = store.index('by_updatedAt');
      const request = index.openCursor(null, 'prev'); // Ordered by updatedAt descending
      const results: OfflineProgressItem[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to retrieve progress list from IndexedDB'));
      };
    });
  } catch (err) {
    console.warn('[IndexedDB] getProgressList error:', err);
    return [];
  }
}

export async function saveProgress(item: OfflineProgressItem): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      const store = tx.objectStore(STORE_PROGRESS);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to save progress to IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] saveProgress error:', err);
  }
}

export async function removeProgress(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      const store = tx.objectStore(STORE_PROGRESS);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to delete progress from IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] removeProgress error:', err);
  }
}

export async function clearProgress(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      const store = tx.objectStore(STORE_PROGRESS);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to clear progress in IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] clearProgress error:', err);
  }
}

export async function getFavorites(): Promise<string[]> {
  try {
    const db = await openDb();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_FAVORITES, 'readonly');
      const store = tx.objectStore(STORE_FAVORITES);
      const request = store.getAll();

      request.onsuccess = () => {
        const records: { id: string }[] = request.result || [];
        resolve(records.map((r) => r.id));
      };

      request.onerror = () => reject(request.error || new Error('Failed to get favorites from IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] getFavorites error:', err);
    return [];
  }
}

export async function saveFavorite(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FAVORITES, 'readwrite');
      const store = tx.objectStore(STORE_FAVORITES);
      const request = store.put({ id });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to save favorite to IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] saveFavorite error:', err);
  }
}

export async function removeFavorite(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FAVORITES, 'readwrite');
      const store = tx.objectStore(STORE_FAVORITES);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to remove favorite from IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] removeFavorite error:', err);
  }
}

/**
 * Migrates existing data from localStorage to IndexedDB once, ensuring seamless
 * backward compatibility without losing existing progress or favorites.
 */
export async function migrateFromLocalStorage(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (localStorage.getItem(MIGRATION_FLAG_KEY)) return;

    // Migrate Progress
    const rawProgress = localStorage.getItem('viniplay_vod_progress');
    if (rawProgress) {
      try {
        const parsed = JSON.parse(rawProgress) as Record<string, OfflineProgressItem>;
        for (const item of Object.values(parsed)) {
          if (item && item.id) {
            await saveProgress(item);
          }
        }
      } catch (e) {
        console.warn('Failed to parse legacy localStorage progress', e);
      }
    }

    // Migrate Favorites
    const rawFavorites = localStorage.getItem('viniplay_vod_favorites');
    if (rawFavorites) {
      try {
        const parsedFavs = JSON.parse(rawFavorites) as string[];
        if (Array.isArray(parsedFavs)) {
          for (const favId of parsedFavs) {
            if (favId) {
              await saveFavorite(favId);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to parse legacy localStorage favorites', e);
      }
    }

    localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
  } catch (err) {
    console.warn('[IndexedDB] Migration from localStorage error:', err);
  }
}

export async function saveSeriesFingerprint(record: SeriesAudioFingerprint): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FINGERPRINTS, 'readwrite');
      const store = tx.objectStore(STORE_FINGERPRINTS);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to save audio fingerprint'));
    });
  } catch (err) {
    console.warn('[IndexedDB] saveSeriesFingerprint error:', err);
  }
}

export async function getSeriesFingerprints(seasonClusterId: string): Promise<SeriesAudioFingerprint[]> {
  try {
    const db = await openDb();
    return await new Promise<SeriesAudioFingerprint[]>((resolve, reject) => {
      const tx = db.transaction(STORE_FINGERPRINTS, 'readonly');
      const store = tx.objectStore(STORE_FINGERPRINTS);
      const index = store.index('by_seasonClusterId');
      const request = index.getAll(seasonClusterId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Failed to get series fingerprints'));
    });
  } catch (err) {
    console.warn('[IndexedDB] getSeriesFingerprints error:', err);
    return [];
  }
}

export async function saveContentSegment(segment: ContentSegment): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SEGMENTS, 'readwrite');
      const store = tx.objectStore(STORE_SEGMENTS);
      const request = store.put(segment);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to save content segment'));
    });
  } catch (err) {
    console.warn('[IndexedDB] saveContentSegment error:', err);
  }
}

export async function getContentSegment(
  seasonClusterId: string,
  type: 'INTRO' | 'CREDITS' = 'INTRO'
): Promise<ContentSegment | null> {
  try {
    const db = await openDb();
    return await new Promise<ContentSegment | null>((resolve, reject) => {
      const tx = db.transaction(STORE_SEGMENTS, 'readonly');
      const store = tx.objectStore(STORE_SEGMENTS);
      const id = `${seasonClusterId}_${type}`;
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Failed to get content segment'));
    });
  } catch (err) {
    console.warn('[IndexedDB] getContentSegment error:', err);
    return null;
  }
}

export async function getDownloadTasks(): Promise<DownloadTask[]> {
  try {
    const db = await openDb();
    return await new Promise<DownloadTask[]>((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOAD_TASKS, 'readonly');
      const store = tx.objectStore(STORE_DOWNLOAD_TASKS);
      const index = store.index('by_createdAt');
      const request = index.openCursor(null, 'prev'); // Ordered by createdAt descending
      const results: DownloadTask[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to retrieve download tasks from IndexedDB'));
      };
    });
  } catch (err) {
    console.warn('[IndexedDB] getDownloadTasks error:', err);
    return [];
  }
}

export async function getDownloadTask(id: string): Promise<DownloadTask | null> {
  try {
    const db = await openDb();
    return await new Promise<DownloadTask | null>((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOAD_TASKS, 'readonly');
      const store = tx.objectStore(STORE_DOWNLOAD_TASKS);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Failed to get download task from IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] getDownloadTask error:', err);
    return null;
  }
}

export async function saveDownloadTask(task: DownloadTask): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOAD_TASKS, 'readwrite');
      const store = tx.objectStore(STORE_DOWNLOAD_TASKS);
      store.put(task);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to save download task to IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] saveDownloadTask error:', err);
  }
}

export async function removeDownloadTask(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOAD_TASKS, 'readwrite');
      const store = tx.objectStore(STORE_DOWNLOAD_TASKS);
      store.delete(id);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to delete download task from IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] removeDownloadTask error:', err);
  }
}

export async function clearDownloadTasks(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOAD_TASKS, 'readwrite');
      const store = tx.objectStore(STORE_DOWNLOAD_TASKS);
      store.clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear download tasks in IndexedDB'));
    });
  } catch (err) {
    console.warn('[IndexedDB] clearDownloadTasks error:', err);
  }
}


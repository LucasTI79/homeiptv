import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDownloadStore } from './downloadStore';
import { openDb } from '../services/db';

vi.mock('../services/opfsStorage', () => ({
  isOpfsSupported: vi.fn(() => true),
  requestStoragePersistence: vi.fn(() => Promise.resolve(true)),
  getDiskStorageEstimate: vi.fn(() => Promise.resolve({ usedBytes: 2000, quotaBytes: 5000000000 })),
  getDownloadedFileHandle: vi.fn(() =>
    Promise.resolve({
      createWritable: vi.fn(() =>
        Promise.resolve({
          seek: vi.fn(() => Promise.resolve()),
          write: vi.fn(() => Promise.resolve()),
          close: vi.fn(() => Promise.resolve()),
        })
      ),
    })
  ),
  deleteDownloadedFile: vi.fn(() => Promise.resolve(true)),
  getDownloadedFile: vi.fn(() => Promise.resolve(null)),
}));

describe('useDownloadStore', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await openDb();
    const tx = db.transaction('download_tasks', 'readwrite');
    tx.objectStore('download_tasks').clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            },
          }),
          { status: 200 }
        )
      )
    );
  });

  it('initializes and hydrates tasks from IndexedDB', async () => {
    const store = useDownloadStore.getState();
    await store.initDownloads();

    expect(useDownloadStore.getState().isInitialized).toBe(true);
    expect(useDownloadStore.getState().storageUsage.quotaBytes).toBe(5000000000);
  });

  it('correctly tracks isDownloaded and isDownloadingOrQueued statuses', async () => {
    const store = useDownloadStore.getState();
    await store.initDownloads();

    expect(store.isDownloaded('movie_test')).toBe(false);

    // Enqueue a movie
    await store.enqueueMovie({
      id: 'test',
      title: 'Movie Test',
      url: 'http://test.stream/m.mp4',
    });

    const isQueuedOrDownloading = useDownloadStore.getState().isDownloadingOrQueued('movie_test');
    expect(isQueuedOrDownloading).toBe(true);
  });
});

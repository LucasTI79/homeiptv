import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, getDownloadTasks, clearDownloadTasks } from './db';
import { DownloadManager } from './downloadManager';

// Mock opfsStorage
vi.mock('./opfsStorage', () => {
  return {
    isOpfsSupported: vi.fn(() => true),
    requestStoragePersistence: vi.fn(() => Promise.resolve(true)),
    getDiskStorageEstimate: vi.fn(() => Promise.resolve({ usedBytes: 1000, quotaBytes: 1000000000 })),
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
  };
});

describe('DownloadManager', () => {
  beforeEach(async () => {
    localStorage.clear();
    await DownloadManager.getInstance().cancelAll();
    await clearDownloadTasks();

    // Mock fetch to simulate streaming chunks
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4]));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'content-length': '4' },
          }
        )
      )
    );
  });

  it('enqueues a movie and persists it to IndexedDB', async () => {
    const manager = DownloadManager.getInstance();
    const task = await manager.enqueueMovie({
      id: '99',
      title: 'Dune Part Two',
      url: 'http://stream.test/dune2.mp4',
      logo: 'http://stream.test/dune2.jpg',
    });

    expect(task.id).toBe('movie_99');
    expect(task.mediaType).toBe('movie');
    expect(task.title).toBe('Dune Part Two');
    expect(task.fileName).toBe('movie_99.mp4');

    const tasks = await getDownloadTasks();
    expect(tasks.some((t) => t.id === 'movie_99')).toBe(true);
  });

  it('enqueues an entire season of series episodes in order', async () => {
    const manager = DownloadManager.getInstance();
    const episodes = [
      { name: 'Episode 1', url: 'http://stream.test/e1.mp4' },
      { name: 'Episode 2', url: 'http://stream.test/e2.mp4' },
    ];

    const tasks = await manager.enqueueSeason(
      { id: 'series_10', name: 'Stranger Things', logo: 'http://stream.test/st.jpg' },
      '1',
      episodes
    );

    expect(tasks.length).toBe(2);
    expect(tasks[0].id).toBe('series_10_s1_e0');
    expect(tasks[0].episodeIndex).toBe(0);
    expect(tasks[1].id).toBe('series_10_s1_e1');
    expect(tasks[1].episodeIndex).toBe(1);

    const stored = await getDownloadTasks();
    expect(stored.length).toBe(2);
  });

  it('pauses and resumes a task', async () => {
    const manager = DownloadManager.getInstance();
    const task = await manager.enqueueMovie({
      id: 'movie_pause_test',
      title: 'Matrix',
      url: 'http://stream.test/matrix.mp4',
    });

    await manager.pauseDownload(task.id);
    let currentTask = await manager.getTask(task.id);
    expect(currentTask?.status).toBe('paused');

    await manager.resumeDownload(task.id);
    currentTask = await manager.getTask(task.id);
    expect(currentTask?.status).toBe('queued');
  });

  it('cancels and deletes a download task', async () => {
    const manager = DownloadManager.getInstance();
    const task = await manager.enqueueMovie({
      id: 'movie_cancel_test',
      title: 'Avatar',
      url: 'http://stream.test/avatar.mp4',
    });

    await manager.cancelDownload(task.id);
    const currentTask = await manager.getTask(task.id);
    expect(currentTask).toBeNull();
  });
});

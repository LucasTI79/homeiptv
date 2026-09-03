/**
 * DownloadManager
 *
 * Coordinates concurrent video downloads directly to the Origin Private File System (OPFS),
 * managing download queues, Range request resumption, throttled progress updates,
 * and IndexedDB task persistence.
 */

import {
  getDownloadTasks,
  getDownloadTask,
  saveDownloadTask,
  removeDownloadTask,
  type DownloadTask,
} from './db';
import {
  isOpfsSupported,
  getDownloadedFileHandle,
  deleteDownloadedFile,
  getDiskStorageEstimate,
  requestStoragePersistence,
} from './opfsStorage';

export type DownloadListener = (task: DownloadTask) => void;

const STORAGE_KEY_CONCURRENCY = 'viniplay_max_download_concurrency';

function loadSavedConcurrency(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_CONCURRENCY) : null;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
        return parsed;
      }
    }
  } catch {}
  return 2;
}

export class DownloadManager {
  private static instance: DownloadManager | null = null;

  private maxConcurrency = loadSavedConcurrency();
  private activeTasks = new Set<string>();
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<DownloadListener>();
  private isProcessing = false;

  private constructor() {
    // Attempt to request persistent storage
    requestStoragePersistence().catch(() => {});
    // Recover any tasks that were downloading when previous session closed
    this.recoverInterruptedTasks().catch((err) => {
      console.warn('[DownloadManager] Failed to recover interrupted tasks:', err);
    });
  }

  public static getInstance(): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager();
    }
    return DownloadManager.instance;
  }

  public getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  public setMaxConcurrency(concurrency: number): void {
    const clamped = Math.max(1, Math.min(5, Math.floor(concurrency)));
    this.maxConcurrency = clamped;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_CONCURRENCY, String(clamped));
      }
    } catch {}
    this.processQueue().catch(() => {});
  }

  public subscribe(listener: DownloadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(task: DownloadTask): void {
    for (const listener of this.listeners) {
      try {
        listener(task);
      } catch (err) {
        console.error('[DownloadManager] Listener error:', err);
      }
    }
  }

  private async recoverInterruptedTasks(): Promise<void> {
    const tasks = await getDownloadTasks();
    for (const task of tasks) {
      if (task.status === 'downloading') {
        task.status = 'paused';
        task.errorMessage = 'Download interrupted';
        await saveDownloadTask(task);
        this.notify(task);
      }
    }
  }

  public async getTask(id: string): Promise<DownloadTask | null> {
    return await getDownloadTask(id);
  }

  public async getAllTasks(): Promise<DownloadTask[]> {
    return await getDownloadTasks();
  }

  public async enqueueMovie(movie: {
    id: string;
    title: string;
    url: string;
    logo?: string;
  }): Promise<DownloadTask> {
    const taskId = movie.id.startsWith('movie_') ? movie.id : `movie_${movie.id}`;
    const existing = await getDownloadTask(taskId);
    if (existing && (existing.status === 'downloading' || existing.status === 'completed')) {
      return existing;
    }

    const task: DownloadTask = {
      id: taskId,
      mediaType: 'movie',
      title: movie.title,
      remoteUrl: movie.url,
      logo: movie.logo,
      totalBytes: 0,
      downloadedBytes: existing ? existing.downloadedBytes : 0,
      status: 'queued',
      createdAt: Date.now(),
      fileName: `${taskId}.mp4`,
    };

    await saveDownloadTask(task);
    this.notify(task);
    this.processQueue().catch((err) => console.warn('[DownloadManager] Queue error:', err));
    return task;
  }

  public async enqueueEpisode(episode: {
    seriesId: string;
    seriesName: string;
    season: string;
    episodeIndex: number;
    title: string;
    url: string;
    logo?: string;
  }): Promise<DownloadTask> {
    const taskId = `${episode.seriesId}_s${episode.season}_e${episode.episodeIndex}`;
    const existing = await getDownloadTask(taskId);
    if (existing && (existing.status === 'downloading' || existing.status === 'completed')) {
      return existing;
    }

    const task: DownloadTask = {
      id: taskId,
      mediaType: 'series',
      seriesId: episode.seriesId,
      seriesName: episode.seriesName,
      season: episode.season,
      episodeIndex: episode.episodeIndex,
      title: episode.title,
      remoteUrl: episode.url,
      logo: episode.logo,
      totalBytes: 0,
      downloadedBytes: existing ? existing.downloadedBytes : 0,
      status: 'queued',
      createdAt: Date.now(),
      fileName: `series_${taskId}.mp4`,
    };

    await saveDownloadTask(task);
    this.notify(task);
    this.processQueue().catch((err) => console.warn('[DownloadManager] Queue error:', err));
    return task;
  }

  public async enqueueSeason(
    series: { id: string; name: string; logo?: string },
    season: string,
    episodes: { name: string; url: string }[]
  ): Promise<DownloadTask[]> {
    const enqueued: DownloadTask[] = [];

    for (let index = 0; index < episodes.length; index++) {
      const ep = episodes[index];
      const task = await this.enqueueEpisode({
        seriesId: series.id,
        seriesName: series.name,
        season,
        episodeIndex: index,
        title: ep.name || `Episódio ${index + 1}`,
        url: ep.url,
        logo: series.logo,
      });
      enqueued.push(task);
    }

    return enqueued;
  }

  public async pauseDownload(id: string): Promise<void> {
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }
    this.activeTasks.delete(id);

    const task = await getDownloadTask(id);
    if (task && task.status !== 'completed') {
      task.status = 'paused';
      task.speedBytesPerSec = 0;
      await saveDownloadTask(task);
      this.notify(task);
    }

    this.processQueue().catch(() => {});
  }

  public async resumeDownload(id: string): Promise<void> {
    const task = await getDownloadTask(id);
    if (task && task.status !== 'completed' && task.status !== 'downloading') {
      task.status = 'queued';
      task.errorMessage = undefined;
      await saveDownloadTask(task);
      this.notify(task);
      this.processQueue().catch(() => {});
    }
  }

  public async cancelDownload(id: string): Promise<void> {
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }
    this.activeTasks.delete(id);

    const task = await getDownloadTask(id);
    if (task) {
      await deleteDownloadedFile(task.fileName);
      await removeDownloadTask(id);
      this.notify({ ...task, status: 'error', errorMessage: 'Download cancelled' });
    }

    this.processQueue().catch(() => {});
  }

  public async cancelAll(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.activeTasks.clear();
    await new Promise((r) => setTimeout(r, 20));
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      if (!isOpfsSupported()) {
        console.warn('[DownloadManager] OPFS not supported; cannot process queue');
        return;
      }

      while (this.activeTasks.size < this.maxConcurrency) {
        const tasks = await getDownloadTasks();
        const nextTask = tasks
          .filter((t) => t.status === 'queued')
          .sort((a, b) => a.createdAt - b.createdAt)[0];

        if (!nextTask) break;

        this.startDownload(nextTask);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async startDownload(task: DownloadTask): Promise<void> {
    // Verify task is still queued before starting
    const fresh = await getDownloadTask(task.id);
    if (!fresh || fresh.status !== 'queued') {
      return;
    }

    this.activeTasks.add(task.id);
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);

    task.status = 'downloading';
    task.errorMessage = undefined;
    await saveDownloadTask(task);
    this.notify(task);

    // Pre-flight check on disk quota
    const { usedBytes, quotaBytes } = await getDiskStorageEstimate();
    const freeBytes = quotaBytes > 0 ? quotaBytes - usedBytes : Number.MAX_SAFE_INTEGER;
    if (freeBytes < 200 * 1024 * 1024) {
      // Less than 200MB free
      task.status = 'error';
      task.errorMessage = 'Armazenamento insuficiente no dispositivo';
      this.activeTasks.delete(task.id);
      this.abortControllers.delete(task.id);
      await saveDownloadTask(task);
      this.notify(task);
      return;
    }

    const proxyUrl = `/api/media-proxy?url=${encodeURIComponent(task.remoteUrl)}`;

    try {
      const headers: Record<string, string> = {};
      if (task.downloadedBytes > 0) {
        headers['Range'] = `bytes=${task.downloadedBytes}-`;
      }

      const response = await fetch(proxyUrl, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Servidor de mídia retornou HTTP ${response.status}`);
      }

      // Compute total bytes
      const contentLengthHeader = response.headers.get('content-length');
      const contentRangeHeader = response.headers.get('content-range');

      if (contentRangeHeader) {
        // e.g. "bytes 1000-5000/10000"
        const match = contentRangeHeader.match(/\/(\d+)/);
        if (match) {
          task.totalBytes = parseInt(match[1], 10);
        }
      } else if (contentLengthHeader) {
        const length = parseInt(contentLengthHeader, 10);
        if (!isNaN(length)) {
          task.totalBytes = task.downloadedBytes + length;
        }
      }

      const fileHandle = await getDownloadedFileHandle(task.fileName, true);
      if (!fileHandle) {
        throw new Error('Falha ao criar arquivo de mídia no OPFS');
      }

      const writable = await fileHandle.createWritable({ keepExistingData: true });
      if (task.downloadedBytes > 0) {
        await writable.seek(task.downloadedBytes);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        await writable.close();
        throw new Error('Stream de download não disponível na resposta');
      }

      let lastSavedTime = Date.now();
      let lastBytes = task.downloadedBytes;

      while (true) {
        if (controller.signal.aborted) return;
        const { done, value } = await reader.read();
        if (done || controller.signal.aborted) break;

        if (value && value.byteLength > 0) {
          await writable.write(value);
          task.downloadedBytes += value.byteLength;

          const now = Date.now();
          const elapsedSec = (now - lastSavedTime) / 1000;
          if (elapsedSec >= 0.5) {
            const bytesDelta = task.downloadedBytes - lastBytes;
            task.speedBytesPerSec = Math.round(bytesDelta / elapsedSec);
            lastSavedTime = now;
            lastBytes = task.downloadedBytes;

            if (controller.signal.aborted) return;
            await saveDownloadTask(task);
            this.notify(task);
          }
        }
      }

      await writable.close();

      if (controller.signal.aborted) {
        return;
      }

      task.status = 'completed';
      task.speedBytesPerSec = 0;
      task.completedAt = Date.now();
      if (task.totalBytes === 0) {
        task.totalBytes = task.downloadedBytes;
      }
      await saveDownloadTask(task);
      this.notify(task);
    } catch (err) {
      if (controller.signal.aborted || (err as { name?: string }).name === 'AbortError') {
        // Paused or cancelled intentionally
        return;
      }

      console.error(`[DownloadManager] Download failed for ${task.id}:`, err);
      task.status = 'error';
      task.errorMessage = (err as Error).message || 'Erro durante o download';
      task.speedBytesPerSec = 0;
      await saveDownloadTask(task);
      this.notify(task);
    } finally {
      this.activeTasks.delete(task.id);
      this.abortControllers.delete(task.id);
      if (!controller.signal.aborted) {
        this.processQueue().catch(() => {});
      }
    }
  }
}

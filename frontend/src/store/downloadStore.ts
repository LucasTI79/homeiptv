import { create } from 'zustand';
import { toast } from 'react-hot-toast';
import {
  getDownloadTasks,
  type DownloadTask,
} from '../services/db';
import { DownloadManager } from '../services/downloadManager';
import { getDiskStorageEstimate } from '../services/opfsStorage';

export interface DownloadStoreState {
  tasks: Record<string, DownloadTask>;
  isInitialized: boolean;
  storageUsage: { usedBytes: number; quotaBytes: number };
  maxConcurrency: number;

  // Actions
  initDownloads: () => Promise<void>;
  refreshStorage: () => Promise<void>;
  setMaxConcurrency: (n: number) => void;
  getTask: (id: string) => DownloadTask | undefined;
  isDownloaded: (id: string) => boolean;
  isDownloadingOrQueued: (id: string) => boolean;
  enqueueMovie: (movie: { id: string; title: string; url: string; logo?: string }) => Promise<DownloadTask>;
  enqueueEpisode: (episode: {
    seriesId: string;
    seriesName: string;
    season: string;
    episodeIndex: number;
    title: string;
    url: string;
    logo?: string;
  }) => Promise<DownloadTask>;
  enqueueSeason: (
    series: { id: string; name: string; logo?: string },
    season: string,
    episodes: { name: string; url: string }[]
  ) => Promise<DownloadTask[]>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
}

function requestNotificationPermission(): void {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => {
  const manager = DownloadManager.getInstance();

  // Wire DownloadManager listener to keep Zustand store reactively in sync
  manager.subscribe((updatedTask) => {
    const prevTask = get().tasks[updatedTask.id];
    const prevStatus = prevTask?.status;

    set((state) => {
      // If task was cancelled / deleted
      if (updatedTask.status === 'error' && updatedTask.errorMessage === 'Download cancelled') {
        const next = { ...state.tasks };
        delete next[updatedTask.id];
        return { tasks: next };
      }
      return {
        tasks: {
          ...state.tasks,
          [updatedTask.id]: updatedTask,
        },
      };
    });

    // Notify user on completion
    if (prevStatus === 'downloading' && updatedTask.status === 'completed') {
      toast.success(`Download concluído: "${updatedTask.title}" já está disponível offline!`, {
        duration: 5000,
        id: `download_done_${updatedTask.id}`,
      });

      // Trigger Web Notification if allowed
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Download Concluído - ViniPlay', {
            body: `"${updatedTask.title}" foi salvo e pode ser assistido sem internet!`,
            icon: updatedTask.logo || undefined,
          });
        } catch {
          // ignore notification errors
        }
      }
    } else if (prevStatus === 'downloading' && updatedTask.status === 'error') {
      toast.error(`Falha no download de "${updatedTask.title}": ${updatedTask.errorMessage || 'Erro inesperado'}`, {
        duration: 6000,
        id: `download_err_${updatedTask.id}`,
      });
    }

    // Refresh storage on complete or cancel
    if (updatedTask.status === 'completed' || updatedTask.status === 'error') {
      get().refreshStorage().catch(() => {});
    }
  });

  return {
    tasks: {},
    isInitialized: false,
    storageUsage: { usedBytes: 0, quotaBytes: 0 },
    maxConcurrency: manager.getMaxConcurrency(),

    setMaxConcurrency: (n: number) => {
      manager.setMaxConcurrency(n);
      set({ maxConcurrency: manager.getMaxConcurrency() });
    },

    initDownloads: async () => {
      try {
        const tasks = await getDownloadTasks();
        const map: Record<string, DownloadTask> = {};
        for (const task of tasks) {
          map[task.id] = task;
        }

        const estimate = await getDiskStorageEstimate();

        set({
          tasks: map,
          isInitialized: true,
          storageUsage: estimate,
          maxConcurrency: manager.getMaxConcurrency(),
        });
      } catch (err) {
        console.warn('[downloadStore] Initialization error:', err);
      }
    },

    refreshStorage: async () => {
      try {
        const estimate = await getDiskStorageEstimate();
        set({ storageUsage: estimate });
      } catch (err) {
        console.warn('[downloadStore] Storage refresh error:', err);
      }
    },

    getTask: (id: string) => {
      return get().tasks[id];
    },

    isDownloaded: (id: string) => {
      const task = get().tasks[id];
      return task ? task.status === 'completed' : false;
    },

    isDownloadingOrQueued: (id: string) => {
      const task = get().tasks[id];
      return task ? task.status === 'downloading' || task.status === 'queued' || task.status === 'retrying' : false;
    },

    enqueueMovie: async (movie) => {
      requestNotificationPermission();
      const task = await manager.enqueueMovie(movie);
      set((state) => ({
        tasks: { ...state.tasks, [task.id]: task },
      }));
      return task;
    },

    enqueueEpisode: async (episode) => {
      requestNotificationPermission();
      const task = await manager.enqueueEpisode(episode);
      set((state) => ({
        tasks: { ...state.tasks, [task.id]: task },
      }));
      return task;
    },

    enqueueSeason: async (series, season, episodes) => {
      requestNotificationPermission();
      const tasks = await manager.enqueueSeason(series, season, episodes);
      set((state) => {
        const next = { ...state.tasks };
        for (const t of tasks) {
          next[t.id] = t;
        }
        return { tasks: next };
      });
      return tasks;
    },

    pauseDownload: async (id: string) => {
      await manager.pauseDownload(id);
    },

    resumeDownload: async (id: string) => {
      await manager.resumeDownload(id);
    },

    cancelDownload: async (id: string) => {
      await manager.cancelDownload(id);
      set((state) => {
        const next = { ...state.tasks };
        delete next[id];
        return { tasks: next };
      });
      get().refreshStorage().catch(() => {});
    },
  };
});

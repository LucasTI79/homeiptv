import { create } from 'zustand';
import * as db from '../services/db';
import { PLAYBACK_CONFIG } from '../constants';

export interface VodProgressItem {
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

interface PlaybackState {
  progress: Record<string, VodProgressItem>;
  watchedMap: Record<string, db.WatchedEpisodeRecord>;
  favorites: string[];   // Vod item IDs
  isHydrated: boolean;
  
  // Actions
  init: () => Promise<void>;
  saveProgress: (item: Omit<VodProgressItem, 'updatedAt'>) => void;
  removeProgress: (id: string) => void;
  clearProgress: () => void;
  setProgressMap: (map: Record<string, VodProgressItem>) => void;

  toggleFavorite: (id: string) => void;
  setFavorites: (favorites: string[]) => void;
  isFavorite: (id: string) => boolean;

  // Watched History Actions
  markEpisodeWatched: (record: Omit<db.WatchedEpisodeRecord, 'watchedAt'>) => Promise<void>;
  unmarkEpisodeWatched: (id: string) => Promise<void>;
  markSeasonWatched: (
    series: { id: string; name: string },
    season: string,
    episodes: Array<{ name: string; url: string }>
  ) => Promise<void>;
  unmarkSeasonWatched: (
    seriesId: string,
    season: string,
    episodes: Array<{ name: string; url: string }>
  ) => Promise<void>;
  isWatched: (id: string) => boolean;
  getSeriesWatchedCount: (seriesId: string) => number;

  // In-Progress Cleanup Actions
  clearSeriesProgress: (seriesId: string) => Promise<void>;
  clearAllProgress: () => Promise<void>;
}

const {
  completionThreshold: VOD_COMPLETION_THRESHOLD,
  storageKeys: { progress: STORAGE_KEY_PROGRESS, favorites: STORAGE_KEY_FAVORITES }
} = PLAYBACK_CONFIG;

function loadInitialProgress(): Record<string, VodProgressItem> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = localStorage.getItem(STORAGE_KEY_PROGRESS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadInitialFavorites(): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = localStorage.getItem(STORAGE_KEY_FAVORITES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  progress: loadInitialProgress(),
  watchedMap: {},
  favorites: loadInitialFavorites(),
  isHydrated: false,

  init: async () => {
    try {
      await db.migrateFromLocalStorage();
      const [dbProgressList, dbFavorites, dbWatchedList] = await Promise.all([
        db.getProgressList(),
        db.getFavorites(),
        db.getWatchedEpisodes(),
      ]);

      const progressMap: Record<string, VodProgressItem> = {};
      for (const item of dbProgressList) {
        progressMap[item.id] = item;
      }

      // Merge with any cached localStorage items in case migration was partial
      const localProg = loadInitialProgress();
      for (const [k, v] of Object.entries(localProg)) {
        if (!progressMap[k]) {
          progressMap[k] = v;
        }
      }

      const favSet = new Set([...dbFavorites, ...loadInitialFavorites()]);
      const finalFavs = Array.from(favSet);

      const watchedMap: Record<string, db.WatchedEpisodeRecord> = {};
      for (const w of dbWatchedList) {
        watchedMap[w.id] = w;
      }

      set({
        progress: progressMap,
        favorites: finalFavs,
        watchedMap,
        isHydrated: true,
      });

      // Keep localStorage synchronized as synchronous fallback cache
      try {
        localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progressMap));
        localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(finalFavs));
      } catch {}
    } catch (err) {
      console.warn('[playbackStore] Failed to hydrate from IndexedDB', err);
      set({ isHydrated: true });
    }
  },

  saveProgress: (item) => {
    // If progress is >= threshold, we consider the current episode/movie finished
    const isFinished = item.duration > 0 && (item.currentTime / item.duration) >= VOD_COMPLETION_THRESHOLD;
    const updatedAt = Date.now();

    // Check if this is a series and whether a subsequent episode exists
    let nextSeriesEpisode = item.nextEpisode;
    if (isFinished && item.type === 'series' && !nextSeriesEpisode && item.episodes && item.episodeIndex !== undefined) {
      const nextIdx = item.episodeIndex + 1;
      if (nextIdx < item.episodes.length) {
        const nextEp = item.episodes[nextIdx];
        nextSeriesEpisode = {
          url: nextEp.url,
          name: `${item.seriesName || item.title} - ${nextEp.name || `Ep ${nextIdx + 1}`}`,
          season: item.season || '1',
          episodeIndex: nextIdx,
        };
      }
    }
    
    set((state) => {
      const nextProgress = { ...state.progress };
      if (isFinished) {
        delete nextProgress[item.id];

        // If it's a series and there is a next episode, keep the series in Continue Watching!
        if (item.type === 'series' && nextSeriesEpisode) {
          const nextId = `${item.seriesId || 'series'}_s${nextSeriesEpisode.season}_e${nextSeriesEpisode.episodeIndex}`;
          
          let subsequentEp = undefined;
          if (item.episodes && nextSeriesEpisode.episodeIndex + 1 < item.episodes.length) {
            const subIdx = nextSeriesEpisode.episodeIndex + 1;
            const sub = item.episodes[subIdx];
            subsequentEp = {
              url: sub.url,
              name: `${item.seriesName || item.title} - ${sub.name || `Ep ${subIdx + 1}`}`,
              season: nextSeriesEpisode.season,
              episodeIndex: subIdx,
            };
          }

          nextProgress[nextId] = {
            id: nextId,
            seriesId: item.seriesId,
            seriesName: item.seriesName,
            season: nextSeriesEpisode.season,
            episodeIndex: nextSeriesEpisode.episodeIndex,
            episodes: item.episodes,
            nextEpisode: subsequentEp,
            title: nextSeriesEpisode.name,
            type: 'series',
            url: nextSeriesEpisode.url,
            logo: item.logo,
            currentTime: 0,
            duration: 0,
            updatedAt,
          };
        }
      } else {
        nextProgress[item.id] = {
          ...item,
          updatedAt,
        };
      }
      try {
        localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(nextProgress));
      } catch (e) {
        console.warn('Failed to save progress to localStorage', e);
      }
      return { progress: nextProgress };
    });

    if (isFinished) {
      const watchedRecord: db.WatchedEpisodeRecord = {
        id: item.id,
        seriesId: item.seriesId,
        seriesName: item.seriesName,
        season: item.season,
        episodeIndex: item.episodeIndex,
        title: item.title,
        mediaType: item.type,
        watchedAt: updatedAt,
        autoMarked: true,
      };

      set((state) => ({
        watchedMap: {
          ...state.watchedMap,
          [item.id]: watchedRecord,
        },
      }));

      db.saveWatchedEpisode(watchedRecord).catch((err) => {
        console.warn('[playbackStore] Failed to save watched episode:', err);
      });

      db.removeProgress(item.id);

      // Persist the next episode in IndexedDB if available
      if (item.type === 'series' && nextSeriesEpisode) {
        const nextId = `${item.seriesId || 'series'}_s${nextSeriesEpisode.season}_e${nextSeriesEpisode.episodeIndex}`;
        
        let subsequentEp = undefined;
        if (item.episodes && nextSeriesEpisode.episodeIndex + 1 < item.episodes.length) {
          const subIdx = nextSeriesEpisode.episodeIndex + 1;
          const sub = item.episodes[subIdx];
          subsequentEp = {
            url: sub.url,
            name: `${item.seriesName || item.title} - ${sub.name || `Ep ${subIdx + 1}`}`,
            season: nextSeriesEpisode.season,
            episodeIndex: subIdx,
          };
        }

        db.saveProgress({
          id: nextId,
          seriesId: item.seriesId,
          seriesName: item.seriesName,
          season: nextSeriesEpisode.season,
          episodeIndex: nextSeriesEpisode.episodeIndex,
          episodes: item.episodes,
          nextEpisode: subsequentEp,
          title: nextSeriesEpisode.name,
          type: 'series',
          url: nextSeriesEpisode.url,
          logo: item.logo,
          currentTime: 0,
          duration: 0,
          updatedAt,
        });
      }
    } else {
      db.saveProgress({
        ...item,
        updatedAt,
      });
    }
  },

  removeProgress: (id) => {
    set((state) => {
      const nextProgress = { ...state.progress };
      delete nextProgress[id];
      try {
        localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(nextProgress));
      } catch (e) {
        console.warn('Failed to remove progress from localStorage', e);
      }
      return { progress: nextProgress };
    });
    db.removeProgress(id);
  },

  clearProgress: () => {
    try {
      localStorage.removeItem(STORAGE_KEY_PROGRESS);
    } catch {}
    set({ progress: {} });
    db.clearProgress();
  },

  setProgressMap: (map) => {
    try {
      localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(map));
    } catch {}
    set({ progress: map });
    // Asynchronously save map to IndexedDB
    for (const item of Object.values(map)) {
      db.saveProgress(item);
    }
  },

  toggleFavorite: (id) => {
    const isFav = get().favorites.includes(id);
    set((state) => {
      const nextFavorites = isFav
        ? state.favorites.filter((favId) => favId !== id)
        : [...state.favorites, id];
      try {
        localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(nextFavorites));
      } catch {}
      return { favorites: nextFavorites };
    });

    if (isFav) {
      db.removeFavorite(id);
    } else {
      db.saveFavorite(id);
    }
  },

  setFavorites: (favorites) => {
    try {
      localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(favorites));
    } catch {}
    set({ favorites });
    for (const id of favorites) {
      db.saveFavorite(id);
    }
  },

  isFavorite: (id) => {
    return get().favorites.includes(id);
  },

  markEpisodeWatched: async (record) => {
    const fullRecord: db.WatchedEpisodeRecord = {
      ...record,
      watchedAt: Date.now(),
    };
    set((state) => ({
      watchedMap: {
        ...state.watchedMap,
        [record.id]: fullRecord,
      },
    }));
    await db.saveWatchedEpisode(fullRecord);
  },

  unmarkEpisodeWatched: async (id) => {
    set((state) => {
      const next = { ...state.watchedMap };
      delete next[id];
      return { watchedMap: next };
    });
    await db.removeWatchedEpisode(id);
  },

  markSeasonWatched: async (series, season, episodes) => {
    const now = Date.now();
    const records: db.WatchedEpisodeRecord[] = episodes.map((ep, idx) => ({
      id: `${series.id}_s${season}_e${idx}`,
      seriesId: series.id,
      seriesName: series.name,
      season,
      episodeIndex: idx,
      title: ep.name || `Episódio ${idx + 1}`,
      mediaType: 'series',
      watchedAt: now,
      autoMarked: false,
    }));

    set((state) => {
      const next = { ...state.watchedMap };
      for (const rec of records) {
        next[rec.id] = rec;
      }
      return { watchedMap: next };
    });

    await db.saveWatchedEpisodesBatch(records);
  },

  unmarkSeasonWatched: async (seriesId, season, episodes) => {
    const ids = episodes.map((_, idx) => `${seriesId}_s${season}_e${idx}`);
    set((state) => {
      const next = { ...state.watchedMap };
      for (const id of ids) {
        delete next[id];
      }
      return { watchedMap: next };
    });
    await db.removeWatchedEpisodesBatch(ids);
  },

  isWatched: (id) => {
    return !!get().watchedMap[id];
  },

  getSeriesWatchedCount: (seriesId) => {
    const watched = Object.values(get().watchedMap);
    return watched.filter((w) => w.seriesId === seriesId).length;
  },

  clearSeriesProgress: async (seriesId) => {
    const keysToRemove: string[] = [];
    set((state) => {
      const next = { ...state.progress };
      for (const [key, item] of Object.entries(next)) {
        if (item.seriesId === seriesId || item.id.startsWith(`${seriesId}_`)) {
          delete next[key];
          keysToRemove.push(key);
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(next));
      } catch {}
      return { progress: next };
    });

    for (const key of keysToRemove) {
      await db.removeProgress(key);
    }
  },

  clearAllProgress: async () => {
    try {
      localStorage.removeItem(STORAGE_KEY_PROGRESS);
    } catch {}
    set({ progress: {} });
    await db.clearProgress();
  },
}));

// Auto-trigger hydration when running in a browser environment
if (typeof window !== 'undefined') {
  usePlaybackStore.getState().init();
}

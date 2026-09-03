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
  watchedSummary: db.WatchedSummary;
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

  // Watched History Actions (Lightweight & On-Demand)
  refreshWatchedSummary: () => Promise<void>;
  markEpisodeWatched: (record: Omit<db.WatchedEpisodeRecord, 'watchedAt'>) => Promise<void>;
  unmarkEpisodeWatched: (id: string, seriesId?: string) => Promise<void>;
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
  getSeriesWatchedCount: (seriesId: string) => number;
  isMovieWatched: (id: string) => boolean;

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
  watchedSummary: { seriesCounts: {}, movieIds: [] },
  favorites: loadInitialFavorites(),
  isHydrated: false,

  init: async () => {
    try {
      await db.migrateFromLocalStorage();
      const [dbProgressList, dbFavorites, dbWatchedSummary] = await Promise.all([
        db.getProgressList(),
        db.getFavorites(),
        db.getWatchedSummary(),
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

      set({
        progress: progressMap,
        favorites: finalFavs,
        watchedSummary: dbWatchedSummary,
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

      if (item.type === 'series' && item.seriesId) {
        set((state) => ({
          watchedSummary: {
            ...state.watchedSummary,
            seriesCounts: {
              ...state.watchedSummary.seriesCounts,
              [item.seriesId!]: (state.watchedSummary.seriesCounts[item.seriesId!] || 0) + 1,
            },
          },
        }));
      } else if (item.type === 'movie') {
        set((state) => ({
          watchedSummary: {
            ...state.watchedSummary,
            movieIds: state.watchedSummary.movieIds.includes(item.id)
              ? state.watchedSummary.movieIds
              : [...state.watchedSummary.movieIds, item.id],
          },
        }));
      }

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

  refreshWatchedSummary: async () => {
    try {
      const summary = await db.getWatchedSummary();
      set({ watchedSummary: summary });
    } catch (err) {
      console.warn('[playbackStore] Failed to refresh watched summary:', err);
    }
  },

  markEpisodeWatched: async (record) => {
    const fullRecord: db.WatchedEpisodeRecord = {
      ...record,
      watchedAt: Date.now(),
    };
    await db.saveWatchedEpisode(fullRecord);

    if (record.mediaType === 'series' && record.seriesId) {
      set((state) => ({
        watchedSummary: {
          ...state.watchedSummary,
          seriesCounts: {
            ...state.watchedSummary.seriesCounts,
            [record.seriesId!]: (state.watchedSummary.seriesCounts[record.seriesId!] || 0) + 1,
          },
        },
      }));
    } else if (record.mediaType === 'movie') {
      set((state) => ({
        watchedSummary: {
          ...state.watchedSummary,
          movieIds: state.watchedSummary.movieIds.includes(record.id)
            ? state.watchedSummary.movieIds
            : [...state.watchedSummary.movieIds, record.id],
        },
      }));
    }
  },

  unmarkEpisodeWatched: async (id, seriesId) => {
    await db.removeWatchedEpisode(id);
    if (seriesId) {
      set((state) => {
        const curr = state.watchedSummary.seriesCounts[seriesId] || 0;
        return {
          watchedSummary: {
            ...state.watchedSummary,
            seriesCounts: {
              ...state.watchedSummary.seriesCounts,
              [seriesId]: Math.max(0, curr - 1),
            },
          },
        };
      });
    } else {
      set((state) => ({
        watchedSummary: {
          ...state.watchedSummary,
          movieIds: state.watchedSummary.movieIds.filter((mId) => mId !== id && mId !== `movie_${id}`),
        },
      }));
    }
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

    await db.saveWatchedEpisodesBatch(records);
    const seriesRecords = await db.getWatchedEpisodesBySeries(series.id);
    set((state) => ({
      watchedSummary: {
        ...state.watchedSummary,
        seriesCounts: {
          ...state.watchedSummary.seriesCounts,
          [series.id]: seriesRecords.length,
        },
      },
    }));
  },

  unmarkSeasonWatched: async (seriesId, season, episodes) => {
    const ids = episodes.map((_, idx) => `${seriesId}_s${season}_e${idx}`);
    await db.removeWatchedEpisodesBatch(ids);
    const seriesRecords = await db.getWatchedEpisodesBySeries(seriesId);
    set((state) => ({
      watchedSummary: {
        ...state.watchedSummary,
        seriesCounts: {
          ...state.watchedSummary.seriesCounts,
          [seriesId]: seriesRecords.length,
        },
      },
    }));
  },

  getSeriesWatchedCount: (seriesId) => {
    return get().watchedSummary.seriesCounts[seriesId] || 0;
  },

  isMovieWatched: (id) => {
    const { movieIds } = get().watchedSummary;
    return movieIds.includes(id) || movieIds.includes(`movie_${id}`);
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

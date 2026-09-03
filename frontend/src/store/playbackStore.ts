import { create } from 'zustand';
import * as db from '../services/db';

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
}

const STORAGE_KEY_PROGRESS = 'viniplay_vod_progress';
const STORAGE_KEY_FAVORITES = 'viniplay_vod_favorites';

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
  favorites: loadInitialFavorites(),
  isHydrated: false,

  init: async () => {
    try {
      await db.migrateFromLocalStorage();
      const [dbProgressList, dbFavorites] = await Promise.all([
        db.getProgressList(),
        db.getFavorites(),
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
    // If progress is >= 95%, we consider the current episode/movie finished
    const isFinished = item.duration > 0 && (item.currentTime / item.duration) >= 0.95;
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
}));

// Auto-trigger hydration when running in a browser environment
if (typeof window !== 'undefined') {
  usePlaybackStore.getState().init();
}

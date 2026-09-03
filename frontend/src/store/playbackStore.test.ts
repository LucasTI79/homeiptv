import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore } from './playbackStore';
import * as db from '../services/db';

describe('usePlaybackStore with IndexedDB integration', () => {
  beforeEach(async () => {
    localStorage.clear();
    const database = await db.openDb();
    const tx = database.transaction(['vod_progress', 'vod_favorites'], 'readwrite');
    tx.objectStore('vod_progress').clear();
    tx.objectStore('vod_favorites').clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
    usePlaybackStore.setState({ progress: {}, favorites: [], isHydrated: false });
  });

  it('hydrates store from indexedDB', async () => {
    await db.saveProgress({
      id: 'item_preexisting',
      title: 'Preexisting',
      type: 'movie',
      url: 'http://test.com/vid.mp4',
      currentTime: 50,
      duration: 200,
      updatedAt: 5000,
    });
    await db.saveFavorite('fav_1');

    await usePlaybackStore.getState().init();

    const state = usePlaybackStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.progress['item_preexisting']).toBeDefined();
    expect(state.progress['item_preexisting'].currentTime).toBe(50);
    expect(state.favorites).toContain('fav_1');
  });

  it('persists saveProgress to indexedDB asynchronously', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'item_active',
      title: 'Active Movie',
      type: 'movie',
      url: 'http://test.com/active.mp4',
      currentTime: 120,
      duration: 1000,
    });

    // In-memory state is instant
    expect(usePlaybackStore.getState().progress['item_active'].currentTime).toBe(120);

    // IndexedDB should be persisted
    const dbList = await db.getProgressList();
    expect(dbList.some((i) => i.id === 'item_active')).toBe(true);
  });

  it('removes finished item (>= 95%) from both state and indexedDB', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'item_finished',
      title: 'Finished Movie',
      type: 'movie',
      url: 'http://test.com/finished.mp4',
      currentTime: 960,
      duration: 1000,
    });

    expect(usePlaybackStore.getState().progress['item_finished']).toBeUndefined();
    const dbList = await db.getProgressList();
    expect(dbList.some((i) => i.id === 'item_finished')).toBe(false);
  });

  it('advances to next episode in series when current episode finishes (>= 95%)', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'series_1_s1_e0',
      seriesId: 'series_1',
      seriesName: 'Breaking Bad',
      season: '1',
      episodeIndex: 0,
      title: 'Breaking Bad - Ep 1',
      type: 'series',
      url: 'http://test.com/s1e1.mp4',
      currentTime: 980,
      duration: 1000,
      nextEpisode: {
        url: 'http://test.com/s1e2.mp4',
        name: 'Breaking Bad - Ep 2',
        season: '1',
        episodeIndex: 1,
      },
      episodes: [
        { name: 'Ep 1', url: 'http://test.com/s1e1.mp4' },
        { name: 'Ep 2', url: 'http://test.com/s1e2.mp4' },
        { name: 'Ep 3', url: 'http://test.com/s1e3.mp4' },
      ],
    });

    // The finished episode is removed
    expect(usePlaybackStore.getState().progress['series_1_s1_e0']).toBeUndefined();

    // The next episode is automatically queued in progress with currentTime 0
    const nextItem = usePlaybackStore.getState().progress['series_1_s1_e1'];
    expect(nextItem).toBeDefined();
    expect(nextItem?.title).toBe('Breaking Bad - Ep 2');
    expect(nextItem?.currentTime).toBe(0);
    expect(nextItem?.episodeIndex).toBe(1);

    // Persisted in IndexedDB as well
    const dbList = await db.getProgressList();
    expect(dbList.some((i) => i.id === 'series_1_s1_e1')).toBe(true);
    expect(dbList.some((i) => i.id === 'series_1_s1_e0')).toBe(false);
  });

  it('toggles favorites and updates both in-memory store and indexedDB', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().toggleFavorite('movie_fav_123');
    expect(usePlaybackStore.getState().isFavorite('movie_fav_123')).toBe(true);

    let dbFavs = await db.getFavorites();
    expect(dbFavs).toContain('movie_fav_123');

    usePlaybackStore.getState().toggleFavorite('movie_fav_123');
    expect(usePlaybackStore.getState().isFavorite('movie_fav_123')).toBe(false);

    dbFavs = await db.getFavorites();
    expect(dbFavs).not.toContain('movie_fav_123');
  });
});

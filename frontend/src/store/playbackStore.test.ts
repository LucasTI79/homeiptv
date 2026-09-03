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

  it('automatically marks finished episode as watched when reaching completion threshold', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'series_bb_s1_e0',
      seriesId: 'bb',
      seriesName: 'Breaking Bad',
      season: '1',
      episodeIndex: 0,
      title: 'Pilot',
      type: 'series',
      url: 'http://test.com/s1e0.mp4',
      currentTime: 960,
      duration: 1000,
    });

    // Count is updated in lightweight store summary
    expect(usePlaybackStore.getState().getSeriesWatchedCount('bb')).toBe(1);

    // Persisted in IndexedDB watched_episodes
    const dbWatched = await db.getWatchedEpisodes();
    expect(dbWatched.some((w) => w.id === 'series_bb_s1_e0')).toBe(true);
  });

  it('manages manual episode watched toggle', async () => {
    await usePlaybackStore.getState().init();

    await usePlaybackStore.getState().markEpisodeWatched({
      id: 'ep_manual_1',
      seriesId: 'series_x',
      seriesName: 'Series X',
      season: '1',
      episodeIndex: 0,
      title: 'Ep 1',
      mediaType: 'series',
      autoMarked: false,
    });

    expect(usePlaybackStore.getState().getSeriesWatchedCount('series_x')).toBe(1);
    expect(await db.isEpisodeWatched('ep_manual_1')).toBe(true);

    await usePlaybackStore.getState().unmarkEpisodeWatched('ep_manual_1', 'series_x');
    expect(usePlaybackStore.getState().getSeriesWatchedCount('series_x')).toBe(0);
    expect(await db.isEpisodeWatched('ep_manual_1')).toBe(false);
  });

  it('manages batch season watched and unmark operations', async () => {
    await usePlaybackStore.getState().init();

    const eps = [
      { name: 'Episode 1', url: 'http://test.com/1.mp4' },
      { name: 'Episode 2', url: 'http://test.com/2.mp4' },
      { name: 'Episode 3', url: 'http://test.com/3.mp4' },
    ];

    await usePlaybackStore.getState().markSeasonWatched(
      { id: 'dexter', name: 'Dexter' },
      '1',
      eps
    );

    expect(await db.isEpisodeWatched('dexter_s1_e0')).toBe(true);
    expect(await db.isEpisodeWatched('dexter_s1_e1')).toBe(true);
    expect(await db.isEpisodeWatched('dexter_s1_e2')).toBe(true);
    expect(usePlaybackStore.getState().getSeriesWatchedCount('dexter')).toBe(3);

    await usePlaybackStore.getState().unmarkSeasonWatched('dexter', '1', eps);
    expect(await db.isEpisodeWatched('dexter_s1_e0')).toBe(false);
    expect(usePlaybackStore.getState().getSeriesWatchedCount('dexter')).toBe(0);
  });

  it('clears in-progress episodes for a specific series', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'series_a_s1_e0',
      seriesId: 'series_a',
      title: 'Series A Ep 1',
      type: 'series',
      url: 'http://test.com/a1.mp4',
      currentTime: 100,
      duration: 1000,
    });

    usePlaybackStore.getState().saveProgress({
      id: 'series_b_s1_e0',
      seriesId: 'series_b',
      title: 'Series B Ep 1',
      type: 'series',
      url: 'http://test.com/b1.mp4',
      currentTime: 100,
      duration: 1000,
    });

    expect(usePlaybackStore.getState().progress['series_a_s1_e0']).toBeDefined();
    expect(usePlaybackStore.getState().progress['series_b_s1_e0']).toBeDefined();

    await usePlaybackStore.getState().clearSeriesProgress('series_a');

    expect(usePlaybackStore.getState().progress['series_a_s1_e0']).toBeUndefined();
    expect(usePlaybackStore.getState().progress['series_b_s1_e0']).toBeDefined();
  });

  it('clears all in-progress playback items', async () => {
    await usePlaybackStore.getState().init();

    usePlaybackStore.getState().saveProgress({
      id: 'movie_p1',
      title: 'Movie 1',
      type: 'movie',
      url: 'http://test.com/m1.mp4',
      currentTime: 100,
      duration: 1000,
    });

    expect(Object.keys(usePlaybackStore.getState().progress).length).toBe(1);

    await usePlaybackStore.getState().clearAllProgress();

    expect(Object.keys(usePlaybackStore.getState().progress).length).toBe(0);
    const dbProgress = await db.getProgressList();
    expect(dbProgress.length).toBe(0);
  });
});

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDb,
  getProgressList,
  saveProgress,
  removeProgress,
  clearProgress,
  getFavorites,
  saveFavorite,
  removeFavorite,
  migrateFromLocalStorage,
  getDownloadTasks,
  getDownloadTask,
  saveDownloadTask,
  removeDownloadTask,
  clearDownloadTasks,
  getWatchedEpisodes,
  getWatchedEpisodesBySeries,
  isEpisodeWatched,
  saveWatchedEpisode,
  saveWatchedEpisodesBatch,
  removeWatchedEpisode,
  removeWatchedEpisodesBatch,
  clearWatchedEpisodes,
  type OfflineProgressItem,
  type DownloadTask,
  type WatchedEpisodeRecord,
} from './db';

describe('Offline DB (IndexedDB)', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await openDb();
    const tx = db.transaction(['vod_progress', 'vod_favorites'], 'readwrite');
    tx.objectStore('vod_progress').clear();
    tx.objectStore('vod_favorites').clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  });

  it('saves and retrieves progress items ordered by updatedAt desc', async () => {
    const item1: OfflineProgressItem = {
      id: 'movie_1',
      title: 'Movie 1',
      type: 'movie',
      url: 'http://example.com/1.mp4',
      currentTime: 100,
      duration: 1000,
      updatedAt: 1000,
    };
    const item2: OfflineProgressItem = {
      id: 'series_1_s1_e1',
      seriesId: 'series_1',
      season: '1',
      episodeIndex: 0,
      title: 'Series 1 Ep 1',
      type: 'series',
      url: 'http://example.com/s1e1.mp4',
      currentTime: 50,
      duration: 500,
      updatedAt: 2000,
    };

    await saveProgress(item1);
    await saveProgress(item2);

    const list = await getProgressList();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('series_1_s1_e1'); // Mais recente primeiro
    expect(list[1].id).toBe('movie_1');
  });

  it('removes a progress item', async () => {
    const item: OfflineProgressItem = {
      id: 'movie_to_remove',
      title: 'Movie',
      type: 'movie',
      url: 'http://example.com/m.mp4',
      currentTime: 100,
      duration: 1000,
      updatedAt: 1000,
    };
    await saveProgress(item);
    let list = await getProgressList();
    expect(list.length).toBe(1);

    await removeProgress('movie_to_remove');
    list = await getProgressList();
    expect(list.length).toBe(0);
  });

  it('clears all progress items', async () => {
    await saveProgress({
      id: 'test_clear',
      title: 'Clear Me',
      type: 'movie',
      url: 'http://example.com/clear.mp4',
      currentTime: 10,
      duration: 100,
      updatedAt: 500,
    });
    await clearProgress();
    const list = await getProgressList();
    expect(list.length).toBe(0);
  });

  it('manages favorites in indexedDB', async () => {
    await saveFavorite('vod_fav_1');
    await saveFavorite('vod_fav_2');

    let favs = await getFavorites();
    expect(favs).toContain('vod_fav_1');
    expect(favs).toContain('vod_fav_2');

    await removeFavorite('vod_fav_1');
    favs = await getFavorites();
    expect(favs).not.toContain('vod_fav_1');
    expect(favs).toContain('vod_fav_2');
  });

  it('saves and retrieves audio fingerprints and content segments', async () => {
    const { saveSeriesFingerprint, getSeriesFingerprints, saveContentSegment, getContentSegment } = await import('./db');
    
    // Test Fingerprints
    await saveSeriesFingerprint({
      id: 'the-boys-s01_ep1',
      seasonClusterId: 'the-boys-s01',
      episode: 1,
      fingerprints: [100, 200, 300],
      createdAt: Date.now()
    });

    await saveSeriesFingerprint({
      id: 'the-boys-s01_ep2',
      seasonClusterId: 'the-boys-s01',
      episode: 2,
      fingerprints: [101, 201, 301],
      createdAt: Date.now()
    });

    const fps = await getSeriesFingerprints('the-boys-s01');
    expect(fps.length).toBe(2);
    expect(fps.map(f => f.episode).sort()).toEqual([1, 2]);

    // Test Content Segments
    await saveContentSegment({
      id: 'the-boys-s01_INTRO',
      seasonClusterId: 'the-boys-s01',
      type: 'INTRO',
      startSec: 42,
      endSec: 92,
      confidence: 0.96,
      source: 'audio_match',
      updatedAt: Date.now()
    });

    const segment = await getContentSegment('the-boys-s01', 'INTRO');
    expect(segment).not.toBeNull();
    expect(segment?.startSec).toBe(42);
    expect(segment?.endSec).toBe(92);
    expect(segment?.confidence).toBe(0.96);
  });

  it('migrates existing data from localStorage to indexedDB', async () => {
    localStorage.setItem(
      'viniplay_vod_progress',
      JSON.stringify({
        legacy_movie: {
          id: 'legacy_movie',
          title: 'Legacy Movie',
          type: 'movie',
          url: 'http://example.com/legacy.mp4',
          currentTime: 250,
          duration: 1200,
          updatedAt: 1500,
        },
      })
    );
    localStorage.setItem('viniplay_vod_favorites', JSON.stringify(['legacy_fav']));

    await migrateFromLocalStorage();

    const progressList = await getProgressList();
    expect(progressList.some((p) => p.id === 'legacy_movie')).toBe(true);

    const favs = await getFavorites();
    expect(favs).toContain('legacy_fav');
  });

  it('manages download tasks in IndexedDB', async () => {
    const task1: DownloadTask = {
      id: 'movie_123',
      mediaType: 'movie',
      title: 'Inception',
      remoteUrl: 'http://example.com/inception.mp4',
      totalBytes: 104857600,
      downloadedBytes: 52428800,
      status: 'downloading',
      createdAt: 1000,
      fileName: 'movie_123.mp4',
    };

    const task2: DownloadTask = {
      id: 'series_456_s01_e01',
      mediaType: 'series',
      seriesId: 'series_456',
      seriesName: 'Breaking Bad',
      season: '1',
      episodeIndex: 0,
      title: 'Pilot',
      remoteUrl: 'http://example.com/bb_s1e1.mp4',
      totalBytes: 209715200,
      downloadedBytes: 209715200,
      status: 'completed',
      createdAt: 2000,
      completedAt: 2500,
      fileName: 'series_456_s01_e01.mp4',
    };

    await saveDownloadTask(task1);
    await saveDownloadTask(task2);

    // Retrieve single task
    const retrieved = await getDownloadTask('movie_123');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe('Inception');
    expect(retrieved?.status).toBe('downloading');

    // Retrieve list (sorted by createdAt desc)
    const list = await getDownloadTasks();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('series_456_s01_e01');
    expect(list[1].id).toBe('movie_123');

    // Remove single task
    await removeDownloadTask('movie_123');
    const afterDelete = await getDownloadTask('movie_123');
    expect(afterDelete).toBeNull();

    // Clear all
    await clearDownloadTasks();
    const emptyList = await getDownloadTasks();
    expect(emptyList.length).toBe(0);
  });

  it('manages watched episodes store, querying by series, and batch operations', async () => {
    const ep1: WatchedEpisodeRecord = {
      id: 'bb_s1_e0',
      seriesId: 'bb',
      seriesName: 'Breaking Bad',
      season: '1',
      episodeIndex: 0,
      title: 'Pilot',
      mediaType: 'series',
      watchedAt: 1000,
      autoMarked: true,
    };
    const ep2: WatchedEpisodeRecord = {
      id: 'bb_s1_e1',
      seriesId: 'bb',
      seriesName: 'Breaking Bad',
      season: '1',
      episodeIndex: 1,
      title: 'Cat\'s in the Bag...',
      mediaType: 'series',
      watchedAt: 2000,
      autoMarked: false,
    };
    const movie: WatchedEpisodeRecord = {
      id: 'movie_99',
      title: 'Interstellar',
      mediaType: 'movie',
      watchedAt: 3000,
      autoMarked: true,
    };

    // Save individual
    await saveWatchedEpisode(ep1);
    expect(await isEpisodeWatched('bb_s1_e0')).toBe(true);
    expect(await isEpisodeWatched('bb_s1_e1')).toBe(false);

    // Save batch
    await saveWatchedEpisodesBatch([ep2, movie]);
    expect(await isEpisodeWatched('bb_s1_e1')).toBe(true);
    expect(await isEpisodeWatched('movie_99')).toBe(true);

    // Query all
    const all = await getWatchedEpisodes();
    expect(all.length).toBe(3);

    // Query by series
    const bbWatched = await getWatchedEpisodesBySeries('bb');
    expect(bbWatched.length).toBe(2);
    expect(bbWatched.map((e) => e.id)).toContain('bb_s1_e0');
    expect(bbWatched.map((e) => e.id)).toContain('bb_s1_e1');

    // Remove single
    await removeWatchedEpisode('movie_99');
    expect(await isEpisodeWatched('movie_99')).toBe(false);

    // Remove batch
    await removeWatchedEpisodesBatch(['bb_s1_e0', 'bb_s1_e1']);
    expect(await isEpisodeWatched('bb_s1_e0')).toBe(false);
    expect(await isEpisodeWatched('bb_s1_e1')).toBe(false);

    // Clear all
    await saveWatchedEpisode(ep1);
    await clearWatchedEpisodes();
    const afterClear = await getWatchedEpisodes();
    expect(afterClear.length).toBe(0);
  });
});

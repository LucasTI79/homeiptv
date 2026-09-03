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
  type OfflineProgressItem,
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
});

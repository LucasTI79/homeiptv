import { describe, it, expect } from 'vitest';
import { parseAndClusterMedia, getNextEpisode } from './seriesClusterer';

describe('seriesClusterer', () => {
  it('correctly parses standard SxxExx format', () => {
    const item = parseAndClusterMedia('The Boys S04E01 Episódio 1 [FHD] [Dublado]');
    expect(item.canonicalTitle).toBe('The Boys');
    expect(item.clusterId).toBe('the-boys');
    expect(item.seasonClusterId).toBe('the-boys-s04');
    expect(item.season).toBe(4);
    expect(item.episode).toBe(1);
  });

  it('correctly parses 1x02 format with brackets and resolution', () => {
    const item = parseAndClusterMedia('[LEG] THE BOYS 4x02 - O Início [1080p]');
    expect(item.canonicalTitle).toBe('THE BOYS O Inicio');
    expect(item.clusterId).toBe('the-boys-o-inicio');
    expect(item.season).toBe(4);
    expect(item.episode).toBe(2);
  });

  it('handles dot-separated filenames with release groups', () => {
    const item = parseAndClusterMedia('breaking.bad.s01.e03.720p.web-dl.x264.mkv');
    expect(item.canonicalTitle).toBe('breaking bad');
    expect(item.season).toBe(1);
    expect(item.episode).toBe(3);
  });

  it('handles "Ep 05" when season is omitted (defaults to season 1)', () => {
    const item = parseAndClusterMedia('Attack on Titan - Ep 05 (Dual Áudio)');
    expect(item.season).toBe(1);
    expect(item.episode).toBe(5);
  });

  describe('getNextEpisode', () => {
    const playlist = [
      parseAndClusterMedia('The Boys S01E01'),
      parseAndClusterMedia('The Boys S01E02'),
      parseAndClusterMedia('The Boys S01E03'),
      parseAndClusterMedia('The Boys S02E01'),
      parseAndClusterMedia('Other Show S01E01')
    ];

    it('finds the next episode in the same season', () => {
      const current = playlist[0]; // S01E01
      const next = getNextEpisode(current, playlist);
      expect(next).not.toBeNull();
      expect(next?.episode).toBe(2);
      expect(next?.season).toBe(1);
    });

    it('transitions to next season episode 1 when on last episode', () => {
      const current = playlist[2]; // S01E03
      const next = getNextEpisode(current, playlist);
      expect(next).not.toBeNull();
      expect(next?.season).toBe(2);
      expect(next?.episode).toBe(1);
    });

    it('returns null if there is no next episode', () => {
      const current = playlist[3]; // S02E01
      const next = getNextEpisode(current, playlist);
      expect(next).toBeNull();
    });
  });
});

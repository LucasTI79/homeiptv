import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import type { M3uSource, Settings } from '@homeiptv/shared-types';

vi.mock('fs');
vi.mock('../../sources', async () => {
  const actual = await vi.importActual<typeof import('../../sources')>('../../sources');
  return {
    ...actual,
    fetchUrlContent: vi.fn(),
  };
});

import { fetchUrlContent } from '../../sources';
import { M3uUrlStrategy } from '../M3uUrlStrategy';

function buildSource(overrides: Partial<M3uSource> = {}): M3uSource {
  return {
    id: 'src-2',
    name: 'Test URL Source',
    type: 'url',
    isActive: true,
    path: 'http://example.com/playlist.m3u',
    ...overrides,
  };
}

describe('M3uUrlStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches content over HTTP and caches it', async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const strategy = new M3uUrlStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, {} as Settings, sendStatus);

    expect(content).toBe('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');
    expect(fetchUrlContent).toHaveBeenCalledWith('http://example.com/playlist.m3u');
    expect(source.cachedRawPath).toContain('raw_src-2.m3u_cache');
  });

  it('clears cachedRawPath when writing the cache file fails, but still returns the content', async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue('#EXTM3U\n');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });

    const strategy = new M3uUrlStrategy();
    const source = buildSource({ cachedRawPath: '/old/stale/path' });
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, {} as Settings, sendStatus);

    expect(content).toBe('#EXTM3U\n');
    expect(source.cachedRawPath).toBeUndefined();
  });
});

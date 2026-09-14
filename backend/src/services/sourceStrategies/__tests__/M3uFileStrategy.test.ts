import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import { M3uFileStrategy } from '../M3uFileStrategy';

vi.mock('fs');

function buildSource(overrides: Partial<M3uSource> = {}): M3uSource {
  return {
    id: 'src-1',
    name: 'Test File Source',
    type: 'file',
    isActive: true,
    path: 'my-playlist.m3u',
    ...overrides,
  };
}

describe('M3uFileStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the file content when the source file exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');

    const strategy = new M3uFileStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, {} as Settings, sendStatus);

    expect(content).toBe('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');
  });

  it('throws and marks the source as errored when the file is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const strategy = new M3uFileStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    await expect(strategy.fetchContent(source, {} as Settings, sendStatus)).rejects.toThrow('File not found.');

    expect(source.status).toBe('Error');
    expect(source.statusMessage).toBe('File not found.');
    expect(sendStatus).toHaveBeenCalledWith(expect.stringContaining('File not found for source "Test File Source"'), 'error');
  });
});

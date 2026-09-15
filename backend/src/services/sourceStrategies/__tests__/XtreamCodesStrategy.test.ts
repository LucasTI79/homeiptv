import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import type { M3uSource, Settings } from '@homeiptv/shared-types';

vi.mock('fs');
vi.mock('../../httpFetch', async () => {
  const actual = await vi.importActual<typeof import('../../httpFetch')>('../../httpFetch');
  return {
    ...actual,
    fetchUrlContent: vi.fn(),
  };
});

import { fetchUrlContent } from '../../httpFetch';
import { XtreamCodesStrategy } from '../XtreamCodesStrategy';

function buildSource(overrides: Partial<M3uSource> = {}): M3uSource {
  return {
    id: 'src-3',
    name: 'Test XC Source',
    type: 'xc',
    isActive: true,
    path: '',
    xc_data: JSON.stringify({ server: 'http://xc.example.com', username: 'user1', password: 'pass1' }),
    ...overrides,
  };
}

function buildSettings(): Settings {
  return { userAgents: [], activeUserAgentId: '' } as unknown as Settings;
}

describe('XtreamCodesStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  it('builds an M3U string from live categories and streams', async () => {
    vi.mocked(fetchUrlContent)
      .mockResolvedValueOnce(JSON.stringify([{ category_id: '1', category_name: 'News' }]))
      .mockResolvedValueOnce(JSON.stringify([
        { stream_type: 'live', stream_id: 101, name: 'Channel A', stream_icon: 'http://x/a.png', category_id: '1', epg_channel_id: 'chA' },
        { stream_type: 'vod', stream_id: 202, name: 'Not a live stream' },
      ]));

    const strategy = new XtreamCodesStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, buildSettings(), sendStatus);

    expect(content).toContain('tvg-id="chA"');
    expect(content).toContain('tvg-name="Channel A"');
    expect(content).toContain('group-title="News"');
    expect(content).toContain('http://xc.example.com/live/user1/pass1/101.ts');
    expect(content).not.toContain('Not a live stream');
    expect(sendStatus).toHaveBeenCalledWith(expect.stringContaining('Added 1 live streams'), 'info');
  });

  it('throws when xc_data is missing', async () => {
    const strategy = new XtreamCodesStrategy();
    const source = buildSource({ xc_data: undefined });
    const sendStatus = vi.fn();

    await expect(strategy.fetchContent(source, buildSettings(), sendStatus)).rejects.toThrow('XC source is missing credential data');
  });

  it('warns and returns empty-ish content when the live-streams fetch fails, without throwing', async () => {
    vi.mocked(fetchUrlContent).mockRejectedValue(new Error('XC server unreachable'));

    const strategy = new XtreamCodesStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, buildSettings(), sendStatus);

    expect(content).toBe('');
    expect(sendStatus).toHaveBeenCalledWith(expect.stringContaining('Could not fetch live streams'), 'warning');
  });
});

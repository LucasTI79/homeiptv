import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('../settings', () => ({
  getSettings: vi.fn(),
}));

import { getSettings } from '../settings';
import { processAndMergeSources } from '../sources';

describe('processAndMergeSources with the strategy registry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('merges an active file-type M3U source into the live channels file via M3uFileStrategy', async () => {
    vi.mocked(getSettings).mockReturnValue({
      m3uSources: [
        { id: 'src-1', name: 'File Source', type: 'file', isActive: true, path: 'playlist.m3u' },
      ],
      epgSources: [],
      userAgents: [],
      activeUserAgentId: '',
      timezoneOffset: 0,
    } as never);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '#EXTM3U\n#EXTINF:-1 tvg-id="ch1" tvg-name="Channel 1" group-title="News",Channel 1\nhttp://example.com/1.ts\n'
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const sendStatus = vi.fn();
    const result = await processAndMergeSources(sendStatus);

    expect(result.success).toBe(true);
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const liveM3uWrite = writeCalls.find(([filePath]) => String(filePath).includes('live_channels'));
    expect(liveM3uWrite).toBeDefined();
    expect(String(liveM3uWrite![1])).toContain('src-1_ch1');
  });
});

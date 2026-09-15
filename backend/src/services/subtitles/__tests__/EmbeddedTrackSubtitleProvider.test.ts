import { describe, it, expect, vi } from 'vitest';
import path from 'path';

const ffmpegChain = {
  outputOptions: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  run: vi.fn(),
};

const mockFfprobe = vi.fn();

vi.mock('fluent-ffmpeg', () => {
  const fn = vi.fn(() => ffmpegChain) as unknown as { (): typeof ffmpegChain; ffprobe: typeof mockFfprobe };
  // Assigned as a lazy indirection (rather than `fn.ffprobe = mockFfprobe`)
  // because vi.mock factories are hoisted above top-level const
  // declarations in this file -- referencing mockFfprobe directly here
  // would throw "Cannot access before initialization" the moment
  // 'fluent-ffmpeg' is imported. Wrapping the reference in a closure defers
  // the lookup until the mock is actually invoked, by which point
  // mockFfprobe has been initialized.
  fn.ffprobe = ((...args: Parameters<typeof mockFfprobe>) => mockFfprobe(...args)) as typeof mockFfprobe;
  return { default: fn };
});

import { EmbeddedTrackSubtitleProvider } from '../EmbeddedTrackSubtitleProvider';

describe('EmbeddedTrackSubtitleProvider', () => {
  it('returns unavailable without calling ffmpeg extraction when there is no embedded subtitle stream', async () => {
    mockFfprobe.mockImplementation((_url: string, cb: (err: Error | null, metadata: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] });
    });
    const provider = new EmbeddedTrackSubtitleProvider('/tmp/subtitles');

    const result = await provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' });

    expect(result).toEqual({ available: false });
    expect(ffmpegChain.run).not.toHaveBeenCalled();
  });

  it('extracts the embedded subtitle track to VTT when one exists', async () => {
    mockFfprobe.mockImplementation((_url: string, cb: (err: Error | null, metadata: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video' }, { codec_type: 'subtitle' }] });
    });
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') ffmpegChain.run.mockImplementation(() => cb());
      return ffmpegChain;
    });
    const provider = new EmbeddedTrackSubtitleProvider('/tmp/subtitles');

    const result = await provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' });

    expect(result).toEqual({ available: true, vttPath: path.join('/tmp/subtitles', 'abc123.vtt') });
    expect(ffmpegChain.outputOptions).toHaveBeenCalledWith(['-map', '0:s:0']);
  });

  it('rejects when ffprobe itself errors', async () => {
    mockFfprobe.mockImplementation((_url: string, cb: (err: Error | null, metadata: unknown) => void) => {
      cb(new Error('probe failed'), null);
    });
    const provider = new EmbeddedTrackSubtitleProvider('/tmp/subtitles');

    await expect(provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' })).rejects.toThrow('probe failed');
  });
});

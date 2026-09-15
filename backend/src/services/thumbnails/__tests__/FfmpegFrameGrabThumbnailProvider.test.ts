import { describe, it, expect, vi } from 'vitest';
import path from 'path';

const screenshotsMock = vi.fn();
const ffmpegChain = {
  on: vi.fn().mockReturnThis(),
  screenshots: screenshotsMock,
};

vi.mock('fluent-ffmpeg', () => ({ default: vi.fn(() => ffmpegChain) }));

import { FfmpegFrameGrabThumbnailProvider } from '../FfmpegFrameGrabThumbnailProvider';

describe('FfmpegFrameGrabThumbnailProvider', () => {
  it('grabs one screenshot into the requested output path and resolves available: true', async () => {
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') screenshotsMock.mockImplementation(() => cb());
      return ffmpegChain;
    });
    const provider = new FfmpegFrameGrabThumbnailProvider();
    const outputPath = path.join('/tmp/thumbs', 'abc123.jpg');

    const result = await provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123', outputPath });

    expect(result).toEqual({ available: true, thumbnailPath: outputPath });
    expect(screenshotsMock).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'abc123.jpg', folder: '/tmp/thumbs' })
    );
  });

  it('rejects when ffmpeg emits an error', async () => {
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') screenshotsMock.mockImplementation(() => cb(new Error('frame grab failed')));
      return ffmpegChain;
    });
    const provider = new FfmpegFrameGrabThumbnailProvider();

    await expect(
      provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123', outputPath: '/tmp/thumbs/abc123.jpg' })
    ).rejects.toThrow('frame grab failed');
  });
});

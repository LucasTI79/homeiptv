import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../../config/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/paths')>();
  return { ...actual, THUMBNAILS_DIR: (globalThis as any).__TEST_THUMBNAILS_DIR__ };
});

describe('ThumbnailService', () => {
  let thumbnailsDir: string;

  beforeEach(async () => {
    thumbnailsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-service-test-'));
    (globalThis as any).__TEST_THUMBNAILS_DIR__ = thumbnailsDir;
    vi.resetModules();
  });

  it('returns the cached path without invoking the provider chain when the file already exists', async () => {
    const cachedPath = path.join(thumbnailsDir, 'abc123.jpg');
    fs.writeFileSync(cachedPath, 'fake-jpeg-bytes');
    const { ThumbnailService } = await import('../ThumbnailService');
    const service = new ThumbnailService();

    const result = await service.getOrCreate('http://example.com/video.mp4', 'abc123');

    expect(result).toBe(cachedPath);
  });

  it('returns null when no provider can produce a thumbnail', async () => {
    vi.doMock('../FfmpegFrameGrabThumbnailProvider', () => ({
      FfmpegFrameGrabThumbnailProvider: class {
        name = 'FfmpegFrameGrabThumbnailProvider';
        async attempt() { throw new Error('ffmpeg not available in test'); }
      },
    }));
    const { ThumbnailService } = await import('../ThumbnailService');
    const service = new ThumbnailService();

    const result = await service.getOrCreate('http://example.com/video.mp4', 'missing-media');

    expect(result).toBeNull();
  });
});

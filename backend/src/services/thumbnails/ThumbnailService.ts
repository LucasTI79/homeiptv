import fs from 'fs';
import path from 'path';
import { ProviderChain } from '../mediaIntelligence/ProviderChain';
import { FfmpegFrameGrabThumbnailProvider } from './FfmpegFrameGrabThumbnailProvider';
import { NoThumbnailAvailableProvider } from './NoThumbnailAvailableProvider';
import { THUMBNAILS_DIR } from '../../config/paths';
import type { ThumbnailRequest, ThumbnailResult } from './IThumbnailProvider';

const thumbnailProviderChain = new ProviderChain<ThumbnailRequest, ThumbnailResult>(
  [new FfmpegFrameGrabThumbnailProvider(), new NoThumbnailAvailableProvider()],
  (result) => result.available
);

export class ThumbnailService {
  async getOrCreate(mediaUrl: string, targetId: string): Promise<string | null> {
    const outputPath = path.join(THUMBNAILS_DIR, `${targetId}.jpg`);
    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    const result = await thumbnailProviderChain.run({ mediaUrl, targetId, outputPath });
    return result.available && result.thumbnailPath ? result.thumbnailPath : null;
  }
}

export const thumbnailService = new ThumbnailService();

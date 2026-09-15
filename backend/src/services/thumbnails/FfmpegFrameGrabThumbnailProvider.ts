import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { ThumbnailRequest, ThumbnailResult } from './IThumbnailProvider';

const FRAME_GRAB_TIMESTAMP_SECONDS = 10;

export class FfmpegFrameGrabThumbnailProvider implements ChainableProvider<ThumbnailRequest, ThumbnailResult> {
  public readonly name = 'FfmpegFrameGrabThumbnailProvider';

  async attempt({ mediaUrl, outputPath }: ThumbnailRequest): Promise<ThumbnailResult> {
    await this.grabFrame(mediaUrl, outputPath);
    return { available: true, thumbnailPath: outputPath };
  }

  private grabFrame(mediaUrl: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(mediaUrl)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .screenshots({
          timestamps: [FRAME_GRAB_TIMESTAMP_SECONDS],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
        });
    });
  }
}

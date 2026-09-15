import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { SubtitleRequest, SubtitleResult } from './ISubtitleProvider';

export class EmbeddedTrackSubtitleProvider implements ChainableProvider<SubtitleRequest, SubtitleResult> {
  public readonly name = 'EmbeddedTrackSubtitleProvider';

  constructor(private readonly subtitlesDir: string) {}

  async attempt({ mediaUrl, targetId }: SubtitleRequest): Promise<SubtitleResult> {
    const hasEmbeddedTrack = await this.probeForSubtitleStream(mediaUrl);
    if (!hasEmbeddedTrack) {
      return { available: false };
    }

    const vttPath = path.join(this.subtitlesDir, `${targetId}.vtt`);
    await this.extractTrack(mediaUrl, vttPath);
    return { available: true, vttPath };
  }

  private probeForSubtitleStream(mediaUrl: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaUrl, (err, metadata) => {
        if (err) return reject(err);
        const hasSubtitle = (metadata?.streams || []).some((s) => s.codec_type === 'subtitle');
        resolve(hasSubtitle);
      });
    });
  }

  private extractTrack(mediaUrl: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(mediaUrl)
        .outputOptions(['-map', '0:s:0'])
        .format('webvtt')
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }
}

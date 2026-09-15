import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { resolveFromRepoRoot } from '../../config/env';
import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { SubtitleRequest, SubtitleResult } from './ISubtitleProvider';

export class WhisperSubtitleProvider implements ChainableProvider<SubtitleRequest, SubtitleResult> {
  public readonly name = 'WhisperSubtitleProvider';

  constructor(private readonly subtitlesDir: string) {}

  async attempt({ mediaUrl, targetId, onProgress }: SubtitleRequest): Promise<SubtitleResult> {
    const tempAudioPath = path.join(this.subtitlesDir, `temp_${targetId}.wav`);
    const vttPath = path.join(this.subtitlesDir, `${targetId}.vtt`);

    try {
      onProgress?.('extracting_audio');
      await this.extractAudio(mediaUrl, tempAudioPath);

      onProgress?.('transcribing');
      const options = {
        modelName: 'tiny',
        modelPath: resolveFromRepoRoot('models/ggml-tiny.bin'),
        whisperOptions: {
          outputInText: false,
          outputInVtt: false,
          word_timestamps: false,
        },
      };

      // whisper-node lacks type definitions and is loaded lazily via dynamic
      // import (rather than a top-level `require`) so that test mocking --
      // which only intercepts import()/import statements, not literal
      // require() calls to externalized CJS deps -- can substitute it.
      // @ts-ignore -- whisper-node lacks type definitions
      const whisperNode: any = await import('whisper-node');
      // whisper-node returns an array of segment objects: [{start, end, speech}]
      const transcript = await whisperNode.whisper(tempAudioPath, options);

      if (!Array.isArray(transcript)) {
        throw new Error('Whisper did not return an array of transcriptions. Result: ' + JSON.stringify(transcript));
      }

      this.generateVtt(transcript, vttPath);
      return { available: true, vttPath };
    } finally {
      if (fs.existsSync(tempAudioPath)) {
        try { fs.unlinkSync(tempAudioPath); } catch {}
      }
    }
  }

  private extractAudio(mediaUrl: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(mediaUrl)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }

  private generateVtt(transcript: any[], outPath: string) {
    let vtt = 'WEBVTT\n\n';
    transcript.forEach((segment, i) => {
      const start = this.formatVttTime(segment.start);
      const end = this.formatVttTime(segment.end);
      vtt += `${i + 1}\n${start} --> ${end}\n${(segment.speech || segment.text || '').trim()}\n\n`;
    });
    fs.writeFileSync(outPath, vtt, 'utf8');
  }

  private formatVttTime(timeString: string | number): string {
    if (typeof timeString === 'string') {
      const parts = timeString.split(':');
      if (parts.length === 2) {
        return `00:${timeString.replace(',', '.')}`;
      }
      return timeString.replace(',', '.');
    }

    const date = new Date(0);
    date.setMilliseconds(Number(timeString) * 1000);
    return date.toISOString().substring(11, 23);
  }
}

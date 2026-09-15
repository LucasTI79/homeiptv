import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ffmpegChain = {
  noVideo: vi.fn().mockReturnThis(),
  audioChannels: vi.fn().mockReturnThis(),
  audioFrequency: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  run: vi.fn(),
};

vi.mock('fluent-ffmpeg', () => ({
  default: vi.fn(() => ffmpegChain),
}));

const whisperMock = vi.fn();
vi.mock('whisper-node', () => ({ whisper: whisperMock }));

import { WhisperSubtitleProvider } from '../WhisperSubtitleProvider';

describe('WhisperSubtitleProvider', () => {
  let subtitlesDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    subtitlesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-subtitle-test-'));
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') {
        // Simulate ffmpeg finishing synchronously once .run() is called.
        ffmpegChain.run.mockImplementation(() => cb());
      }
      return ffmpegChain;
    });
  });

  it('extracts audio, transcribes, writes a VTT file, and reports both progress phases', async () => {
    whisperMock.mockResolvedValue([{ start: '00:00.000', end: '00:02.000', speech: 'hello world' }]);
    const provider = new WhisperSubtitleProvider(subtitlesDir);
    const phases: string[] = [];

    const result = await provider.attempt({
      mediaUrl: 'http://example.com/video.mp4',
      targetId: 'abc123',
      onProgress: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(['extracting_audio', 'transcribing']);
    expect(result.available).toBe(true);
    expect(result.vttPath).toBe(path.join(subtitlesDir, 'abc123.vtt'));
    const vttContent = fs.readFileSync(result.vttPath!, 'utf8');
    expect(vttContent).toContain('WEBVTT');
    expect(vttContent).toContain('hello world');
  });

  it('cleans up the temp audio file even when transcription throws', async () => {
    whisperMock.mockRejectedValue(new Error('whisper crashed'));
    const provider = new WhisperSubtitleProvider(subtitlesDir);
    const tempAudioPath = path.join(subtitlesDir, 'temp_abc123.wav');
    fs.writeFileSync(tempAudioPath, ''); // simulate ffmpeg having produced the temp file

    await expect(provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' })).rejects.toThrow('whisper crashed');

    expect(fs.existsSync(tempAudioPath)).toBe(false);
  });

  it('throws when whisper-node does not return an array', async () => {
    whisperMock.mockResolvedValue({ not: 'an array' });
    const provider = new WhisperSubtitleProvider(subtitlesDir);

    await expect(provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' })).rejects.toThrow(
      'Whisper did not return an array of transcriptions'
    );
  });
});

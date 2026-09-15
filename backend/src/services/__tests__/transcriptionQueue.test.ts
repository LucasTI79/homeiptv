import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock('../subtitles/subtitleProviderChain', () => ({
  subtitleProviderChain: { run: runMock },
}));

import { transcriptionQueue } from '../transcriptionQueue';

describe('TranscriptionQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('goes through extracting_audio then transcribing before completing on success', async () => {
    const statuses: string[] = [];
    runMock.mockImplementation(async ({ onProgress }: { onProgress?: (p: string) => void }) => {
      onProgress?.('extracting_audio');
      statuses.push('extracting_audio');
      onProgress?.('transcribing');
      statuses.push('transcribing');
      return { available: true, vttPath: '/tmp/x.vtt' };
    });

    await transcriptionQueue.enqueue('http://example.com/video.mp4', 'job-1');
    await vi.waitFor(() => expect(transcriptionQueue.getJob('job-1')?.status).toBe('completed'));

    expect(statuses).toEqual(['extracting_audio', 'transcribing']);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: 'http://example.com/video.mp4', targetId: 'job-1' })
    );
  });

  it('marks the job failed when the chain resolves unavailable', async () => {
    runMock.mockResolvedValue({ available: false });

    await transcriptionQueue.enqueue('http://example.com/video.mp4', 'job-2');
    await vi.waitFor(() => expect(transcriptionQueue.getJob('job-2')?.status).toBe('failed'));

    expect(transcriptionQueue.getJob('job-2')?.error).toContain('No subtitle provider could produce a subtitle');
  });

  it('marks the job failed when the chain throws', async () => {
    runMock.mockRejectedValue(new Error('everything is on fire'));

    await transcriptionQueue.enqueue('http://example.com/video.mp4', 'job-3');
    await vi.waitFor(() => expect(transcriptionQueue.getJob('job-3')?.status).toBe('failed'));

    expect(transcriptionQueue.getJob('job-3')?.error).toBe('everything is on fire');
  });
});

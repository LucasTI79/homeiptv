import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { subtitleProviderChain } from './subtitles/subtitleProviderChain';
import { SUBTITLES_DIR } from './subtitles/subtitlesDir';

export interface TranscriptionJob {
  id: string;
  mediaUrl: string;
  targetId: string;
  status: 'queued' | 'extracting_audio' | 'transcribing' | 'completed' | 'failed';
  error?: string;
  progress?: number;
}

class TranscriptionQueue {
  private queue: TranscriptionJob[] = [];
  private activeJob: TranscriptionJob | null = null;
  private jobsMap: Map<string, TranscriptionJob> = new Map();

  public getJob(targetId: string): TranscriptionJob | undefined {
    return this.jobsMap.get(targetId);
  }

  public getSubtitlePath(targetId: string): string | null {
    const subtitleFile = path.join(SUBTITLES_DIR, `${targetId}.vtt`);
    if (fs.existsSync(subtitleFile)) {
      return subtitleFile;
    }
    return null;
  }

  public async enqueue(mediaUrl: string, targetId: string): Promise<TranscriptionJob> {
    const existingJob = this.jobsMap.get(targetId);
    if (existingJob && ['queued', 'extracting_audio', 'transcribing'].includes(existingJob.status)) {
      return existingJob;
    }

    if (this.getSubtitlePath(targetId)) {
       const job: TranscriptionJob = { id: uuidv4(), mediaUrl, targetId, status: 'completed' };
       this.jobsMap.set(targetId, job);
       return job;
    }

    const job: TranscriptionJob = {
      id: uuidv4(),
      mediaUrl,
      targetId,
      status: 'queued',
    };

    this.queue.push(job);
    this.jobsMap.set(targetId, job);
    console.log(`[Transcription] Queued job for ${targetId}`);

    this.processQueue();
    return job;
  }

  private async processQueue() {
    if (this.activeJob || this.queue.length === 0) return;

    this.activeJob = this.queue.shift() || null;
    if (!this.activeJob) return;

    const job = this.activeJob;

    try {
      console.log(`[Transcription] Starting job for ${job.targetId}`);
      job.status = 'extracting_audio';
      this.jobsMap.set(job.targetId, job);

      const result = await subtitleProviderChain.run({
        mediaUrl: job.mediaUrl,
        targetId: job.targetId,
        onProgress: (phase) => {
          job.status = phase;
          this.jobsMap.set(job.targetId, job);
        },
      });

      if (!result.available) {
        throw new Error('No subtitle provider could produce a subtitle for this media.');
      }

      job.status = 'completed';
      console.log(`[Transcription] Completed job for ${job.targetId}`);
    } catch (err: any) {
      console.error(`[Transcription] Failed for ${job.targetId}:`, err);
      job.status = 'failed';
      job.error = err.message || String(err);
    } finally {
      this.jobsMap.set(job.targetId, job);
      this.activeJob = null;
      this.processQueue();
    }
  }
}

export const transcriptionQueue = new TranscriptionQueue();

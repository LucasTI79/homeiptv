import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Disable TS strict checks for whisper-node as it lacks type definitions
const whisperNode = require('whisper-node');

const SUBTITLES_DIR = path.join(__dirname, '../../data/subtitles');

if (!fs.existsSync(SUBTITLES_DIR)) {
  fs.mkdirSync(SUBTITLES_DIR, { recursive: true });
}

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
    const tempAudioPath = path.join(SUBTITLES_DIR, `temp_${job.targetId}.wav`);
    const subtitleOutPath = path.join(SUBTITLES_DIR, `${job.targetId}.vtt`);

    try {
      console.log(`[Transcription] Starting job for ${job.targetId}`);
      job.status = 'extracting_audio';
      this.jobsMap.set(job.targetId, job);

      // 1. Extract Audio to 16kHz WAV
      await this.extractAudio(job.mediaUrl, tempAudioPath);

      // 2. Transcribe
      job.status = 'transcribing';
      this.jobsMap.set(job.targetId, job);
      console.log(`[Transcription] Transcribing ${job.targetId}...`);
      
      const options = {
        modelName: "tiny",       
        whisperOptions: {
          outputInText: false,   
          outputInVtt: false, 
          word_timestamps: false
        }
      };
      
      // whisper-node returns an array of segment objects: [{start, end, speech}]
      const transcript = await whisperNode.whisper(tempAudioPath, options);
      
      if (!Array.isArray(transcript)) {
          throw new Error('Whisper did not return an array of transcriptions. Result: ' + JSON.stringify(transcript));
      }

      // 3. Save VTT
      this.generateVtt(transcript, subtitleOutPath);

      job.status = 'completed';
      console.log(`[Transcription] Completed job for ${job.targetId}`);
    } catch (err: any) {
      console.error(`[Transcription] Failed for ${job.targetId}:`, err);
      job.status = 'failed';
      job.error = err.message || String(err);
    } finally {
      this.jobsMap.set(job.targetId, job);
      this.activeJob = null;
      if (fs.existsSync(tempAudioPath)) {
        try { fs.unlinkSync(tempAudioPath); } catch {}
      }
      this.processQueue();
    }
  }

  private extractAudio(mediaUrl: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[Transcription] Extracting audio from ${mediaUrl}...`);
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
             // mm:ss.ms
             return `00:${timeString.replace(',', '.')}`;
        }
        return timeString.replace(',', '.');
     }
     
     // Fallback if number (seconds)
     const date = new Date(0);
     date.setMilliseconds(Number(timeString) * 1000);
     return date.toISOString().substring(11, 23);
  }
}

export const transcriptionQueue = new TranscriptionQueue();

import { useState, useRef, useCallback, useEffect, type RefObject } from 'react';
import type { TranscriptionJob, SubtitleTrackOption } from '../types';

export interface TranscriptionController {
  readonly transcriptionJob: TranscriptionJob | null;
  readonly startTranscription: () => Promise<void>;
  readonly checkTranscriptionStatus: (targetId: string) => Promise<void>;
}

export function useTranscriptionController(
  targetId: string | null,
  mediaUrl: string | undefined,
  isVod: boolean,
  videoRef: RefObject<HTMLVideoElement | null>,
  setSubtitleTracks: (updater: (prev: readonly SubtitleTrackOption[]) => readonly SubtitleTrackOption[]) => void
): TranscriptionController {
  const [transcriptionJob, setTranscriptionJob] = useState<TranscriptionJob | null>(null);
  const transcriptionCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkedTargetIdRef = useRef<string | null>(null);

  const loadCustomSubtitle = useCallback((id: string) => {
    const video = videoRef.current;
    if (!video) return;

    const existing = video.querySelector('track#custom-subtitle');
    if (existing) {
      existing.remove();
    }

    const track = document.createElement('track');
    track.id = 'custom-subtitle';
    track.kind = 'subtitles';
    track.label = 'Legenda IA (Auto)';
    track.srclang = 'pt';
    track.src = `/api/vod/subtitles/${id}`;
    track.default = true;
    video.appendChild(track);

    setSubtitleTracks((prev) => {
      const filtered = prev.filter((t) => t.id !== 'custom-ia');
      return [...filtered, { id: 'custom-ia', name: 'Legenda IA (Auto)', lang: 'pt' }];
    });
  }, [videoRef, setSubtitleTracks]);

  const checkTranscriptionStatus = useCallback(async (id: string) => {
    try {
      const token = localStorage.getItem('viniplay_token');
      const authHeader = token ? `Bearer ${token}` : '';
      const res = await fetch(`/api/vod/transcribe/${id}/status`, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });

      if (!res.ok) {
        if (transcriptionCheckIntervalRef.current) {
          clearInterval(transcriptionCheckIntervalRef.current);
          transcriptionCheckIntervalRef.current = null;
        }
        return;
      }

      const data: { job?: TranscriptionJob | null } = await res.json();
      const currentJob = data.job ?? null;
      setTranscriptionJob(currentJob);

      if (currentJob?.status === 'completed') {
        loadCustomSubtitle(id);
        if (transcriptionCheckIntervalRef.current) {
          clearInterval(transcriptionCheckIntervalRef.current);
          transcriptionCheckIntervalRef.current = null;
        }
      } else if (currentJob?.status === 'failed') {
        if (transcriptionCheckIntervalRef.current) {
          clearInterval(transcriptionCheckIntervalRef.current);
          transcriptionCheckIntervalRef.current = null;
        }
      }
    } catch (e: unknown) {
      console.warn('[Transcription] Failed to check transcription status', e);
    }
  }, [loadCustomSubtitle]);

  const startTranscription = useCallback(async () => {
    if (!targetId || !mediaUrl) return;

    try {
      setTranscriptionJob({ status: 'queued' });
      const token = localStorage.getItem('viniplay_token');
      const authHeader = token ? `Bearer ${token}` : '';
      const res = await fetch('/api/vod/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({ targetId, mediaUrl }),
      });

      if (res.ok) {
        const data: { job?: TranscriptionJob } = await res.json();
        if (data.job) {
          setTranscriptionJob(data.job);
        }

        if (!transcriptionCheckIntervalRef.current) {
          transcriptionCheckIntervalRef.current = setInterval(() => {
            void checkTranscriptionStatus(targetId);
          }, 3000);
        }
      }
    } catch (e: unknown) {
      console.error('[Transcription] Failed to start transcription', e);
      setTranscriptionJob(null);
    }
  }, [targetId, mediaUrl, checkTranscriptionStatus]);

  useEffect(() => {
    if (!isVod || !targetId) return;

    if (checkedTargetIdRef.current !== targetId) {
      checkedTargetIdRef.current = targetId;
      void checkTranscriptionStatus(targetId);
    }

    const isRunning =
      transcriptionJob &&
      (transcriptionJob.status === 'queued' ||
        transcriptionJob.status === 'extracting_audio' ||
        transcriptionJob.status === 'transcribing');

    if (!transcriptionCheckIntervalRef.current && isRunning) {
      transcriptionCheckIntervalRef.current = setInterval(() => {
        void checkTranscriptionStatus(targetId);
      }, 3000);
    }

    return () => {
      if (transcriptionCheckIntervalRef.current) {
        clearInterval(transcriptionCheckIntervalRef.current);
        transcriptionCheckIntervalRef.current = null;
      }
    };
  }, [isVod, targetId, transcriptionJob, checkTranscriptionStatus]);

  return {
    transcriptionJob,
    startTranscription,
    checkTranscriptionStatus,
  };
}

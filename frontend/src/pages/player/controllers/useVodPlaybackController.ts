import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import toast from 'react-hot-toast';
import type { SelectedChannel } from '../../../store/uiStore';
import type { IntroSegment, ResumePrompt } from '../types';
import { usePlaybackStore } from '../../../store/playbackStore';
import { probeVodDuration } from '../../../api/vod';
import { AudioFingerprintCollector } from '../../../services/videoIntelligence/audioFingerprinter';
import { findIntroSegment } from '../../../services/videoIntelligence/audioMatcher';
import { parseAndClusterMedia } from '../../../services/videoIntelligence/seriesClusterer';
import { CreditsDetector, MAX_CREDITS_WINDOW_SECONDS } from '../../../services/videoIntelligence/creditsDetector';
import {
  getContentSegment,
  saveContentSegment,
  getSeriesFingerprints,
  saveSeriesFingerprint,
} from '../../../services/db';
import { VIDEO_INTELLIGENCE_CONFIG, PLAYER_CONFIG } from '../../../constants';

const {
  minProgressRecordSeconds: MIN_PLAYBACK_PROGRESS_RECORD_SECONDS,
  nextEpisodeCountdownSeconds: NEXT_EPISODE_COUNTDOWN_SECONDS,
  nextEpisodeFallbackTriggerBeforeEndSeconds: NEXT_EPISODE_FALLBACK_TRIGGER_BEFORE_END_SECONDS,
  minVideoDurationForNextEpisodeSeconds: MIN_VIDEO_DURATION_FOR_NEXT_EPISODE_SECONDS,
} = VIDEO_INTELLIGENCE_CONFIG.playback;

const {
  progressIntervalMs: PROGRESS_INTERVAL_MS,
  minResumeThresholdSeconds: MIN_RESUME_THRESHOLD_SECONDS,
  maxResumeThresholdBeforeEndSeconds: MAX_RESUME_THRESHOLD_BEFORE_END_SECONDS,
} = PLAYER_CONFIG;

export interface VodPlaybackController {
  readonly realVodDuration: number | null;
  readonly resumePrompt: ResumePrompt | null;
  readonly nextEpCountdown: number | null;
  readonly activeIntroSegment: IntroSegment | null;
  readonly introDismissed: boolean;
  readonly hasPrevEpisode: boolean;
  readonly hasNextEpisode: boolean;
  readonly getProgressItemId: () => string;
  readonly handleResumeConfirm: () => void;
  readonly handleResumeDismiss: () => void;
  readonly handleSkipIntro: (targetSec: number) => void;
  readonly handlePlayPrevEpisode: () => void;
  readonly handlePlayNextEpisode: () => void;
  readonly cancelNextEpCountdown: () => void;
  readonly handleLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleDurationChange: (dur: number) => void;
  readonly handleVideoEnded: () => void;
}

export function useVodPlaybackController(
  selectedChannel: SelectedChannel | null,
  setSelectedChannel: (channel: SelectedChannel) => void,
  videoRef: RefObject<HTMLVideoElement | null>,
  duration: number,
  setDuration: (dur: number) => void,
  setCurrentTime: (time: number) => void,
  playbackSpeed: number,
  isCasting: boolean,
  castIsPaused: boolean,
  castCurrentTime: number,
  castDuration: number,
  activeUserAgentId?: string
): VodPlaybackController {
  const saveProgress = usePlaybackStore((s) => s.saveProgress);
  const storedProgress = usePlaybackStore((s) => s.progress);
  const markEpisodeWatched = usePlaybackStore((s) => s.markEpisodeWatched);
  const removeProgress = usePlaybackStore((s) => s.removeProgress);

  const realVodDurationRef = useRef<number | null>(null);
  const [resumePrompt, setResumePrompt] = useState<ResumePrompt | null>(null);
  const hasCheckedResumeRef = useRef<boolean>(false);

  const [nextEpCountdown, setNextEpCountdown] = useState<number | null>(null);
  const [nextEpDismissed, setNextEpDismissed] = useState<boolean>(false);

  const [activeIntroSegment, setActiveIntroSegment] = useState<IntroSegment | null>(null);
  const [introDismissed, setIntroDismissed] = useState<boolean>(false);
  const audioCollectorRef = useRef<AudioFingerprintCollector | null>(null);
  const hasMatchedIntroRef = useRef<boolean>(false);

  const [activeCreditsSegment, setActiveCreditsSegment] = useState<IntroSegment | null>(null);
  const creditsDetectorRef = useRef<CreditsDetector | null>(null);

  const getProgressItemId = useCallback((): string => {
    if (!selectedChannel) return '';
    if (selectedChannel.seriesContext) {
      return `${selectedChannel.seriesContext.seriesId}_s${selectedChannel.seriesContext.season}_e${selectedChannel.seriesContext.episodeIndex}`;
    }
    return selectedChannel.id;
  }, [selectedChannel]);

  const formatTime = useCallback((seconds: number): string => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, []);

  const normalizeDurationSeconds = useCallback((raw: unknown): number | null => {
    if (typeof raw === 'number' && !isNaN(raw) && raw > 0) {
      return Math.round(raw);
    }
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const trimmed = raw.trim();
      if (!trimmed.includes(':')) {
        const parsedNum = Number(trimmed);
        if (!isNaN(parsedNum) && parsedNum > 0) {
          return Math.round(parsedNum);
        }
      } else {
        const parts = trimmed.split(':').map((p) => parseFloat(p));
        if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
          return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
        }
        if (parts.length === 2 && parts.every((p) => !isNaN(p))) {
          return Math.round(parts[0] * 60 + parts[1]);
        }
      }
    }
    return null;
  }, []);

  // Probe real duration for VOD items
  useEffect(() => {
    const knownDuration =
      normalizeDurationSeconds(selectedChannel?.duration) ??
      normalizeDurationSeconds(
        selectedChannel?.seriesContext?.episodes?.[selectedChannel.seriesContext.episodeIndex]?.duration
      );

    if (knownDuration && knownDuration > 0) {
      realVodDurationRef.current = knownDuration;
      setDuration(knownDuration);
      return;
    }

    realVodDurationRef.current = null;
    if (!selectedChannel?.isVod || !selectedChannel?.url) return;

    let isMounted = true;
    void probeVodDuration(selectedChannel.url, activeUserAgentId).then((probed) => {
      if (isMounted && probed && probed > 0) {
        realVodDurationRef.current = probed;
        setDuration(probed);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [
    selectedChannel?.url,
    selectedChannel?.isVod,
    selectedChannel?.duration,
    selectedChannel?.seriesContext,
    activeUserAgentId,
    setDuration,
    normalizeDurationSeconds,
  ]);

  // Audio fingerprinting and intro/credits detection
  useEffect(() => {
    if (!selectedChannel?.isVod) return;

    const parsed = parseAndClusterMedia(selectedChannel.name ?? '', selectedChannel.url);
    if (!parsed.seasonClusterId) return;

    setActiveIntroSegment(null);
    setActiveCreditsSegment(null);
    setIntroDismissed(false);
    hasMatchedIntroRef.current = false;

    let isCancelled = false;

    void getContentSegment(parsed.seasonClusterId, 'INTRO').then((seg) => {
      if (isCancelled) return;
      if (seg && seg.confidence >= 0.8) {
        setActiveIntroSegment({ startSec: seg.startSec, endSec: seg.endSec });
        hasMatchedIntroRef.current = true;
      }
    });

    void getContentSegment(parsed.seasonClusterId, 'CREDITS').then((seg) => {
      if (isCancelled) return;
      const dur = realVodDurationRef.current ?? (duration > 0 ? duration : (videoRef.current?.duration ?? 0));
      if (seg && seg.confidence >= 0.8) {
        if (!dur || isNaN(dur) || seg.startSec >= dur - MAX_CREDITS_WINDOW_SECONDS) {
          setActiveCreditsSegment({ startSec: seg.startSec, endSec: seg.endSec });
        }
      }
    });

    const collector = new AudioFingerprintCollector();
    audioCollectorRef.current = collector;

    const creditsDetector = new CreditsDetector();
    creditsDetectorRef.current = creditsDetector;

    let lastCheckSample = 0;
    const onSample = (sampleCount: number) => {
      if (hasMatchedIntroRef.current || isCancelled) return;

      if (sampleCount >= 60 && sampleCount - lastCheckSample >= 40) {
        lastCheckSample = sampleCount;
        void getSeriesFingerprints(parsed.seasonClusterId).then((prevList) => {
          if (hasMatchedIntroRef.current || isCancelled) return;
          const otherEp = prevList.find((f) => f.episode !== parsed.episode && f.fingerprints.length >= 60);
          if (otherEp) {
            const match = findIntroSegment(otherEp.fingerprints, collector.fingerprints);
            if (match.found && match.confidence >= 0.85) {
              hasMatchedIntroRef.current = true;
              setActiveIntroSegment({ startSec: match.startSec, endSec: match.endSec });
              void saveContentSegment({
                id: `${parsed.seasonClusterId}_INTRO`,
                seasonClusterId: parsed.seasonClusterId,
                type: 'INTRO',
                startSec: match.startSec,
                endSec: match.endSec,
                confidence: match.confidence,
                source: 'audio_match',
                updatedAt: Date.now(),
              });
            }
          }
        });
      }
    };

    const startTimer = setTimeout(() => {
      const video = videoRef.current;
      if (video && !isCancelled) {
        collector.start(video, 180, onSample);
        creditsDetector.start(video, (creditsStartSec) => {
          if (isCancelled) return;
          const dur = realVodDurationRef.current ?? (duration > 0 ? duration : (videoRef.current?.duration ?? 0));
          if (dur > 0 && creditsStartSec < dur - MAX_CREDITS_WINDOW_SECONDS) return;

          const creditsEnd = dur || (creditsStartSec + 60);
          setActiveCreditsSegment({ startSec: creditsStartSec, endSec: creditsEnd });
          void saveContentSegment({
            id: `${parsed.seasonClusterId}_CREDITS`,
            seasonClusterId: parsed.seasonClusterId,
            type: 'CREDITS',
            startSec: creditsStartSec,
            endSec: creditsEnd,
            confidence: 0.9,
            source: 'audio_match',
            updatedAt: Date.now(),
          });
        });
      }
    }, 1200);

    return () => {
      isCancelled = true;
      clearTimeout(startTimer);
      creditsDetector.stop();
      if (creditsDetectorRef.current === creditsDetector) {
        creditsDetectorRef.current = null;
      }
      const finalFps = collector.stop();
      if (finalFps.length >= 40) {
        void saveSeriesFingerprint({
          id: `${parsed.seasonClusterId}_ep${parsed.episode}`,
          seasonClusterId: parsed.seasonClusterId,
          episode: parsed.episode,
          fingerprints: finalFps,
          createdAt: Date.now(),
        });
      }
      collector.destroy();
      if (audioCollectorRef.current === collector) {
        audioCollectorRef.current = null;
      }
    };
  }, [selectedChannel?.url, selectedChannel?.name, selectedChannel?.isVod, duration, videoRef]);

  // Periodic progress saving & next episode trigger
  useEffect(() => {
    if (!selectedChannel?.isVod) return;
    if (!isCasting && !videoRef.current) return;

    const interval = setInterval(() => {
      const isPaused = isCasting ? castIsPaused : videoRef.current?.paused;
      const curr = isCasting ? castCurrentTime : videoRef.current?.currentTime;
      const effectiveDur = isCasting
        ? (castDuration > 0
            ? castDuration
            : (realVodDurationRef.current && realVodDurationRef.current > 0
                ? realVodDurationRef.current
                : (duration > 0 ? duration : (selectedChannel?.duration ?? 0))))
        : (realVodDurationRef.current && realVodDurationRef.current > 0
            ? realVodDurationRef.current
            : (duration > 0 ? duration : (videoRef.current?.duration ?? (selectedChannel?.duration ?? 0))));
      const dur = effectiveDur;

      if (isPaused || curr === undefined || !dur || isNaN(dur) || dur <= 0) return;

      const itemId = getProgressItemId();

      if (curr > MIN_PLAYBACK_PROGRESS_RECORD_SECONDS) {
        saveProgress({
          id: itemId,
          seriesId: selectedChannel.seriesContext?.seriesId,
          seriesName: selectedChannel.seriesContext?.seriesName,
          season: selectedChannel.seriesContext?.season,
          episodeIndex: selectedChannel.seriesContext?.episodeIndex,
          episodes: selectedChannel.seriesContext?.episodes,
          nextEpisode: selectedChannel.nextEpisode,
          title: selectedChannel.name,
          type: selectedChannel.vodType || (selectedChannel.seriesContext ? 'series' : 'movie'),
          url: selectedChannel.originalUrl || selectedChannel.url,
          logo: selectedChannel.logo,
          currentTime: Math.floor(curr),
          duration: Math.floor(dur),
        });
      }

      if (selectedChannel.nextEpisode && !nextEpDismissed) {
        const creditsStartThreshold = activeCreditsSegment
          ? activeCreditsSegment.startSec
          : dur - NEXT_EPISODE_FALLBACK_TRIGGER_BEFORE_END_SECONDS;

        if (curr >= creditsStartThreshold && dur > MIN_VIDEO_DURATION_FOR_NEXT_EPISODE_SECONDS) {
          if (nextEpCountdown === null) {
            setNextEpCountdown(NEXT_EPISODE_COUNTDOWN_SECONDS);
          }
        }
      }
    }, PROGRESS_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [
    selectedChannel,
    isCasting,
    castIsPaused,
    castCurrentTime,
    castDuration,
    getProgressItemId,
    saveProgress,
    nextEpDismissed,
    nextEpCountdown,
    activeCreditsSegment,
    duration,
    videoRef,
  ]);

  const handlePlayPrevEpisode = useCallback(() => {
    const seriesContext = selectedChannel?.seriesContext;
    if (!seriesContext || seriesContext.episodeIndex <= 0) return;

    const prevIdx = seriesContext.episodeIndex - 1;
    const prevEp = seriesContext.episodes[prevIdx];
    if (!prevEp) return;

    const prevId = `${seriesContext.seriesId}_s${seriesContext.season}_e${prevIdx}`;
    const prevName = `${seriesContext.seriesName} - ${prevEp.name || `Ep ${prevIdx + 1}`}`;

    const nextForPrev = {
      url: selectedChannel.url,
      name: selectedChannel.name,
      season: String(seriesContext.season),
      episodeIndex: seriesContext.episodeIndex,
    };

    saveProgress({
      id: prevId,
      seriesId: seriesContext.seriesId,
      seriesName: seriesContext.seriesName,
      season: String(seriesContext.season),
      episodeIndex: prevIdx,
      episodes: seriesContext.episodes,
      nextEpisode: nextForPrev,
      title: prevName,
      type: 'series',
      url: prevEp.url,
      logo: selectedChannel.logo,
      currentTime: 0,
      duration: 0,
    });

    setNextEpCountdown(null);
    setNextEpDismissed(false);
    hasCheckedResumeRef.current = false;

    setSelectedChannel({
      url: prevEp.url,
      name: prevName,
      id: prevId,
      isVod: true,
      vodType: 'series',
      logo: selectedChannel.logo,
      originalUrl: prevEp.url,
      seriesContext: {
        ...seriesContext,
        episodeIndex: prevIdx,
      },
      nextEpisode: nextForPrev,
    });
  }, [selectedChannel, setSelectedChannel, saveProgress]);

  const handlePlayNextEpisode = useCallback(() => {
    if (!selectedChannel) return;
    let next = selectedChannel.nextEpisode;
    const seriesContext = selectedChannel.seriesContext;

    if (!next && seriesContext && seriesContext.episodes) {
      const nextIdx = seriesContext.episodeIndex + 1;
      if (nextIdx < seriesContext.episodes.length) {
        const nextEp = seriesContext.episodes[nextIdx];
        next = {
          url: nextEp.url,
          name: `${seriesContext.seriesName} - ${nextEp.name || `Ep ${nextIdx + 1}`}`,
          season: String(seriesContext.season),
          episodeIndex: nextIdx,
        };
      }
    }

    if (!next) return;

    const currentId = getProgressItemId();
    if (currentId && selectedChannel) {
      if (selectedChannel.seriesContext) {
        markEpisodeWatched({
          id: currentId,
          seriesId: selectedChannel.seriesContext.seriesId,
          seriesName: selectedChannel.seriesContext.seriesName,
          season: String(selectedChannel.seriesContext.season),
          episodeIndex: selectedChannel.seriesContext.episodeIndex,
          title: selectedChannel.name,
          mediaType: 'series',
          autoMarked: true,
        });
      } else if (selectedChannel.isVod) {
        markEpisodeWatched({
          id: currentId,
          title: selectedChannel.name,
          mediaType: 'movie',
          autoMarked: true,
        });
      }
      removeProgress(currentId);
    }

    let subsequentEpisode: { url: string; name: string; season: string; episodeIndex: number } | undefined;
    if (seriesContext) {
      const nextIdx = next.episodeIndex + 1;
      if (nextIdx < seriesContext.episodes.length) {
        const sub = seriesContext.episodes[nextIdx];
        subsequentEpisode = {
          url: sub.url,
          name: `${seriesContext.seriesName} - ${sub.name || `Ep ${nextIdx + 1}`}`,
          season: next.season,
          episodeIndex: nextIdx,
        };
      }
    }

    const nextId = `${seriesContext?.seriesId || 'series'}_s${next.season}_e${next.episodeIndex}`;

    saveProgress({
      id: nextId,
      seriesId: seriesContext?.seriesId,
      seriesName: seriesContext?.seriesName,
      season: next.season,
      episodeIndex: next.episodeIndex,
      episodes: seriesContext?.episodes,
      nextEpisode: subsequentEpisode,
      title: next.name,
      type: 'series',
      url: next.url,
      logo: selectedChannel.logo,
      currentTime: 0,
      duration: 0,
    });

    setNextEpCountdown(null);
    setNextEpDismissed(false);
    hasCheckedResumeRef.current = false;

    setSelectedChannel({
      url: next.url,
      name: next.name,
      id: nextId,
      isVod: true,
      vodType: 'series',
      logo: selectedChannel.logo,
      originalUrl: next.url,
      seriesContext: seriesContext
        ? {
            ...seriesContext,
            season: next.season,
            episodeIndex: next.episodeIndex,
          }
        : undefined,
      nextEpisode: subsequentEpisode,
    });
  }, [selectedChannel, setSelectedChannel, saveProgress, markEpisodeWatched, removeProgress, getProgressItemId]);

  // Countdown ticker
  useEffect(() => {
    if (nextEpCountdown === null) return;

    if (nextEpCountdown <= 0) {
      handlePlayNextEpisode();
      return;
    }

    const timer = setTimeout(() => {
      setNextEpCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [nextEpCountdown, handlePlayNextEpisode]);

  // Reset state when channel url changes
  useEffect(() => {
    hasCheckedResumeRef.current = false;
    setResumePrompt(null);
    setNextEpCountdown(null);
    setNextEpDismissed(false);
  }, [selectedChannel?.url]);

  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const isLocal = selectedChannel?.url?.startsWith('/api/local-media');
    const knownChannelDur =
      normalizeDurationSeconds(selectedChannel?.duration) ??
      normalizeDurationSeconds(
        selectedChannel?.seriesContext?.episodes?.[selectedChannel.seriesContext.episodeIndex]?.duration
      );

    let dur = realVodDurationRef.current ?? knownChannelDur ?? 0;

    if (dur <= 0 && !isLocal) {
      const nativeDur = e.currentTarget.duration;
      if (typeof nativeDur === 'number' && !isNaN(nativeDur) && isFinite(nativeDur) && nativeDur > 0) {
        dur = nativeDur;
      }
    }

    if (dur <= 0 && selectedChannel?.isVod && selectedChannel.url) {
      void probeVodDuration(selectedChannel.url, activeUserAgentId).then((probed) => {
        if (probed && probed > 0) {
          realVodDurationRef.current = probed;
          setDuration(probed);
        }
      });
    } else if (dur > 0) {
      setDuration(dur);
    }

    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }

    if (selectedChannel?.isVod && !hasCheckedResumeRef.current) {
      hasCheckedResumeRef.current = true;
      const itemId = getProgressItemId();
      const saved = storedProgress[itemId];

      if (selectedChannel.initialTime && selectedChannel.initialTime > 5 && selectedChannel.initialTime < (dur || 999999) - 10) {
        if (videoRef.current) {
          videoRef.current.currentTime = selectedChannel.initialTime;
          setCurrentTime(selectedChannel.initialTime);
        }
      } else if (
        saved &&
        saved.currentTime > MIN_RESUME_THRESHOLD_SECONDS &&
        saved.currentTime < (dur || 999999) - MAX_RESUME_THRESHOLD_BEFORE_END_SECONDS
      ) {
        setResumePrompt({
          time: saved.currentTime,
          formatted: formatTime(saved.currentTime),
        });
      }
    }
  }, [
    selectedChannel,
    activeUserAgentId,
    setDuration,
    videoRef,
    playbackSpeed,
    getProgressItemId,
    storedProgress,
    setCurrentTime,
    formatTime,
    normalizeDurationSeconds,
  ]);

  const handleDurationChange = useCallback((dur: number) => {
    if (realVodDurationRef.current && realVodDurationRef.current > 0) {
      return;
    }
    const isLocal = selectedChannel?.url?.startsWith('/api/local-media');
    if (isLocal) {
      return;
    }
    if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
      setDuration(dur);
    }
  }, [selectedChannel?.url, setDuration]);

  const handleResumeConfirm = useCallback(() => {
    if (resumePrompt && videoRef.current) {
      videoRef.current.currentTime = resumePrompt.time;
      setCurrentTime(resumePrompt.time);
    }
    setResumePrompt(null);
  }, [resumePrompt, videoRef, setCurrentTime]);

  const handleResumeDismiss = useCallback(() => {
    setResumePrompt(null);
  }, []);

  const handleSkipIntro = useCallback((targetSec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = targetSec;
      setCurrentTime(targetSec);
    }
    setIntroDismissed(true);
  }, [videoRef, setCurrentTime]);

  const cancelNextEpCountdown = useCallback(() => {
    setNextEpDismissed(true);
    setNextEpCountdown(null);
  }, []);

  const hasPrevEpisode = Boolean(selectedChannel?.seriesContext && selectedChannel.seriesContext.episodeIndex > 0);
  const hasNextEpisode = Boolean(
    selectedChannel?.nextEpisode ||
      (selectedChannel?.seriesContext?.episodes &&
        selectedChannel.seriesContext.episodeIndex + 1 < selectedChannel.seriesContext.episodes.length)
  );

  const handleVideoEnded = useCallback(() => {
    const video = videoRef.current;
    const curr = isCasting ? castCurrentTime : (video?.currentTime ?? 0);
    const effectiveDur = isCasting
      ? (castDuration > 0
          ? castDuration
          : (realVodDurationRef.current && realVodDurationRef.current > 0
              ? realVodDurationRef.current
              : (duration > 0 ? duration : (selectedChannel?.duration ?? 0))))
      : (realVodDurationRef.current && realVodDurationRef.current > 0
          ? realVodDurationRef.current
          : (duration > 0 ? duration : (video?.duration ?? (selectedChannel?.duration ?? 0))));

    // A media is genuinely finished if:
    // 1. We know duration (> 0) and currentTime reached near the end:
    //    remaining <= 25 seconds OR >= 90% of total duration played.
    // 2. If duration is 0 / unknown, we MUST NOT assume an ended event after
    //    a few minutes was genuine completion!
    const isGenuinelyFinished =
      effectiveDur > 0 && !isNaN(effectiveDur) && isFinite(effectiveDur)
        ? (curr >= effectiveDur - 25 || (curr / effectiveDur) >= 0.90)
        : false;

    if (!isGenuinelyFinished) {
      console.warn(
        `[VOD] Premature ended event detected! currentTime: ${curr}s, duration: ${effectiveDur}s. Stalling/connection drop prevented from auto-skipping.`
      );

      // Save progress so user does not lose their position
      if (selectedChannel?.isVod && curr > 0) {
        const currentId = getProgressItemId();
        if (currentId) {
          saveProgress({
            id: currentId,
            seriesId: selectedChannel.seriesContext?.seriesId,
            seriesName: selectedChannel.seriesContext?.seriesName,
            season: selectedChannel.seriesContext?.season ? String(selectedChannel.seriesContext.season) : undefined,
            episodeIndex: selectedChannel.seriesContext?.episodeIndex,
            episodes: selectedChannel.seriesContext?.episodes,
            nextEpisode: selectedChannel.nextEpisode,
            title: selectedChannel.name,
            type: selectedChannel.vodType || 'movie',
            url: selectedChannel.originalUrl || selectedChannel.url,
            logo: selectedChannel.logo,
            currentTime: curr,
            duration: effectiveDur > 0 ? effectiveDur : 0,
          });
        }
      }

      // If buffer stalled or connection dropped, attempt quick reconnect or inform user
      if (video && !isCasting && curr > 3) {
        toast.error('Transmissão interrompida. Tentando reconectar...', { id: 'vod-stream-reconnect' });
        const savedPos = curr;
        const currentSrc = video.src;
        video.src = currentSrc;
        video.load();
        video.currentTime = savedPos;
        void Promise.resolve(video.play()).catch((err: unknown) => {
          console.warn('[VOD] Auto-reconnect play failed:', err);
        });
      }
      return;
    }

    if (hasNextEpisode) {
      handlePlayNextEpisode();
    } else if (selectedChannel?.isVod) {
      const currentId = getProgressItemId();
      if (currentId) {
        if (selectedChannel.seriesContext) {
          markEpisodeWatched({
            id: currentId,
            seriesId: selectedChannel.seriesContext.seriesId,
            seriesName: selectedChannel.seriesContext.seriesName,
            season: String(selectedChannel.seriesContext.season),
            episodeIndex: selectedChannel.seriesContext.episodeIndex,
            title: selectedChannel.name,
            mediaType: 'series',
            autoMarked: true,
          });
        } else {
          markEpisodeWatched({
            id: currentId,
            title: selectedChannel.name,
            mediaType: 'movie',
            autoMarked: true,
          });
        }
        removeProgress(currentId);
      }
    }
  }, [
    isCasting,
    castCurrentTime,
    castDuration,
    videoRef,
    duration,
    selectedChannel,
    getProgressItemId,
    saveProgress,
    hasNextEpisode,
    handlePlayNextEpisode,
    markEpisodeWatched,
    removeProgress,
  ]);

  return {
    realVodDuration: realVodDurationRef.current,
    resumePrompt,
    nextEpCountdown,
    activeIntroSegment,
    introDismissed,
    hasPrevEpisode,
    hasNextEpisode,
    getProgressItemId,
    handleResumeConfirm,
    handleResumeDismiss,
    handleSkipIntro,
    handlePlayPrevEpisode,
    handlePlayNextEpisode,
    cancelNextEpCountdown,
    handleLoadedMetadata,
    handleDurationChange,
    handleVideoEnded,
  };
}

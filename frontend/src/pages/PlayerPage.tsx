import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mpegts from 'mpegts.js';
import { useUiStore } from '../store/uiStore';
import { useConfig } from '../api/guide';
import { Tooltip } from '../components/ui/Tooltip';
import { GuideTour } from '../components/ui/GuideTour';
import { EmptyState } from '../components/ui/EmptyState';
import { useCast } from '../components/cast/CastProvider';
import { usePlaybackStore } from '../store/playbackStore';
import { FiCast, FiRotateCcw, FiRotateCw, FiPlay, FiX, FiHardDrive } from 'react-icons/fi';
import { SkipIntroOverlay } from '../components/vod/SkipIntroOverlay';
import { AudioFingerprintCollector } from '../services/videoIntelligence/audioFingerprinter';
import { findIntroSegment } from '../services/videoIntelligence/audioMatcher';
import { parseAndClusterMedia } from '../services/videoIntelligence/seriesClusterer';
import { CreditsDetector, MAX_CREDITS_WINDOW_SECONDS } from '../services/videoIntelligence/creditsDetector';
import {
  getContentSegment,
  saveContentSegment,
  getSeriesFingerprints,
  saveSeriesFingerprint,
  getDownloadTask,
} from '../services/db';
import { getDownloadedFile } from '../services/opfsStorage';

import { VIDEO_INTELLIGENCE_CONFIG, PLAYER_CONFIG } from '../constants';

const {
  minProgressRecordSeconds: MIN_PLAYBACK_PROGRESS_RECORD_SECONDS,
  nextEpisodeCountdownSeconds: NEXT_EPISODE_COUNTDOWN_SECONDS,
  nextEpisodeFallbackTriggerBeforeEndSeconds: NEXT_EPISODE_FALLBACK_TRIGGER_BEFORE_END_SECONDS,
  minVideoDurationForNextEpisodeSeconds: MIN_VIDEO_DURATION_FOR_NEXT_EPISODE_SECONDS,
} = VIDEO_INTELLIGENCE_CONFIG.playback;

const {
  defaultVolume: DEFAULT_PLAYER_VOLUME,
  volumeStorageKey: VOLUME_STORAGE_KEY,
  progressIntervalMs: PROGRESS_INTERVAL_MS,
  minResumeThresholdSeconds: MIN_RESUME_THRESHOLD_SECONDS,
  maxResumeThresholdBeforeEndSeconds: MAX_RESUME_THRESHOLD_BEFORE_END_SECONDS,
} = PLAYER_CONFIG;

export function PlayerPage() {
  const navigate = useNavigate();
  const selectedChannel = useUiStore((s) => s.selectedChannel);
  const setSelectedChannel = useUiStore((s) => s.setSelectedChannel);
  const { data: config } = useConfig();
  const saveProgress = usePlaybackStore((s) => s.saveProgress);
  const storedProgress = usePlaybackStore((s) => s.progress);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<mpegts.Player | null>(null);
  const { isAvailable, isCasting, isConnected, requestSession, loadMedia, togglePlayPause: castTogglePlay, stopCasting, isPaused: castIsPaused, seekMedia } = useCast();
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) || String(DEFAULT_PLAYER_VOLUME)));
  const [isMuted, setIsMuted] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [forceDirect, setForceDirect] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isOfflineMedia, setIsOfflineMedia] = useState(false);

  // Resume prompt state
  const [resumePrompt, setResumePrompt] = useState<{ time: number; formatted: string } | null>(null);
  const hasCheckedResumeRef = useRef<boolean>(false);

  // Next Episode Countdown overlay state
  const [nextEpCountdown, setNextEpCountdown] = useState<number | null>(null);
  const [nextEpDismissed, setNextEpDismissed] = useState<boolean>(false);

  // Skip Intro intelligence state
  const [activeIntroSegment, setActiveIntroSegment] = useState<{ startSec: number; endSec: number } | null>(null);
  const [introDismissed, setIntroDismissed] = useState<boolean>(false);
  const audioCollectorRef = useRef<AudioFingerprintCollector | null>(null);
  const hasMatchedIntroRef = useRef<boolean>(false);

  // Credits & Next Episode intelligence state
  const [activeCreditsSegment, setActiveCreditsSegment] = useState<{ startSec: number; endSec: number } | null>(null);
  const creditsDetectorRef = useRef<CreditsDetector | null>(null);

  useEffect(() => {
    if (!selectedChannel || !config) return;

    setPlaybackError(null);
    const profileId = config.settings.activeStreamProfileId;
    const userAgentId = config.settings.activeUserAgentId;
    const profile = (config.settings.streamProfiles || []).find((p: { id: string; command: string }) => p.id === profileId);

    if (!profileId || !userAgentId || !profile) {
      console.error('Missing active profile or user agent.');
      return;
    }

    const isVod = !!selectedChannel.isVod;
    const vodEngine = config.settings.vodPlaybackEngine || 'native';
    const useNativeVod = isVod && vodEngine === 'native';

    // When playing native VOD over HTTPS, proxy through /api/media-proxy to prevent Mixed Content and CSP blocks
    const streamUrlToPlay = useNativeVod
      ? `/api/media-proxy?url=${encodeURIComponent(selectedChannel.url)}`
      : (forceDirect || profile.command === 'redirect')
      ? selectedChannel.url
      : `/stream?url=${encodeURIComponent(selectedChannel.url)}&profileId=${profileId}&userAgentId=${userAgentId}`;

    let isCancelled = false;
    let localBlobUrl: string | null = null;

    async function initMediaPlayback() {
      const channel = selectedChannel;
      if (!channel) return;

      // 1. Check if media was downloaded to local OPFS
      if (isVod && videoRef.current) {
        let fileName = channel.offlineFileName;
        if (!fileName) {
          const candidateIds = [
            channel.id,
            `movie_${channel.id}`,
            channel.seriesContext
              ? `${channel.seriesContext.seriesId}_s${channel.seriesContext.season}_e${channel.seriesContext.episodeIndex}`
              : null,
          ].filter(Boolean) as string[];

          for (const cid of candidateIds) {
            const task = await getDownloadTask(cid);
            if (task && task.status === 'completed') {
              fileName = task.fileName;
              break;
            }
          }
        }

        if (fileName) {
          const localFile = await getDownloadedFile(fileName);
          if (localFile && !isCancelled && videoRef.current) {
            localBlobUrl = URL.createObjectURL(localFile);
            setIsOfflineMedia(true);
            const video = videoRef.current;
            video.src = localBlobUrl;
            video.load();
            Promise.resolve(video.play()).catch((e: Error | { name?: string; message?: string }) => {
              if (e && (e.name === 'AbortError' || ('message' in e && e.message?.includes('AbortError')))) {
                return;
              }
              console.error('Offline VOD play error', e);
            });
            return;
          }
        }
      }

      setIsOfflineMedia(false);

      if (useNativeVod && videoRef.current) {
        // Native browser media element mode for VOD (mp4/mkv/hls)
        // Provides complete file duration, accurate seeking, and native buffering
        const video = videoRef.current;
        video.src = streamUrlToPlay;
        video.load();
        Promise.resolve(video.play()).catch((e: Error | { name?: string; message?: string }) => {
          if (e && (e.name === 'AbortError' || ('message' in e && e.message?.includes('AbortError')))) {
            return;
          }
          console.error('Native VOD play error', e);
        });
        return;
      }

      if (mpegts.isSupported() && videoRef.current) {
        const player = mpegts.createPlayer({
          type: 'mse',
          isLive: !isVod,
          url: streamUrlToPlay,
        }, {
          enableStashBuffer: true,
          stashInitialSize: isVod ? 1024 : 128,
          liveBufferLatencyChasing: !isVod ? false : undefined,
        });

        playerRef.current = player;
        
        player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string) => {
          console.warn('mpegts error:', errorType, errorDetail);
          setPlaybackError('Stream playback error encountered.');
        });

        player.attachMediaElement(videoRef.current);
        player.load();
        Promise.resolve(player.play()).catch((e: Error | { name?: string; message?: string }) => {
          if (e && (e.name === 'AbortError' || ('message' in e && e.message?.includes('AbortError')))) {
            return;
          }
          console.error('Play error', e);
        });
      }
    }

    initMediaPlayback().catch((err) => {
      console.warn('[PlayerPage] Playback initialization error:', err);
    });

    const videoEl = videoRef.current;

    return () => {
      isCancelled = true;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
        localBlobUrl = null;
      }
      if (videoEl) {
        try {
          videoEl.pause();
          videoEl.removeAttribute('src');
          videoEl.load();
        } catch {
          // ignore
        }
      }
      if (playerRef.current) {
        try {
          playerRef.current.pause();
          playerRef.current.unload();
          playerRef.current.detachMediaElement();
          playerRef.current.destroy();
        } catch {
          // Ignore teardown errors if media element was unmounted or detached
        }
        playerRef.current = null;
      }
    };
  }, [selectedChannel, config, forceDirect, retryNonce]);

  useEffect(() => {
    if (isCasting && isConnected && selectedChannel) {
      if (playerRef.current) {
        try {
          playerRef.current.pause();
          playerRef.current.unload();
          playerRef.current.detachMediaElement();
          playerRef.current.destroy();
        } catch {
          // Ignore teardown errors
        }
        playerRef.current = null;
      }
      loadMedia(
        selectedChannel.url,
        selectedChannel.name,
        selectedChannel.logo || '',
        !!selectedChannel.isVod,
        selectedChannel.originalUrl || selectedChannel.url
      );
    }
  }, [isCasting, isConnected, selectedChannel, loadMedia]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      localStorage.setItem(VOLUME_STORAGE_KEY, volume.toString());
    }
  }, [volume]);

  const togglePlay = () => {
    if (isCasting) {
      castTogglePlay();
      return;
    }
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch((e: Error) => {
        if (e.name !== 'AbortError') console.error(e);
      });
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleSeek = (deltaSeconds: number) => {
    if (isCasting) {
      seekMedia(deltaSeconds);
      return;
    }
    if (!videoRef.current) return;
    const newTime = Math.max(0, Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + deltaSeconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleProgressBarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (isCasting) {
      const delta = newTime - currentTime;
      seekMedia(delta);
      return;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const togglePip = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPip(false);
      } else {
        await videoRef.current.requestPictureInPicture();
        setIsPip(true);
      }
    } catch (e) {
      console.error('PiP failed', e);
    }
  };

  // Helper to determine item ID in progress store
  const getProgressItemId = useCallback(() => {
    if (!selectedChannel) return '';
    if (selectedChannel.seriesContext) {
      return `${selectedChannel.seriesContext.seriesId}_s${selectedChannel.seriesContext.season}_e${selectedChannel.seriesContext.episodeIndex}`;
    }
    return selectedChannel.id;
  }, [selectedChannel]);

  // Check for resume position when video metadata is loaded
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const dur = e.currentTarget.duration || 0;
    setDuration(dur);

    if (selectedChannel?.isVod && !hasCheckedResumeRef.current) {
      hasCheckedResumeRef.current = true;
      const itemId = getProgressItemId();
      const saved = storedProgress[itemId];

      // If specified directly via initialTime (e.g. from Continue Watching click)
      if (selectedChannel.initialTime && selectedChannel.initialTime > 5 && selectedChannel.initialTime < dur - 10) {
        if (videoRef.current) {
          videoRef.current.currentTime = selectedChannel.initialTime;
          setCurrentTime(selectedChannel.initialTime);
        }
      } else if (saved && saved.currentTime > MIN_RESUME_THRESHOLD_SECONDS && saved.currentTime < dur - MAX_RESUME_THRESHOLD_BEFORE_END_SECONDS) {
        // Show resume prompt
        setResumePrompt({
          time: saved.currentTime,
          formatted: formatTime(saved.currentTime),
        });
      }
    }
  };

  const handleResumeConfirm = () => {
    if (resumePrompt && videoRef.current) {
      videoRef.current.currentTime = resumePrompt.time;
      setCurrentTime(resumePrompt.time);
    }
    setResumePrompt(null);
  };

  const handleResumeDismiss = () => {
    setResumePrompt(null);
  };

  // Play next episode handler
  const handlePlayNextEpisode = useCallback(() => {
    if (!selectedChannel?.nextEpisode) return;
    const next = selectedChannel.nextEpisode;
    const seriesContext = selectedChannel.seriesContext;

    // Compute what comes after the next episode if seriesContext exists
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

    // Immediately register the new episode in Continue Watching so it never disappears
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
      seriesContext: seriesContext ? {
        ...seriesContext,
        season: next.season,
        episodeIndex: next.episodeIndex,
      } : undefined,
      nextEpisode: subsequentEpisode,
    });
  }, [selectedChannel, setSelectedChannel, saveProgress]);

  // Skip Intro handler
  const handleSkipIntro = useCallback((targetSec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = targetSec;
      setCurrentTime(targetSec);
    }
    setIntroDismissed(true);
  }, []);

  // Audio Fingerprinting & Intro/Credits Detection lifecycle
  useEffect(() => {
    if (!selectedChannel?.isVod) return;

    const parsed = parseAndClusterMedia(selectedChannel.name || '', selectedChannel.url);
    if (!parsed.seasonClusterId) return;

    setActiveIntroSegment(null);
    setActiveCreditsSegment(null);
    setIntroDismissed(false);
    hasMatchedIntroRef.current = false;

    let isCancelled = false;

    // 1. Check if we already have confirmed intro / credits segments in IndexedDB
    getContentSegment(parsed.seasonClusterId, 'INTRO').then((seg) => {
      if (isCancelled) return;
      if (seg && seg.confidence >= 0.8) {
        setActiveIntroSegment({ startSec: seg.startSec, endSec: seg.endSec });
        hasMatchedIntroRef.current = true;
      }
    });

    getContentSegment(parsed.seasonClusterId, 'CREDITS').then((seg) => {
      if (isCancelled) return;
      const dur = videoRef.current?.duration;
      // Sanity check: discard any stored segment that is outside the genuine credits window
      if (seg && seg.confidence >= 0.8) {
        if (!dur || isNaN(dur) || seg.startSec >= dur - MAX_CREDITS_WINDOW_SECONDS) {
          setActiveCreditsSegment({ startSec: seg.startSec, endSec: seg.endSec });
        }
      }
    });

    // 2. Setup Audio Collector (runs silently in the first 180s)
    const collector = new AudioFingerprintCollector();
    audioCollectorRef.current = collector;

    // 3. Setup Credits Detector (runs in background in the final minutes)
    const creditsDetector = new CreditsDetector();
    creditsDetectorRef.current = creditsDetector;

    let lastCheckSample = 0;
    const onSample = (sampleCount: number) => {
      if (hasMatchedIntroRef.current || isCancelled) return;

      // Evaluate every 40 samples (10 seconds) once we have at least 60 samples (15s)
      if (sampleCount >= 60 && sampleCount - lastCheckSample >= 40) {
        lastCheckSample = sampleCount;
        getSeriesFingerprints(parsed.seasonClusterId).then((prevList) => {
          if (hasMatchedIntroRef.current || isCancelled) return;
          const otherEp = prevList.find((f) => f.episode !== parsed.episode && f.fingerprints.length >= 60);
          if (otherEp) {
            const match = findIntroSegment(otherEp.fingerprints, collector.fingerprints);
            if (match.found && match.confidence >= 0.85) {
              hasMatchedIntroRef.current = true;
              setActiveIntroSegment({ startSec: match.startSec, endSec: match.endSec });
              saveContentSegment({
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
      if (videoRef.current && !isCancelled) {
        collector.start(videoRef.current, 180, onSample);
        creditsDetector.start(videoRef.current, (creditsStartSec) => {
          if (isCancelled) return;
          const dur = videoRef.current?.duration || 0;
          // Guard: Only accept credits detected within the genuine credits window
          if (dur > 0 && creditsStartSec < dur - MAX_CREDITS_WINDOW_SECONDS) return;

          const creditsEnd = dur || (creditsStartSec + 60);
          setActiveCreditsSegment({ startSec: creditsStartSec, endSec: creditsEnd });
          saveContentSegment({
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
        saveSeriesFingerprint({
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
  }, [selectedChannel?.url, selectedChannel?.name, selectedChannel?.isVod]);

  // Periodic progress saving & next episode trigger
  useEffect(() => {
    if (!selectedChannel?.isVod || !videoRef.current) return;

    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || !v.duration || isNaN(v.duration) || v.duration <= 0) return;

      const curr = v.currentTime;
      const dur = v.duration;
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

      // Check for Next Episode trigger:
      // Priority 1: When detected credits segment begins (or during credits)
      // Priority 2: Fallback to NEXT_EPISODE_FALLBACK_TRIGGER_BEFORE_END_SECONDS before end
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
  }, [selectedChannel, getProgressItemId, saveProgress, nextEpDismissed, nextEpCountdown, activeCreditsSegment]);

  // Next episode countdown ticker
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

  // Reset check on channel change
  useEffect(() => {
    hasCheckedResumeRef.current = false;
    setResumePrompt(null);
    setNextEpCountdown(null);
    setNextEpDismissed(false);
  }, [selectedChannel?.url]);

  if (!selectedChannel) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] p-4">
        <EmptyState
          icon="📺"
          title="No Channel Selected"
          description="Choose a live channel from the TV Guide or Multiview to start watching."
          primaryAction={{ label: "Go to TV Guide", onClick: () => navigate('/guide') }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] bg-black p-4">
      <GuideTour
        tourKey="player-tour"
        steps={[
          { element: '#video-player', popover: { title: 'Video Player', description: 'This is the main player window.', side: 'bottom' } },
          { element: '#play-pause-btn', popover: { title: 'Play/Pause', description: 'Toggle playback here.' } },
          { element: '#pip-btn', popover: { title: 'Picture in Picture', description: 'Watch while browsing other tabs.' } },
        ]}
      />
      
      <div className="w-full max-w-5xl bg-gray-900 rounded-lg overflow-hidden shadow-2xl relative group">
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-center">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-white font-bold text-xl drop-shadow-md truncate">{selectedChannel.name}</h2>
            {isOfflineMedia && (
              <span className="bg-emerald-600/90 text-white text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow shrink-0">
                <FiHardDrive className="w-3.5 h-3.5" />
                <span>Offline Local</span>
              </span>
            )}
          </div>
          <button
            onClick={() => {
              navigate('/guide');
            }}
            className="text-gray-300 hover:text-white p-1 rounded hover:bg-gray-800 transition"
            title="Close Player"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {playbackError && !isCasting && (
          <div className="absolute inset-0 z-20 bg-black/85 flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-900/50 border border-red-500/50 flex items-center justify-center text-red-400 text-xl font-bold">
              !
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="text-lg font-bold text-white">Stream Unavailable</h3>
              <p className="text-xs text-gray-400">
                {playbackError}. This usually occurs when the channel is temporarily offline at your provider or the stream format is unsupported.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPlaybackError(null);
                  setRetryNonce((n) => n + 1);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition"
              >
                Retry Stream
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaybackError(null);
                  setForceDirect((prev) => !prev);
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-semibold transition border border-gray-600"
              >
                {forceDirect ? 'Switch to Transcoder' : 'Try Direct Stream (Bypass FFmpeg)'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/guide')}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs transition"
              >
                Back to Guide
              </button>
            </div>
          </div>
        )}

        {isCasting ? (
          <div className="w-full h-auto aspect-video bg-black flex flex-col items-center justify-center text-white">
            <FiCast className="w-16 h-16 text-blue-500 mb-4 animate-pulse" />
            <h2 className="text-2xl font-bold">Casting to Screen</h2>
            <p className="text-gray-400 mt-2">{selectedChannel.name}</p>
            {selectedChannel.isVod && (
              <div className="flex items-center gap-4 mt-4">
                <button
                  type="button"
                  onClick={() => handleSeek(-10)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded flex items-center gap-1 text-sm"
                >
                  <FiRotateCcw className="w-4 h-4" /> -10s
                </button>
                <button
                  type="button"
                  onClick={() => handleSeek(30)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded flex items-center gap-1 text-sm"
                >
                  <FiRotateCw className="w-4 h-4" /> +30s
                </button>
              </div>
            )}
            <button
              onClick={stopCasting}
              className="mt-6 px-6 py-2 bg-red-600 hover:bg-red-500 rounded font-semibold transition-colors"
            >
              Stop Casting
            </button>
          </div>
        ) : (
          <video
            id="video-player"
            ref={videoRef}
            crossOrigin="anonymous"
            className="w-full h-auto aspect-video object-contain bg-black"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={handleLoadedMetadata}
            onDurationChange={(e) => {
              const dur = e.currentTarget.duration;
              if (dur && !isNaN(dur) && isFinite(dur)) {
                setDuration(dur);
              }
            }}
          />
        )}

        {/* Resume from where you left off toast/banner */}
        {resumePrompt && (
          <div className="absolute top-16 left-4 z-30 bg-gray-900/95 border border-blue-500/50 shadow-2xl rounded-xl p-3.5 flex items-center gap-3.5 backdrop-blur-md animate-fade-in text-white max-w-sm">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <FiRotateCw className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-300">Resume from where you stopped?</p>
              <p className="text-sm font-bold text-white">{resumePrompt.formatted}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleResumeConfirm}
                className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={handleResumeDismiss}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg transition"
                title="Dismiss"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Skip Intro Floating Overlay */}
        {activeIntroSegment && !introDismissed && currentTime >= activeIntroSegment.startSec && currentTime < activeIntroSegment.endSec && (
          <SkipIntroOverlay
            isVisible={true}
            introEndSec={activeIntroSegment.endSec}
            onSkip={handleSkipIntro}
          />
        )}

        {/* Next Episode Countdown Overlay (Modern Netflix / Streaming style) */}
        {selectedChannel?.nextEpisode && nextEpCountdown !== null && !nextEpDismissed && (
          <div className="absolute bottom-20 right-4 z-30 bg-gray-950/90 border border-blue-500/60 shadow-2xl rounded-2xl p-4 backdrop-blur-md max-w-xs w-full text-white animate-fade-in transition-all">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                Next Episode in {nextEpCountdown}s
              </span>
              <button
                type="button"
                onClick={() => {
                  setNextEpDismissed(true);
                  setNextEpCountdown(null);
                }}
                className="text-gray-400 hover:text-white p-1 rounded transition -mr-1 -mt-1"
                title="Cancel Auto-play"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm font-semibold text-white line-clamp-1 mb-3">
              {selectedChannel.nextEpisode.name}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePlayNextEpisode}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow transition"
              >
                <FiPlay className="w-3.5 h-3.5 fill-current" /> Play Now ({nextEpCountdown}s)
              </button>
              <button
                type="button"
                onClick={() => {
                  setNextEpDismissed(true);
                  setNextEpCountdown(null);
                }}
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
          {selectedChannel.isVod && duration > 0 && (
            <div className="flex items-center gap-3 w-full text-xs text-gray-300 font-mono">
              <span>{formatTime(currentTime)}</span>
              <input
                type="range"
                min="0"
                max={duration}
                step="1"
                value={currentTime}
                onChange={handleProgressBarChange}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg appearance-none"
              />
              <span>{formatTime(duration)}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Tooltip content={(isCasting ? !castIsPaused : isPlaying) ? 'Pause' : 'Play'}>
                <button id="play-pause-btn" onClick={togglePlay} className="text-white hover:text-blue-400">
                  {(isCasting ? !castIsPaused : isPlaying) ? (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  ) : (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                  )}
                </button>
              </Tooltip>

              {selectedChannel.isVod && (
                <div className="flex items-center gap-2">
                  <Tooltip content="Rewind 10s">
                    <button
                      type="button"
                      onClick={() => handleSeek(-10)}
                      className="text-white hover:text-blue-400 p-1"
                    >
                      <FiRotateCcw className="w-5 h-5" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Forward 30s">
                    <button
                      type="button"
                      onClick={() => handleSeek(30)}
                      className="text-white hover:text-blue-400 p-1"
                    >
                      <FiRotateCw className="w-5 h-5" />
                    </button>
                  </Tooltip>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Tooltip content={isMuted ? 'Unmute' : 'Mute'}>
                  <button onClick={toggleMute} className="text-white hover:text-blue-400">
                    {isMuted || volume === 0 ? (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.898a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                    )}
                  </button>
                </Tooltip>
                <input
                  type="range"
                  min="0" max="1" step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    setVolume(parseFloat(e.target.value));
                    if (isMuted && parseFloat(e.target.value) > 0) setIsMuted(false);
                  }}
                  className="w-24 accent-blue-500"
                  disabled={isCasting}
                />
              </div>
            </div>

          <div className="flex items-center gap-4">
            {isAvailable && (
              <Tooltip content={isCasting ? 'Connected' : 'Cast'}>
                <button
                  id="cast-btn"
                  onClick={async () => {
                    console.log('[CAST] Button clicked. isCasting:', isCasting);
                    if (!isCasting) {
                      await requestSession();
                    } else {
                      loadMedia(selectedChannel.url, selectedChannel.name, (selectedChannel as any).logo || '');
                    }
                  }}
                  className={`hover:text-blue-400 cursor-pointer p-1 ${isCasting ? 'text-blue-500' : 'text-white'}`}
                >
                  <FiCast className="w-6 h-6" />
                </button>
              </Tooltip>
            )}
            <Tooltip content={isPip ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}>
              <button id="pip-btn" onClick={togglePip} className="text-white hover:text-blue-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 3H3a2 2 0 00-2 2v14a2 2 0 002 2h18a2 2 0 002-2V5a2 2 0 00-2-2zm-9 11h7v4h-7v-4z" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="Fullscreen">
              <button onClick={() => videoRef.current?.requestFullscreen()} className="text-white hover:text-blue-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </button>
            </Tooltip>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

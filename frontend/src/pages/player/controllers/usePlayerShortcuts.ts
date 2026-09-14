import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SelectedChannel } from '../../../store/uiStore';
import type { IntroSegment } from '../types';
import { useRemoteStore } from '../../../store/remoteStore';
import { usePlaybackStore } from '../../../store/playbackStore';
import { useUiStore } from '../../../store/uiStore';
import { PLAYER_CONFIG } from '../../../constants';

const {
  defaultVolume: DEFAULT_PLAYER_VOLUME,
  volumeStorageKey: VOLUME_STORAGE_KEY,
} = PLAYER_CONFIG;

export interface PlayerShortcutsController {
  readonly isPlaying: boolean;
  readonly setIsPlaying: (playing: boolean) => void;
  readonly currentTime: number;
  readonly setCurrentTime: (time: number) => void;
  readonly duration: number;
  readonly setDuration: (dur: number) => void;
  readonly volume: number;
  readonly isMuted: boolean;
  readonly isPip: boolean;
  readonly playbackSpeed: number;
  readonly isSpeedMenuOpen: boolean;
  readonly setIsSpeedMenuOpen: (open: boolean) => void;
  readonly speedMenuRef: RefObject<HTMLDivElement | null>;
  readonly settingsMenuRef: RefObject<HTMLDivElement | null>;
  readonly isPairingModalOpen: boolean;
  readonly setIsPairingModalOpen: (open: boolean) => void;
  readonly togglePlay: () => void;
  readonly toggleMute: () => void;
  readonly setVolumeLevel: (vol: number) => void;
  readonly handleSeek: (deltaSeconds: number) => void;
  readonly seekToVideoTime: (newTime: number) => void;
  readonly handleProgressBarChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly handleSpeedChange: (speed: number) => void;
  readonly handleRestart: () => void;
  readonly handleTimeUpdate: (time: number) => void;
  readonly togglePip: () => Promise<void>;
  readonly toggleFullscreen: () => void;
  readonly formatTime: (seconds: number) => string;
}

export function usePlayerShortcuts(
  selectedChannel: SelectedChannel | null,
  videoRef: RefObject<HTMLVideoElement | null>,
  realVodDuration: number | null,
  activeIntroSegment: IntroSegment | null,
  isOfflineMedia: boolean,
  isLocalMedia: boolean,
  hasPrevEpisode: boolean,
  hasNextEpisode: boolean,
  handlePlayPrevEpisode: () => void,
  handlePlayNextEpisode: () => void,
  isCasting: boolean,
  castTogglePlay: () => void,
  seekMedia: (delta: number) => void,
  seekToTime: (time: number) => void,
  castCurrentTime: number,
  castDuration: number,
  castVolume: number,
  castIsMuted: boolean,
  setCastVolume: (vol: number) => void,
  toggleCastMute: () => void,
  castIsPaused: boolean,
  setIsSettingsMenuOpen: (open: boolean) => void
): PlayerShortcutsController {
  const navigate = useNavigate();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem(VOLUME_STORAGE_KEY);
    return saved ? parseFloat(saved) : DEFAULT_PLAYER_VOLUME;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);

  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('viniplay_playback_speed');
      return saved ? parseFloat(saved) || 1.0 : 1.0;
    } catch {
      return 1.0;
    }
  });
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      const target = e.target;
      if (speedMenuRef.current && !speedMenuRef.current.contains(target)) {
        setIsSpeedMenuOpen(false);
      }
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(target)) {
        setIsSettingsMenuOpen(false);
      }
    };
    if (isSpeedMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSpeedMenuOpen, setIsSettingsMenuOpen]);

  // Keep video playbackRate synchronized with playbackSpeed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, selectedChannel, videoRef]);

  // Sync volume with HTMLVideoElement and localStorage
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      localStorage.setItem(VOLUME_STORAGE_KEY, volume.toString());
    }
  }, [volume, videoRef]);

  const togglePlay = useCallback(() => {
    if (isCasting) {
      castTogglePlay();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((e: Error) => {
        if (e.name !== 'AbortError') console.error(e);
      });
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [isCasting, castTogglePlay, videoRef]);

  const toggleMute = useCallback(() => {
    if (isCasting) {
      toggleCastMute();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, [isCasting, toggleCastMute, videoRef]);

  const setVolumeLevel = useCallback((newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    if (isCasting) {
      setCastVolume(clamped);
    } else {
      setVolume(clamped);
      if (isMuted && clamped > 0) setIsMuted(false);
    }
  }, [isCasting, setCastVolume, isMuted]);

  const seekToVideoTime = useCallback((newTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(newTime);

    const isLocal = selectedChannel?.url?.startsWith('/api/local-media');
    const realDur = realVodDuration || duration || 0;
    const isContinuousStream =
      !isFinite(video.duration) || video.duration <= 0 || (realDur > 0 && video.duration < realDur * 0.9);

    if (isLocal && isContinuousStream) {
      const currentSrc = video.src || selectedChannel?.url || '';
      const baseUrl = currentSrc.replace(/[?&]seek=\d+/, '');
      const sep = baseUrl.includes('?') ? '&' : '?';
      video.src = `${baseUrl}${sep}seek=${Math.floor(newTime)}`;
      video.load();
      void Promise.resolve(video.play()).catch(() => {});
    } else {
      video.currentTime = newTime;
    }
  }, [videoRef, selectedChannel?.url, realVodDuration, duration]);

  const handleSeek = useCallback((deltaSeconds: number) => {
    if (isCasting) {
      seekMedia(deltaSeconds);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const maxDur =
      duration && isFinite(duration) && duration > 0
        ? duration
        : (realVodDuration && realVodDuration > 0 ? realVodDuration : (video.duration > 0 ? video.duration : 0));
    const target = (video.currentTime || currentTime) + deltaSeconds;
    const newTime = maxDur > 0 ? Math.max(0, Math.min(maxDur, target)) : Math.max(0, target);
    seekToVideoTime(newTime);
  }, [isCasting, seekMedia, videoRef, duration, realVodDuration, currentTime, seekToVideoTime]);

  const handleProgressBarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (isCasting) {
      seekToTime(newTime);
      return;
    }
    seekToVideoTime(newTime);
  }, [isCasting, seekToTime, seekToVideoTime]);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    const rounded = Math.round(Math.max(0.25, Math.min(2.5, newSpeed)) * 100) / 100;
    setPlaybackSpeed(rounded);
    try {
      localStorage.setItem('viniplay_playback_speed', String(rounded));
    } catch {}
    if (videoRef.current) {
      videoRef.current.playbackRate = rounded;
    }
  }, [videoRef]);

  const handleRestart = useCallback(() => {
    if (isCasting) {
      seekToTime(0);
    } else if (videoRef.current) {
      videoRef.current.currentTime = 0;
      setCurrentTime(0);
      void videoRef.current.play().catch(() => {});
    }
  }, [isCasting, seekToTime, videoRef]);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPip(false);
      } else {
        await video.requestPictureInPicture();
        setIsPip(true);
      }
    } catch (e: unknown) {
      console.error('[PlayerShortcuts] PiP failed', e);
    }
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      void video.requestFullscreen().catch(() => {});
    }
  }, [videoRef]);

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

  const lastRemoteSyncRef = useRef<{
    timestamp: number;
    currentTime: number;
    isPaused: boolean;
    channelId?: string;
  }>({
    timestamp: 0,
    currentTime: 0,
    isPaused: true,
  });

  // Remote Control sync: host state to mobile with throttling (max 1x per second during playback, instant on pause/seek/channel change)
  useEffect(() => {
    if (!selectedChannel) return;
    const isPaused = isCasting ? castIsPaused : !isPlaying;
    const effectiveCurrentTime = isCasting ? castCurrentTime : currentTime;
    const effectiveDuration = isCasting
      ? (castDuration > 0 ? castDuration : (duration > 0 ? duration : (selectedChannel.duration ?? 0)))
      : (duration > 0 ? duration : (selectedChannel.duration ?? 0));
    const effectiveVolume = isCasting ? castVolume : volume;
    const effectiveIsMuted = isCasting ? castIsMuted : isMuted;

    const last = lastRemoteSyncRef.current;
    const now = Date.now();
    const isChannelChanged = last.channelId !== selectedChannel.id;
    const isPauseStateChanged = last.isPaused !== isPaused;
    const isSeekJump = Math.abs(effectiveCurrentTime - last.currentTime) > 3;
    const isThrottled = now - last.timestamp < 1000;

    if (!isChannelChanged && !isPauseStateChanged && !isSeekJump && isThrottled) {
      return;
    }

    lastRemoteSyncRef.current = {
      timestamp: now,
      currentTime: effectiveCurrentTime,
      isPaused,
      channelId: selectedChannel.id,
    };

    useRemoteStore.getState().syncHostPlayback({
      title: selectedChannel.name,
      subtitle: selectedChannel.seriesContext
        ? `T${selectedChannel.seriesContext.season} E${selectedChannel.seriesContext.episodeIndex}`
        : undefined,
      logo: selectedChannel.logo,
      streamUrl: selectedChannel.url,
      isVod: Boolean(selectedChannel.isVod),
      isLive: !selectedChannel.isVod,
      isPaused,
      currentTime: effectiveCurrentTime,
      duration: effectiveDuration,
      volume: effectiveVolume,
      isMuted: effectiveIsMuted,
      isOffline: isOfflineMedia,
      isLocal: isLocalMedia,
      isCasting,
      hasPrevEpisode,
      hasNextEpisode,
      playbackRate: playbackSpeed,
      seriesContext: selectedChannel.seriesContext,
      introDetection: activeIntroSegment
        ? { canSkip: true, introEnd: activeIntroSegment.endSec }
        : undefined,
    });
  }, [
    selectedChannel,
    isCasting,
    castIsPaused,
    castCurrentTime,
    castDuration,
    castVolume,
    castIsMuted,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isOfflineMedia,
    isLocalMedia,
    hasPrevEpisode,
    hasNextEpisode,
    activeIntroSegment,
    playbackSpeed,
  ]);

  // Execute commands received from remote mobile client
  useEffect(() => {
    const unsub = useRemoteStore.getState().setHostCommandListener((msg) => {
      if (msg.type === 'REQUEST_SYNC') {
        const pb = usePlaybackStore.getState();
        useRemoteStore.getState().syncHostUserContext({
          favorites: pb.favorites,
          watchedSummary: pb.watchedSummary,
          progress: pb.progress,
        });
      } else if (msg.type === 'COMMAND_TOGGLE_FAVORITE') {
        usePlaybackStore.getState().toggleFavorite(msg.payload.id);
      } else if (msg.type === 'COMMAND_PLAY_PAUSE') {
        togglePlay();
      } else if (msg.type === 'COMMAND_SEEK') {
        if (msg.payload.deltaSeconds) {
          handleSeek(msg.payload.deltaSeconds);
        } else if (msg.payload.positionSeconds !== undefined) {
          if (isCasting) {
            seekToTime(msg.payload.positionSeconds);
          } else if (videoRef.current) {
            videoRef.current.currentTime = msg.payload.positionSeconds;
            setCurrentTime(msg.payload.positionSeconds);
          }
        }
      } else if (msg.type === 'COMMAND_VOLUME') {
        if (msg.payload.delta) {
          const currentVol = isCasting ? castVolume : volume;
          const nextVol = Math.max(0, Math.min(1, currentVol + msg.payload.delta));
          if (isCasting) {
            setCastVolume(nextVol);
          } else {
            setVolume(nextVol);
          }
        } else if (msg.payload.setVolume !== undefined) {
          if (isCasting) {
            setCastVolume(msg.payload.setVolume);
          } else {
            setVolume(Math.max(0, Math.min(1, msg.payload.setVolume)));
          }
        } else if (msg.payload.toggleMute) {
          if (isCasting) {
            toggleCastMute();
          } else {
            toggleMute();
          }
        }
      } else if (msg.type === 'COMMAND_PLAY_MEDIA') {
        const { id, name, url, logo, isVod, seriesContext } = msg.payload;
        const current = useUiStore.getState().selectedChannel;
        if (current?.id !== id || current?.url !== url) {
          useUiStore.getState().setSelectedChannel({
            id,
            name,
            url,
            logo,
            isVod: Boolean(isVod),
            seriesContext,
            offlineFileName: current?.offlineFileName,
            isOffline: current?.isOffline,
          });
        }
      } else if (msg.type === 'COMMAND_SKIP_INTRO') {
        if (activeIntroSegment) {
          if (isCasting) {
            seekMedia(activeIntroSegment.endSec - currentTime);
          } else if (videoRef.current) {
            videoRef.current.currentTime = activeIntroSegment.endSec;
            setCurrentTime(activeIntroSegment.endSec);
          }
        }
      } else if (msg.type === 'COMMAND_PREV_EPISODE') {
        handlePlayPrevEpisode();
      } else if (msg.type === 'COMMAND_NEXT_EPISODE') {
        handlePlayNextEpisode();
      } else if (msg.type === 'COMMAND_PLAYBACK_SPEED') {
        handleSpeedChange(msg.payload.speed);
      } else if (msg.type === 'COMMAND_RESTART') {
        handleRestart();
      } else if (msg.type === 'COMMAND_DPAD') {
        const { key } = msg.payload;

        if (key === 'left') {
          handleSeek(-10);
        } else if (key === 'right') {
          handleSeek(10);
        } else if (key === 'up') {
          if (isCasting) {
            setCastVolume(Math.min(1, castVolume + 0.01));
          } else {
            setVolume((prev) => Math.min(1, prev + 0.01));
          }
        } else if (key === 'down') {
          if (isCasting) {
            setCastVolume(Math.max(0, castVolume - 0.01));
          } else {
            setVolume((prev) => Math.max(0, prev - 0.01));
          }
        } else if (key === 'select') {
          if (activeIntroSegment) {
            if (isCasting) {
              seekMedia(activeIntroSegment.endSec - currentTime);
            } else if (videoRef.current) {
              videoRef.current.currentTime = activeIntroSegment.endSec;
              setCurrentTime(activeIntroSegment.endSec);
            }
          } else {
            togglePlay();
          }
        } else if (key === 'back') {
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            navigate(-1);
          }
        } else if (key === 'menu') {
          const controls = document.querySelector('.group-hover\\:opacity-100');
          if (controls) {
            controls.classList.toggle('opacity-100');
          }
        }

        const keyMap: Record<string, string> = {
          up: 'ArrowUp',
          down: 'ArrowDown',
          left: 'ArrowLeft',
          right: 'ArrowRight',
          select: 'Enter',
          back: 'Escape',
          menu: 'ContextMenu',
        };
        const mappedKey = keyMap[key];
        if (mappedKey) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: mappedKey, bubbles: true }));
        }
      }
    });

    return () => unsub();
  }, [
    togglePlay,
    handleSeek,
    isCasting,
    currentTime,
    seekMedia,
    seekToTime,
    castVolume,
    setCastVolume,
    activeIntroSegment,
    toggleMute,
    navigate,
    handlePlayPrevEpisode,
    handlePlayNextEpisode,
    handleSpeedChange,
    handleRestart,
    videoRef,
    volume,
  ]);

  const handleTimeUpdate = useCallback((newTime: number) => {
    setCurrentTime(newTime);
  }, []);

  return {
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    volume,
    isMuted,
    isPip,
    playbackSpeed,
    isSpeedMenuOpen,
    setIsSpeedMenuOpen,
    speedMenuRef,
    settingsMenuRef,
    isPairingModalOpen,
    setIsPairingModalOpen,
    togglePlay,
    toggleMute,
    setVolumeLevel,
    handleSeek,
    seekToVideoTime,
    handleProgressBarChange,
    handleSpeedChange,
    handleRestart,
    handleTimeUpdate,
    togglePip,
    toggleFullscreen,
    formatTime,
  };
}

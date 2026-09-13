import { useRef, useCallback, useEffect, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import type Hls from 'hls.js';
import { useUiStore, type SelectedChannel } from '../../store/uiStore';
import { useConfig } from '../../api/guide';
import { useCast } from '../../components/cast/CastProvider';
import { getDownloadTask } from '../../services/db';
import { ensureBackendMediaAvailable } from '../../services/localMediaSync';
import type {
  PlayerLoadingStage,
  PlayerErrorInfo,
  AudioTrackOption,
  SubtitleTrackOption,
  VideoLevelOption,
  IntroSegment,
  ResumePrompt,
  TranscriptionJob,
} from './types';

import { usePlayerTracksController } from './controllers/usePlayerTracksController';
import { useTranscriptionController } from './controllers/useTranscriptionController';
import { useVodPlaybackController } from './controllers/useVodPlaybackController';
import { useDvrPlaybackController } from './controllers/useDvrPlaybackController';
import { usePlayerEngine } from './controllers/usePlayerEngine';
import { usePlayerShortcuts } from './controllers/usePlayerShortcuts';

export interface PlayerControllerState {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly selectedChannel: SelectedChannel | null;
  readonly isCasting: boolean;
  readonly isAvailable: boolean;
  readonly isConnected: boolean;
  readonly castIsPaused: boolean;
  readonly castCurrentTime: number;
  readonly castDuration: number;
  readonly castVolume: number;
  readonly castIsMuted: boolean;
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly volume: number;
  readonly isMuted: boolean;
  readonly isPip: boolean;
  readonly playbackSpeed: number;
  readonly isSpeedMenuOpen: boolean;
  readonly isSettingsMenuOpen: boolean;
  readonly isPairingModalOpen: boolean;
  readonly speedMenuRef: RefObject<HTMLDivElement | null>;
  readonly settingsMenuRef: RefObject<HTMLDivElement | null>;
  readonly loadingStage: PlayerLoadingStage;
  readonly playbackError: PlayerErrorInfo | null;
  readonly forceDirect: boolean;
  readonly isOfflineMedia: boolean;
  readonly isLocalMedia: boolean;
  readonly audioTracks: readonly AudioTrackOption[];
  readonly subtitleTracks: readonly SubtitleTrackOption[];
  readonly videoLevels: readonly VideoLevelOption[];
  readonly activeAudioTrack: number;
  readonly activeSubtitleTrack: number | string;
  readonly activeVideoLevel: number;
  readonly transcriptionJob: TranscriptionJob | null;
  readonly resumePrompt: ResumePrompt | null;
  readonly activeIntroSegment: IntroSegment | null;
  readonly introDismissed: boolean;
  readonly nextEpCountdown: number | null;
  readonly hasPrevEpisode: boolean;
  readonly hasNextEpisode: boolean;
  readonly isLiveStream: boolean;
  readonly isTimeshifted: boolean;
}

export interface PlayerControllerActions {
  readonly togglePlay: () => void;
  readonly toggleMute: () => void;
  readonly setVolumeLevel: (vol: number) => void;
  readonly handleSeek: (deltaSeconds: number) => void;
  readonly handleProgressBarChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly handleTimeUpdate: (time: number) => void;
  readonly handleSpeedChange: (speed: number) => void;
  readonly handleRestart: () => void;
  readonly togglePip: () => Promise<void>;
  readonly toggleFullscreen: () => void;
  readonly formatTime: (seconds: number) => string;
  readonly setIsSpeedMenuOpen: (open: boolean) => void;
  readonly setIsSettingsMenuOpen: (open: boolean) => void;
  readonly setIsPairingModalOpen: (open: boolean) => void;
  readonly changeAudioTrack: (id: number) => void;
  readonly changeSubtitleTrack: (id: number | string) => void;
  readonly changeVideoLevel: (index: number) => void;
  readonly startTranscription: () => Promise<void>;
  readonly handleResumeConfirm: () => void;
  readonly handleResumeDismiss: () => void;
  readonly handleSkipIntro: (targetSec: number) => void;
  readonly handlePlayPrevEpisode: () => void;
  readonly handlePlayNextEpisode: () => void;
  readonly cancelNextEpCountdown: () => void;
  readonly handleLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleDurationChange: (dur: number) => void;
  readonly handleVideoEnded: () => void;
  readonly retryStream: () => void;
  readonly toggleDirectStream: () => void;
  readonly fallbackToOnlineStream: () => void;
  readonly requestCastSession: () => Promise<void>;
  readonly stopCasting: () => void;
  readonly navigateBack: () => void;
}

export interface PlayerController {
  readonly state: PlayerControllerState;
  readonly actions: PlayerControllerActions;
}

export function usePlayerController(): PlayerController {
  const navigate = useNavigate();
  const selectedChannel = useUiStore((s) => s.selectedChannel);
  const setSelectedChannel = useUiStore((s) => s.setSelectedChannel);
  const { data: config } = useConfig();

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastCastedKeyRef = useRef<string | null>(null);

  const {
    isAvailable,
    isCasting,
    isConnected,
    requestSession,
    loadMedia,
    togglePlayPause: castTogglePlay,
    stopCasting,
    isPaused: castIsPaused,
    seekMedia,
    seekToTime,
    castCurrentTime,
    castDuration,
    castVolume,
    castIsMuted,
    setCastVolume,
    toggleCastMute,
  } = useCast();

  // Tracks controller (audio, subtitles, levels)
  const hlsHolderRef = useRef<Hls | null>(null);
  const tracksCtrl = usePlayerTracksController(videoRef, hlsHolderRef);

  // Engine controller
  const engineCtrl = usePlayerEngine(
    selectedChannel,
    config?.settings,
    videoRef,
    tracksCtrl.setVideoLevels,
    tracksCtrl.setActiveVideoLevel,
    tracksCtrl.setAudioTracks,
    tracksCtrl.setActiveAudioTrack,
    tracksCtrl.setSubtitleTracks,
    tracksCtrl.setActiveSubtitleTrack
  );

  // Keep hlsHolderRef in sync with engine's hlsRef
  hlsHolderRef.current = engineCtrl.hlsRef.current;

  // Shortcuts & basic playback state controller
  const shortcutsCtrl = usePlayerShortcuts(
    selectedChannel,
    videoRef,
    null, // realVodDuration resolved in VOD controller
    null, // activeIntroSegment resolved in VOD controller
    engineCtrl.isOfflineMedia,
    engineCtrl.isLocalMedia,
    false, // resolved in VOD controller
    false, // resolved in VOD controller
    () => {}, // resolved in VOD controller
    () => {}, // resolved in VOD controller
    isCasting,
    castTogglePlay,
    seekMedia,
    seekToTime,
    castCurrentTime,
    castDuration,
    castVolume,
    castIsMuted,
    setCastVolume,
    toggleCastMute,
    castIsPaused,
    tracksCtrl.setIsSettingsMenuOpen
  );

  // VOD playback controller
  const vodCtrl = useVodPlaybackController(
    selectedChannel,
    setSelectedChannel,
    videoRef,
    shortcutsCtrl.duration,
    shortcutsCtrl.setDuration,
    shortcutsCtrl.setCurrentTime,
    shortcutsCtrl.playbackSpeed,
    isCasting,
    castIsPaused,
    castCurrentTime,
    castDuration,
    config?.settings?.activeUserAgentId
  );

  // DVR & Live controller
  const dvrCtrl = useDvrPlaybackController(
    selectedChannel,
    shortcutsCtrl.currentTime,
    shortcutsCtrl.duration,
    shortcutsCtrl.seekToVideoTime
  );

  // Transcription controller
  const progressItemId = vodCtrl.getProgressItemId();
  const transcriptionCtrl = useTranscriptionController(
    progressItemId || null,
    selectedChannel?.url,
    Boolean(selectedChannel?.isVod),
    videoRef,
    tracksCtrl.setSubtitleTracks
  );

  const resolveLocalDownloadFileName = useCallback(async (channel: SelectedChannel): Promise<string | null> => {
    if (!channel) return null;
    if (channel.offlineFileName) return channel.offlineFileName;

    const candidateIds = [
      channel.id,
      `movie_${channel.id}`,
      channel.seriesContext
        ? `${channel.seriesContext.seriesId}_s${channel.seriesContext.season}_e${channel.seriesContext.episodeIndex}`
        : null,
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);

    for (const cid of candidateIds) {
      const task = await getDownloadTask(cid);
      if (task && task.status === 'completed' && task.fileName) {
        return task.fileName;
      }
    }
    return null;
  }, []);

  const prepareCastMedia = useCallback(
    async (channel: SelectedChannel): Promise<{ targetUrl: string; isOffline: boolean }> => {
      let targetUrl = channel.url;
      let isOffline = false;

      if (channel.url.startsWith('/api/local-media')) {
        return { targetUrl: channel.url, isOffline: true };
      }

      if (channel.isVod) {
        const localFileName = await resolveLocalDownloadFileName(channel);
        if (localFileName) {
          try {
            const syncResult = await ensureBackendMediaAvailable(localFileName);
            if (syncResult.available && syncResult.streamUrl) {
              targetUrl = syncResult.streamUrl;
              isOffline = true;
            }
          } catch (err: unknown) {
            console.warn('[PlayerController] Failed to sync local media for cast:', err);
          }
        }
      }

      return { targetUrl, isOffline };
    },
    [resolveLocalDownloadFileName]
  );

  // Handle Chromecast loading
  useEffect(() => {
    let isCancelled = false;

    if (!isCasting || !isConnected) {
      lastCastedKeyRef.current = null;
      return;
    }

    if (isCasting && isConnected && selectedChannel) {
      const channelKey = `${selectedChannel.id || selectedChannel.url}::${selectedChannel.url}`;
      if (lastCastedKeyRef.current === channelKey) {
        return;
      }
      lastCastedKeyRef.current = channelKey;

      if (engineCtrl.playerRef.current) {
        try {
          engineCtrl.playerRef.current.pause();
          engineCtrl.playerRef.current.unload();
          engineCtrl.playerRef.current.detachMediaElement();
          engineCtrl.playerRef.current.destroy();
        } catch {
          // Ignore teardown error
        }
      }

      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {
          // Ignore
        }
      }

      const initialSeek =
        videoRef.current && videoRef.current.currentTime > 5 ? Math.floor(videoRef.current.currentTime) : 0;

      const knownDur =
        (vodCtrl.realVodDuration && vodCtrl.realVodDuration > 0 ? vodCtrl.realVodDuration : undefined) ??
        (selectedChannel.duration && selectedChannel.duration > 0 ? selectedChannel.duration : undefined) ??
        (shortcutsCtrl.duration > 0 ? shortcutsCtrl.duration : undefined);

      void prepareCastMedia(selectedChannel).then(({ targetUrl }) => {
        if (isCancelled) return;
        loadMedia(
          targetUrl,
          selectedChannel.name,
          selectedChannel.logo ?? '',
          Boolean(selectedChannel.isVod),
          selectedChannel.originalUrl ?? selectedChannel.url,
          initialSeek,
          knownDur
        );
      });
    }

    return () => {
      isCancelled = true;
    };
  }, [isCasting, isConnected, selectedChannel, loadMedia, prepareCastMedia, engineCtrl.playerRef, vodCtrl.realVodDuration, shortcutsCtrl.duration]);

  const requestCastSession = useCallback(async () => {
    if (!isCasting) {
      await requestSession();
    } else if (selectedChannel) {
      const channelKey = `${selectedChannel.id || selectedChannel.url}::${selectedChannel.url}`;
      lastCastedKeyRef.current = channelKey;
      const initialSeek =
        videoRef.current && videoRef.current.currentTime > 5 ? Math.floor(videoRef.current.currentTime) : 0;
      const knownDur =
        (vodCtrl.realVodDuration && vodCtrl.realVodDuration > 0 ? vodCtrl.realVodDuration : undefined) ??
        (selectedChannel.duration && selectedChannel.duration > 0 ? selectedChannel.duration : undefined) ??
        (shortcutsCtrl.duration > 0 ? shortcutsCtrl.duration : undefined);
      const { targetUrl } = await prepareCastMedia(selectedChannel);

      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {
          // Ignore
        }
      }

      loadMedia(
        targetUrl,
        selectedChannel.name,
        selectedChannel.logo ?? '',
        Boolean(selectedChannel.isVod),
        selectedChannel.originalUrl ?? selectedChannel.url,
        initialSeek,
        knownDur
      );
    }
  }, [isCasting, requestSession, selectedChannel, vodCtrl.realVodDuration, shortcutsCtrl.duration, prepareCastMedia, loadMedia]);

  const navigateBack = useCallback(() => {
    navigate('/guide');
  }, [navigate]);

  const effectiveCastDuration =
    castDuration > 0
      ? castDuration
      : (shortcutsCtrl.duration > 0
          ? shortcutsCtrl.duration
          : ((selectedChannel?.duration && selectedChannel.duration > 0 ? selectedChannel.duration : undefined) ??
             (vodCtrl.realVodDuration && vodCtrl.realVodDuration > 0 ? vodCtrl.realVodDuration : 0)));

  return {
    state: {
      videoRef,
      selectedChannel,
      isCasting,
      isAvailable,
      isConnected,
      castIsPaused,
      castCurrentTime,
      castDuration: effectiveCastDuration,
      castVolume,
      castIsMuted,
      isPlaying: shortcutsCtrl.isPlaying,
      currentTime: shortcutsCtrl.currentTime,
      duration: shortcutsCtrl.duration,
      volume: shortcutsCtrl.volume,
      isMuted: shortcutsCtrl.isMuted,
      isPip: shortcutsCtrl.isPip,
      playbackSpeed: shortcutsCtrl.playbackSpeed,
      isSpeedMenuOpen: shortcutsCtrl.isSpeedMenuOpen,
      isSettingsMenuOpen: tracksCtrl.isSettingsMenuOpen,
      isPairingModalOpen: shortcutsCtrl.isPairingModalOpen,
      speedMenuRef: shortcutsCtrl.speedMenuRef,
      settingsMenuRef: shortcutsCtrl.settingsMenuRef,
      loadingStage: engineCtrl.loadingStage,
      playbackError: engineCtrl.playbackError,
      forceDirect: engineCtrl.forceDirect,
      isOfflineMedia: engineCtrl.isOfflineMedia,
      isLocalMedia: engineCtrl.isLocalMedia,
      audioTracks: tracksCtrl.audioTracks,
      subtitleTracks: tracksCtrl.subtitleTracks,
      videoLevels: tracksCtrl.videoLevels,
      activeAudioTrack: tracksCtrl.activeAudioTrack,
      activeSubtitleTrack: tracksCtrl.activeSubtitleTrack,
      activeVideoLevel: tracksCtrl.activeVideoLevel,
      transcriptionJob: transcriptionCtrl.transcriptionJob,
      resumePrompt: vodCtrl.resumePrompt,
      activeIntroSegment: vodCtrl.activeIntroSegment,
      introDismissed: vodCtrl.introDismissed,
      nextEpCountdown: vodCtrl.nextEpCountdown,
      hasPrevEpisode: vodCtrl.hasPrevEpisode,
      hasNextEpisode: vodCtrl.hasNextEpisode,
      isLiveStream: dvrCtrl.isLiveStream,
      isTimeshifted: dvrCtrl.isTimeshifted,
    },
    actions: {
      togglePlay: shortcutsCtrl.togglePlay,
      toggleMute: shortcutsCtrl.toggleMute,
      setVolumeLevel: shortcutsCtrl.setVolumeLevel,
      handleSeek: shortcutsCtrl.handleSeek,
      handleProgressBarChange: shortcutsCtrl.handleProgressBarChange,
      handleTimeUpdate: shortcutsCtrl.handleTimeUpdate,
      handleSpeedChange: shortcutsCtrl.handleSpeedChange,
      handleRestart: shortcutsCtrl.handleRestart,
      togglePip: shortcutsCtrl.togglePip,
      toggleFullscreen: shortcutsCtrl.toggleFullscreen,
      formatTime: shortcutsCtrl.formatTime,
      setIsSpeedMenuOpen: shortcutsCtrl.setIsSpeedMenuOpen,
      setIsSettingsMenuOpen: tracksCtrl.setIsSettingsMenuOpen,
      setIsPairingModalOpen: shortcutsCtrl.setIsPairingModalOpen,
      changeAudioTrack: tracksCtrl.changeAudioTrack,
      changeSubtitleTrack: tracksCtrl.changeSubtitleTrack,
      changeVideoLevel: tracksCtrl.changeVideoLevel,
      startTranscription: transcriptionCtrl.startTranscription,
      handleResumeConfirm: vodCtrl.handleResumeConfirm,
      handleResumeDismiss: vodCtrl.handleResumeDismiss,
      handleSkipIntro: vodCtrl.handleSkipIntro,
      handlePlayPrevEpisode: vodCtrl.handlePlayPrevEpisode,
      handlePlayNextEpisode: vodCtrl.handlePlayNextEpisode,
      cancelNextEpCountdown: vodCtrl.cancelNextEpCountdown,
      handleLoadedMetadata: vodCtrl.handleLoadedMetadata,
      handleDurationChange: vodCtrl.handleDurationChange,
      handleVideoEnded: vodCtrl.handleVideoEnded,
      retryStream: engineCtrl.retryStream,
      toggleDirectStream: engineCtrl.toggleDirectStream,
      fallbackToOnlineStream: engineCtrl.fallbackToOnlineStream,
      requestCastSession,
      stopCasting,
      navigateBack,
    },
  };
}

import { useState, useCallback, type RefObject } from 'react';
import type Hls from 'hls.js';
import type { AudioTrackOption, SubtitleTrackOption, VideoLevelOption } from '../types';

export interface PlayerTracksController {
  readonly audioTracks: readonly AudioTrackOption[];
  readonly subtitleTracks: readonly SubtitleTrackOption[];
  readonly videoLevels: readonly VideoLevelOption[];
  readonly activeAudioTrack: number;
  readonly activeSubtitleTrack: number | string;
  readonly activeVideoLevel: number;
  readonly isSettingsMenuOpen: boolean;
  readonly setIsSettingsMenuOpen: (open: boolean) => void;
  readonly setAudioTracks: (tracks: readonly AudioTrackOption[]) => void;
  readonly setSubtitleTracks: (tracks: readonly SubtitleTrackOption[] | ((prev: readonly SubtitleTrackOption[]) => readonly SubtitleTrackOption[])) => void;
  readonly setVideoLevels: (levels: readonly VideoLevelOption[]) => void;
  readonly setActiveAudioTrack: (trackId: number) => void;
  readonly setActiveSubtitleTrack: (trackId: number | string) => void;
  readonly setActiveVideoLevel: (levelIndex: number) => void;
  readonly changeAudioTrack: (trackId: number) => void;
  readonly changeSubtitleTrack: (trackId: number | string) => void;
  readonly changeVideoLevel: (levelIndex: number) => void;
  readonly resetTracks: () => void;
}

export function usePlayerTracksController(
  videoRef: RefObject<HTMLVideoElement | null>,
  hlsRef: RefObject<Hls | null>
): PlayerTracksController {
  const [audioTracks, setAudioTracks] = useState<readonly AudioTrackOption[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<readonly SubtitleTrackOption[]>([]);
  const [videoLevels, setVideoLevels] = useState<readonly VideoLevelOption[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(-1);
  const [activeSubtitleTrack, setActiveSubtitleTrack] = useState<number | string>(-1);
  const [activeVideoLevel, setActiveVideoLevel] = useState<number>(-1);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);

  const changeAudioTrack = useCallback((trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
      setActiveAudioTrack(trackId);
    }
  }, [hlsRef]);

  const changeSubtitleTrack = useCallback((trackId: number | string) => {
    const video = videoRef.current;
    const element = video ? video.querySelector('track#custom-subtitle') : null;
    const customTrack = element instanceof HTMLTrackElement ? element : null;

    if (trackId === 'custom-ia') {
      if (customTrack) {
        customTrack.track.mode = 'showing';
      }
      if (hlsRef.current) {
        hlsRef.current.subtitleDisplay = false;
      }
      setActiveSubtitleTrack(trackId);
      return;
    }

    if (customTrack) {
      customTrack.track.mode = 'hidden';
    }

    if (hlsRef.current) {
      hlsRef.current.subtitleDisplay = true;
      const numId = typeof trackId === 'number' ? trackId : -1;
      hlsRef.current.subtitleTrack = numId;
      setActiveSubtitleTrack(numId);
    } else {
      setActiveSubtitleTrack(trackId);
    }
  }, [hlsRef, videoRef]);

  const changeVideoLevel = useCallback((levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setActiveVideoLevel(levelIndex);
    }
  }, [hlsRef]);

  const resetTracks = useCallback(() => {
    setAudioTracks([]);
    setSubtitleTracks([]);
    setVideoLevels([]);
    setActiveAudioTrack(-1);
    setActiveSubtitleTrack(-1);
    setActiveVideoLevel(-1);
    setIsSettingsMenuOpen(false);
  }, []);

  return {
    audioTracks,
    subtitleTracks,
    videoLevels,
    activeAudioTrack,
    activeSubtitleTrack,
    activeVideoLevel,
    isSettingsMenuOpen,
    setIsSettingsMenuOpen,
    setAudioTracks,
    setSubtitleTracks,
    setVideoLevels,
    setActiveAudioTrack,
    setActiveSubtitleTrack,
    setActiveVideoLevel,
    changeAudioTrack,
    changeSubtitleTrack,
    changeVideoLevel,
    resetTracks,
  };
}

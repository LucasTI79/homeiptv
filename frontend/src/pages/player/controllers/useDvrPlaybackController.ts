import { useMemo, useCallback } from 'react';
import type { SelectedChannel } from '../../../store/uiStore';

export interface DvrPlaybackController {
  readonly isLiveStream: boolean;
  readonly isTimeshifted: boolean;
  readonly liveSyncToEdge: () => void;
}

export function useDvrPlaybackController(
  selectedChannel: SelectedChannel | null,
  currentTime: number,
  duration: number,
  seekToVideoTime: (time: number) => void
): DvrPlaybackController {
  const isLiveStream = useMemo(() => {
    return !selectedChannel?.isVod;
  }, [selectedChannel?.isVod]);

  const isTimeshifted = useMemo(() => {
    if (!isLiveStream || duration <= 0) return false;
    return duration - currentTime > 15;
  }, [isLiveStream, duration, currentTime]);

  const liveSyncToEdge = useCallback(() => {
    if (isLiveStream && duration > 0) {
      seekToVideoTime(duration);
    }
  }, [isLiveStream, duration, seekToVideoTime]);

  return {
    isLiveStream,
    isTimeshifted,
    liveSyncToEdge,
  };
}

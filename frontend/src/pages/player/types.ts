export type PlaybackEngineType = 'hls' | 'mpegts' | 'native' | 'opfs';

export interface AudioTrackOption {
  readonly id: number;
  readonly name?: string;
  readonly lang?: string;
}

export interface SubtitleTrackOption {
  readonly id: number | string;
  readonly name?: string;
  readonly lang?: string;
}

export interface VideoLevelOption {
  readonly id: number;
  readonly height?: number;
  readonly bitrate?: number;
  readonly name?: string;
}

export type PlayerLoadingStage =
  | 'idle'
  | 'checking_cache'
  | 'probing_duration'
  | 'loading_stream'
  | 'buffering';

export interface PlayerErrorInfo {
  readonly message: string;
  readonly details?: string;
  readonly canRetry: boolean;
  readonly canFallbackOnline: boolean;
  readonly canToggleTranscoder: boolean;
}

export interface CastErrorInfo {
  readonly message: string;
  readonly code?: string;
  readonly resolutionHint: string;
}

export type TranscriptionStatus =
  | 'idle'
  | 'queued'
  | 'extracting_audio'
  | 'transcribing'
  | 'completed'
  | 'failed';

export interface TranscriptionJob {
  readonly status: TranscriptionStatus;
  readonly progress?: number;
  readonly error?: string;
}

export interface IntroSegment {
  readonly startSec: number;
  readonly endSec: number;
}

export interface ResumePrompt {
  readonly time: number;
  readonly formatted: string;
}

export interface NextEpisodeData {
  readonly url: string;
  readonly name: string;
  readonly season: string;
  readonly episodeIndex: number;
}

export interface RemoteNowPlayingState {
  title: string;
  subtitle?: string;
  logo?: string;
  streamUrl?: string;
  isVod: boolean;
  isLive: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isOffline?: boolean;
  isLocal?: boolean;
  isCasting?: boolean;
  seriesContext?: {
    seriesId: string;
    season: string | number;
    episodeIndex: number;
    totalEpisodes?: number;
  };
  introDetection?: {
    canSkip: boolean;
    introEnd: number;
  };
  hasPrevEpisode?: boolean;
  hasNextEpisode?: boolean;
  playbackRate?: number;
}

export interface RemoteSession {
  sessionId: string;
  pinCode: string;
  hostDeviceId: string;
  createdAt: number;
  lastActiveAt: number;
  nowPlaying?: RemoteNowPlayingState;
  userContext?: RemoteUserContext;
}

export interface RemoteUserContext {
  favorites: string[];
  watchedSummary: {
    seriesCounts: Record<string, number>;
    movieIds: string[];
    watchedEpisodeIds?: string[];
  };
  progress: Record<string, any>;
  completedDownloads?: string[];
}

export type RemoteDpadKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'menu';

export type RemoteMessage =
  | { type: 'SYNC_STATE'; payload: RemoteNowPlayingState }
  | { type: 'SYNC_USER_CONTEXT'; payload: RemoteUserContext }
  | { type: 'SESSION_PAIRED'; payload: { clientCount: number } }
  | { type: 'HOST_DISCONNECTED' }
  | { type: 'COMMAND_PLAY_PAUSE' }
  | { type: 'COMMAND_SEEK'; payload: { deltaSeconds?: number; positionSeconds?: number } }
  | { type: 'COMMAND_VOLUME'; payload: { delta?: number; setVolume?: number; toggleMute?: boolean } }
  | { type: 'COMMAND_PLAYBACK_SPEED'; payload: { speed: number } }
  | { type: 'COMMAND_PLAY_MEDIA'; payload: { id: string; name: string; url: string; logo?: string; isVod?: boolean; seriesContext?: any } }
  | { type: 'COMMAND_SKIP_INTRO' }
  | { type: 'COMMAND_PREV_EPISODE' }
  | { type: 'COMMAND_NEXT_EPISODE' }
  | { type: 'COMMAND_RESTART' }
  | { type: 'COMMAND_DPAD'; payload: { key: RemoteDpadKey } }
  | { type: 'COMMAND_INPUT_TEXT'; payload: { text: string; submit?: boolean } }
  | { type: 'COMMAND_TOGGLE_FAVORITE'; payload: { id: string } }
  | { type: 'REQUEST_SYNC' }
  | { type: 'PING' }
  | { type: 'PONG' };

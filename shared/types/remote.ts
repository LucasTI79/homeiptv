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
  seriesContext?: {
    seriesId: string;
    season: number;
    episodeIndex: number;
    totalEpisodes?: number;
  };
  introDetection?: {
    canSkip: boolean;
    introEnd: number;
  };
}

export interface RemoteSession {
  sessionId: string;
  pinCode: string;
  hostDeviceId: string;
  createdAt: number;
  lastActiveAt: number;
  nowPlaying?: RemoteNowPlayingState;
}

export type RemoteDpadKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'menu';

export type RemoteMessage =
  | { type: 'SYNC_STATE'; payload: RemoteNowPlayingState }
  | { type: 'SESSION_PAIRED'; payload: { clientCount: number } }
  | { type: 'HOST_DISCONNECTED' }
  | { type: 'COMMAND_PLAY_PAUSE' }
  | { type: 'COMMAND_SEEK'; payload: { deltaSeconds?: number; positionSeconds?: number } }
  | { type: 'COMMAND_VOLUME'; payload: { delta?: number; setVolume?: number; toggleMute?: boolean } }
  | { type: 'COMMAND_PLAY_MEDIA'; payload: { id: string; name: string; url: string; logo?: string; isVod?: boolean; seriesContext?: any } }
  | { type: 'COMMAND_SKIP_INTRO' }
  | { type: 'COMMAND_NEXT_EPISODE' }
  | { type: 'COMMAND_DPAD'; payload: { key: RemoteDpadKey } }
  | { type: 'COMMAND_INPUT_TEXT'; payload: { text: string; submit?: boolean } }
  | { type: 'REQUEST_SYNC' }
  | { type: 'PING' }
  | { type: 'PONG' };

export interface UserAgentProfile {
  id: string;
  name: string;
  value: string;
  isDefault?: boolean;
}

export interface StreamProfile {
  id: string;
  name: string;
  command: string;
  isDefault?: boolean;
}

export interface DvrRecordingProfile {
  id: string;
  name: string;
  command: string;
  isDefault?: boolean;
}

export interface CastProfile {
  id: string;
  name: string;
  command: string;
  isDefault?: boolean;
}

export interface DvrSettings {
  preBufferMinutes: number;
  postBufferMinutes: number;
  maxConcurrentRecordings: number;
  autoDeleteDays: number;
  activeRecordingProfileId: string;
  recordingProfiles: DvrRecordingProfile[];
}

export interface LogSettings {
  maxFiles: number;
  maxFileSizeBytes: number;
  autoDeleteDays: number;
}

export type FfmpegLogLevel = 'debug' | 'verbose' | 'info' | 'warning' | 'error';

export interface M3uSource {
  id: string;
  name: string;
  type: 'url' | 'file' | 'xc';
  isActive: boolean;
  path: string;
  refreshHours?: number;
  selectedGroups?: string[];
  xc_data?: string;
  cachedRawPath?: string;
  status?: string;
  statusMessage?: string;
  lastUpdated?: string;
}

export interface EpgSource {
  id: string;
  name: string;
  type: 'url' | 'file';
  isActive: boolean;
  path: string;
  refreshHours?: number;
  isXcEpg?: boolean;
  cachedRawPath?: string;
  fetchOptions?: Record<string, unknown>;
  status?: string;
  statusMessage?: string;
  lastUpdated?: string;
}

export interface LocalMediaFolder {
  id: string;
  name: string;
  path: string;
  category?: string;
  isActive: boolean;
  lastScanned?: string;
  itemCount?: {
    movies: number;
    series: number;
    episodes: number;
  };
}

export interface Settings {
  m3uSources: M3uSource[];
  epgSources: EpgSource[];
  localMediaFolders?: LocalMediaFolder[];
  userAgents: UserAgentProfile[];
  streamProfiles: StreamProfile[];
  dvr: DvrSettings;
  castProfiles: CastProfile[];
  activeCastProfileId: string;
  activeUserAgentId: string;
  activeStreamProfileId: string;
  timezoneOffset?: number;
  playerLogLevel: FfmpegLogLevel;
  dvrLogLevel: FfmpegLogLevel;
  searchScope: string;
  notificationLeadTime: number;
  sourcesLastUpdated: string | null;
  logs: LogSettings;
  vodPlaybackEngine?: 'native' | 'mpegts';
}

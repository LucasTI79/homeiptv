export type DvrJobStatus = 'scheduled' | 'recording' | 'completed' | 'error' | 'cancelled';

export interface DvrJob {
  id: number;
  user_id: number;
  channelId: string;
  channelName: string;
  programTitle: string;
  startTime: string;
  endTime: string;
  status: DvrJobStatus;
  ffmpeg_pid: number | null;
  filePath: string | null;
  profileId: string | null;
  userAgentId: string | null;
  preBufferMinutes: number | null;
  postBufferMinutes: number | null;
  errorMessage: string | null;
  isConflicting: boolean;
}

export interface DvrRecording {
  id: number;
  job_id: number | null;
  user_id: number;
  channelName: string;
  programTitle: string;
  startTime: string;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  filePath: string;
}

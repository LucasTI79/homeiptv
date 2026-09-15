export interface CreateStreamHistoryInput {
  userId: number;
  username: string;
  channelId: string | null;
  channelName: string | null;
  startTime: string;
  status: string;
  clientIp: string;
  channelLogo: string | null;
  streamProfileName: string;
}

export interface IStreamHistoryRepository {
  create(input: CreateStreamHistoryInput): Promise<number>;
  endPlaying(historyId: number, startTime: string): Promise<void>;
  endUnconditional(historyId: number, startTime: string): Promise<void>;
  getStartTime(historyId: number, userId: number): Promise<string | undefined>;
}

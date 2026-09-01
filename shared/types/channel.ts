export interface Channel {
  id: string;
  name: string;
  displayName?: string;
  logo?: string;
  url: string;
  group?: string;
  chno?: string;
  source?: string;
  isFavorite?: boolean;
}

export interface EpgProgram {
  channelId: string;
  title: string;
  desc?: string;
  start: string;
  stop: string;
}

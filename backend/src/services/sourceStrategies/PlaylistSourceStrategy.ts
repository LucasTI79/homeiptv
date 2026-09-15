import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { SendStatus } from '../httpFetch';

export interface PlaylistSourceStrategy {
  fetchContent(source: M3uSource, settings: Settings, sendStatus: SendStatus): Promise<string>;
}

import fs from 'fs';
import path from 'path';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import { fetchUrlContent } from '../sources';
import type { SendStatus } from '../sources';
import { RAW_CACHE_DIR } from '../../config/paths';

export class M3uUrlStrategy implements PlaylistSourceStrategy {
  async fetchContent(source: M3uSource, _settings: Settings, sendStatus: SendStatus): Promise<string> {
    sendStatus(' -> Fetching content from URL...', 'info');
    const content = (await fetchUrlContent(source.path)) as string;
    try {
      const cacheFilePath = path.join(RAW_CACHE_DIR, `raw_${source.id}.m3u_cache`);
      fs.writeFileSync(cacheFilePath, content);
      source.cachedRawPath = cacheFilePath;
    } catch (cacheWriteError) {
      console.error(`[PROCESS_CACHE] Failed to write raw cache for source "${source.name}" (URL):`, (cacheWriteError as Error).message);
      delete source.cachedRawPath;
    }
    sendStatus(' -> Successfully fetched M3U content.', 'info');
    return content;
  }
}

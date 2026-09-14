import fs from 'fs';
import path from 'path';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import { fetchUrlContent } from '../sources';
import type { SendStatus } from '../sources';
import { RAW_CACHE_DIR } from '../../config/paths';

export class XtreamCodesStrategy implements PlaylistSourceStrategy {
  async fetchContent(source: M3uSource, settings: Settings, sendStatus: SendStatus): Promise<string> {
    if (!source.xc_data) {
      throw new Error('XC source is missing credential data (xc_data).');
    }
    const { server, username, password } = JSON.parse(source.xc_data) as {
      server?: string;
      username?: string;
      password?: string;
    };
    if (!server || !username || !password) {
      throw new Error('XC source is missing server, username, or password.');
    }

    const activeUserAgent =
      settings.userAgents.find((ua) => ua.id === settings.activeUserAgentId)?.value || 'VLC/3.0.20 (Linux; x86_64)';
    const m3uFetchOptions = { headers: { 'User-Agent': activeUserAgent } };

    let content = '';
    try {
      sendStatus(' -> Fetching live categories and streams from XC server in parallel...', 'info');
      const liveCategoriesUrl = `${server}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;
      const liveStreamsUrl = `${server}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;

      const [categoriesRaw, streamsRaw] = await Promise.all([
        fetchUrlContent(liveCategoriesUrl, m3uFetchOptions),
        fetchUrlContent(liveStreamsUrl, m3uFetchOptions),
      ]);

      const liveCategories = JSON.parse(categoriesRaw as string) as Array<{ category_id: string; category_name: string }>;
      const liveStreams = JSON.parse(streamsRaw as string) as Array<{
        stream_type: string;
        stream_id: string | number;
        name: string;
        stream_icon?: string;
        category_id?: string;
        epg_channel_id?: string;
      }>;

      let liveM3uContent = '';
      let liveStreamCount = 0;
      if (Array.isArray(liveStreams)) {
        for (const stream of liveStreams) {
          if (stream.stream_type === 'live') {
            liveStreamCount++;
            const streamUrl = `${server}/live/${username}/${password}/${stream.stream_id}.ts`;
            const categoryName = Array.isArray(liveCategories)
              ? liveCategories.find((cat) => String(cat.category_id) === String(stream.category_id))?.category_name || 'Live'
              : 'Live';
            const tvgId = stream.epg_channel_id || stream.stream_id;
            liveM3uContent += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${stream.name}" tvg-logo="${stream.stream_icon || ''}" group-title="${categoryName}",${stream.name}\n`;
            liveM3uContent += `${streamUrl}\n`;
          }
        }
      }

      if (liveStreamCount > 0) {
        content += '\n' + liveM3uContent;
        sendStatus(` -> Added ${liveStreamCount} live streams to content.`, 'info');
      } else {
        sendStatus(" -> No live streams found with stream_type = 'live'.", 'info');
      }
    } catch (liveError) {
      console.error(`[XC Live] Error fetching live streams for "${source.name}": ${(liveError as Error).message}`);
      sendStatus(` -> Warning: Could not fetch live streams: ${(liveError as Error).message}`, 'warning');
    }

    try {
      const cacheFilePath = path.join(RAW_CACHE_DIR, `raw_${source.id}.m3u_cache`);
      fs.writeFileSync(cacheFilePath, content);
      source.cachedRawPath = cacheFilePath;
    } catch (cacheWriteError) {
      console.error(`[PROCESS_CACHE] Failed to write raw cache for source "${source.name}" (XC):`, (cacheWriteError as Error).message);
      delete source.cachedRawPath;
    }
    sendStatus(' -> Successfully fetched M3U content from XC server.', 'info');
    return content;
  }
}

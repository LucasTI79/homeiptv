import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import type { Channel } from '@viniplay/shared-types';

// Ports fetchUrlContent from server.js:1174-1222 verbatim: follows redirects
// recursively, supports a 60s timeout, and can return either text or a raw
// Buffer (asBuffer -- used for binary sources like compressed EPG files).
export function fetchUrlContent(url: string, options: http.RequestOptions = {}, asBuffer = false): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const TIMEOUT_DURATION = 60000;
    console.log(`[FETCH] Attempting to fetch URL content: ${url} (Timeout: ${TIMEOUT_DURATION / 1000}s)`);

    const request = protocol.get(url, { timeout: TIMEOUT_DURATION, ...options }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[FETCH] Redirecting to: ${res.headers.location}`);
        request.destroy();
        return fetchUrlContent(new URL(res.headers.location, url).href, options, asBuffer).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        console.error(`[FETCH] Failed to fetch ${url}: Status Code ${res.statusCode}`);
        return reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
      }

      if (asBuffer) {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          console.log(`[FETCH] Successfully fetched content as buffer from: ${url}`);
          resolve(Buffer.concat(chunks));
        });
      } else {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log(`[FETCH] Successfully fetched content from: ${url}`);
          resolve(data);
        });
      }
    });

    request.on('timeout', () => {
      request.destroy();
      const timeoutError = new Error(`Request to ${url} timed out after ${TIMEOUT_DURATION / 1000} seconds.`);
      console.error(`[FETCH] ${timeoutError.message}`);
      reject(timeoutError);
    });

    request.on('error', (err) => {
      console.error(`[FETCH] Network error fetching ${url}: ${err.message}`);
      reject(err);
    });
  });
}

// Ports parseEpgTime from server.js:1226-1244 verbatim: XMLTV timestamps look
// like "20260901120000 +0000"; falls back to the source's declared UTC offset
// (offsetHours) when the timestamp itself carries no explicit zone.
export function parseEpgTime(timeStr: string, offsetHours = 0): Date {
  const match = timeStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(([+-])(\d{2})(\d{2}))?/);
  if (!match) {
    console.warn(`[EPG_PARSE] Invalid time format encountered: ${timeStr}`);
    return new Date();
  }

  const [, year, month, day, hours, minutes, seconds, , sign, tzHours, tzMinutes] = match;
  let date: Date;
  if (sign && tzHours && tzMinutes) {
    const epgOffsetMinutes = (parseInt(tzHours, 10) * 60 + parseInt(tzMinutes, 10)) * (sign === '+' ? 1 : -1);
    date = new Date(Date.UTC(Number(year), parseInt(month, 10) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)));
    date.setUTCMinutes(date.getUTCMinutes() - epgOffsetMinutes);
  } else {
    date = new Date(Date.UTC(Number(year), parseInt(month, 10) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)));
    date.setUTCHours(date.getUTCHours() - offsetHours);
  }
  return date;
}

// Ports parseM3U from server.js:5277-5311 verbatim: re-parses the merged
// on-disk M3U (used by the streaming and DVR domains to resolve a channel by
// id without keeping a separate in-memory index).
export function parseM3U(data: string): Channel[] {
  if (!data) return [];
  const lines = data.split('\n');
  const channels: Channel[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && (nextLine.startsWith('http') || nextLine.startsWith('rtp'))) {
        const idMatch = line.match(/tvg-id="([^"]*)"/);
        const logoMatch = line.match(/tvg-logo="([^"]*)"/);
        const nameMatch = line.match(/tvg-name="([^"]*)"/);
        const groupMatch = line.match(/group-title="([^"]*)"/);
        const chnoMatch = line.match(/tvg-chno="([^"]*)"/);
        const sourceMatch = line.match(/vini-source="([^"]*)"/);
        const commaIndex = line.lastIndexOf(',');
        const displayName = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : 'Unknown';

        channels.push({
          id: idMatch ? idMatch[1] : `unknown-${Math.random()}`,
          logo: logoMatch ? logoMatch[1] : '',
          name: nameMatch ? nameMatch[1] : displayName,
          group: groupMatch ? groupMatch[1] : 'Uncategorized',
          chno: chnoMatch ? chnoMatch[1] : undefined,
          source: sourceMatch ? sourceMatch[1] : 'Default',
          displayName,
          url: nextLine,
        });
        i++;
      }
    }
  }
  return channels;
}

// ---------------------------------------------------------------------------
// processAndMergeSources -- ports server.js:1246-1633 verbatim.
//
// Reads every active M3U + EPG source, merges them into one live_channels.m3u
// and one epg.json on disk (same paths/format the legacy app uses), assigning
// each channel a stable "<sourceId>_<originalTvgId>" id so channels from
// different providers never collide, then filters EPG entries down to only
// the channels that actually made it into the merged M3U.
//
// VOD triggering (processM3uVod / triggerVodRefreshForProvider in the
// original) is intentionally not wired yet -- that's the VOD domain
// (task #14). This function only owns the live-channel M3U + EPG merge.
// ---------------------------------------------------------------------------

import xmlJS from 'xml-js';
import zlib from 'zlib';
import type { M3uSource, EpgSource, Settings } from '@viniplay/shared-types';
import { getSettings } from './settings';
import { SOURCES_DIR, RAW_CACHE_DIR, LIVE_CHANNELS_M3U_PATH, LIVE_EPG_JSON_PATH } from '../config/paths';

export type SendStatus = (message: string, type?: string) => void;
const noopStatus: SendStatus = () => {};

interface MergedEpgEntry {
  start: string;
  stop: string;
  title: string;
  desc: string;
}
type MergedEpgData = Record<string, MergedEpgEntry[]>;

interface ProcessResult {
  success: boolean;
  message: string;
  updatedSettings: Settings;
}

async function fetchM3uSourceContent(
  source: M3uSource,
  settings: Settings,
  sendStatus: SendStatus,
): Promise<string> {
  if (source.type === 'file') {
    const sourceFilePath = path.join(SOURCES_DIR, path.basename(source.path));
    if (!fs.existsSync(sourceFilePath)) {
      sendStatus(`Error: File not found for source "${source.name}". Skipping.`, 'error');
      source.status = 'Error';
      source.statusMessage = 'File not found.';
      throw new Error('File not found.');
    }
    return fs.readFileSync(sourceFilePath, 'utf-8');
  }

  if (source.type === 'url') {
    sendStatus(' -> Fetching content from URL...', 'info');
    const content = await fetchUrlContent(source.path) as string;
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

  // XC (Xtream Codes)
  if (!source.xc_data) {
    throw new Error('XC source is missing credential data (xc_data).');
  }
  const { server, username, password } = JSON.parse(source.xc_data) as { server?: string; username?: string; password?: string };
  if (!server || !username || !password) {
    throw new Error('XC source is missing server, username, or password.');
  }

  const activeUserAgent = settings.userAgents.find((ua) => ua.id === settings.activeUserAgentId)?.value || 'VLC/3.0.20 (Linux; x86_64)';
  const m3uFetchOptions = { headers: { 'User-Agent': activeUserAgent } };

  let content = '';
  try {
    sendStatus(' -> Fetching live categories from XC server...', 'info');
    const liveCategoriesUrl = `${server}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;
    const liveCategories = JSON.parse(await fetchUrlContent(liveCategoriesUrl, m3uFetchOptions) as string) as Array<{ category_id: string; category_name: string }>;

    sendStatus(' -> Fetching live streams from XC server...', 'info');
    const liveStreamsUrl = `${server}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;
    const liveStreams = JSON.parse(await fetchUrlContent(liveStreamsUrl, m3uFetchOptions) as string) as Array<{
      stream_type: string; stream_id: string | number; name: string; stream_icon?: string; category_id?: string; epg_channel_id?: string;
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

export async function processAndMergeSources(sendStatus: SendStatus = noopStatus): Promise<ProcessResult> {
  console.log('[PROCESS] Starting to process and merge all active sources.');
  sendStatus('Starting to process sources...', 'info');
  const settings = getSettings();

  let mergedLiveM3uContent = '#EXTM3U\n';
  const liveChannelIdSet = new Set<string>();
  const groupTitleRegex = /group-title="([^"]*)"/;

  const activeM3uSources = settings.m3uSources.filter((s) => s.isActive);
  const activeEpgSources = settings.epgSources.filter((s) => s.isActive);

  if (activeM3uSources.length === 0) {
    console.log('[PROCESS] No active M3U sources found.');
    sendStatus('No active M3U sources found.', 'info');
  }

  for (const source of activeM3uSources) {
    console.log(`[M3U] Processing source: "${source.name}" (ID: ${source.id}, Type: ${source.type}, Path: ${source.path})`);
    sendStatus(`Processing M3U source: "${source.name}"...`, 'info');

    const selectedGroups = source.selectedGroups || [];
    const isGroupFilteringActive = selectedGroups.length > 0;
    if (isGroupFilteringActive) {
      sendStatus(` -> Applying group filter. ${selectedGroups.length} groups selected.`, 'info');
    }

    try {
      const content = await fetchM3uSourceContent(source, settings, sendStatus);

      // TODO(VOD domain, task #14): trigger processM3uVod / triggerVodRefreshForProvider
      // here (server.js:1404-1409, 1476-1484) once vodProcessor.js is ported.

      const lines = content.split('\n');
      let currentExtInf = '';
      let liveStreamCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          currentExtInf = line;
          continue;
        }

        if (line.startsWith('http') && currentExtInf) {
          const streamUrl = line;

          const groupMatch = currentExtInf.match(groupTitleRegex);
          const groupTitle = groupMatch && groupMatch[1] ? groupMatch[1] : 'Uncategorized';
          if (isGroupFilteringActive && !selectedGroups.includes(groupTitle)) {
            currentExtInf = '';
            continue;
          }

          liveStreamCount++;
          let processedExtInf = currentExtInf;
          const idMatch = currentExtInf.match(/tvg-id="([^"]*)"/);
          const nameMatch = line.match(/tvg-name="([^"]*)"/);
          const commaIndex = currentExtInf.lastIndexOf(',');
          const name = nameMatch ? nameMatch[1] : (commaIndex !== -1 ? currentExtInf.substring(commaIndex + 1).trim() : 'Unknown');

          const originalTvgId = idMatch ? idMatch[1] : `no-tvg-id-${name.replace(/[^a-zA-Z0-9]/g, '')}`;
          const finalUniqueChannelId = `${source.id}_${originalTvgId}`;

          if (idMatch) {
            processedExtInf = processedExtInf.replace(/tvg-id="[^"]*"/, `tvg-id="${finalUniqueChannelId}"`);
          } else {
            const extinfEnd = processedExtInf.indexOf(':') + 1;
            processedExtInf = processedExtInf.slice(0, extinfEnd) + ` tvg-id="${finalUniqueChannelId}"` + processedExtInf.slice(extinfEnd);
          }

          const tvgIdAttrEnd = processedExtInf.indexOf(`tvg-id="${finalUniqueChannelId}"`) + `tvg-id="${finalUniqueChannelId}"`.length;
          processedExtInf = processedExtInf.slice(0, tvgIdAttrEnd) + ` vini-source="${source.name}"` + processedExtInf.slice(tvgIdAttrEnd);

          mergedLiveM3uContent += processedExtInf + '\n' + streamUrl + '\n';
          liveChannelIdSet.add(finalUniqueChannelId);

          currentExtInf = '';
        }
      }

      source.status = 'Success';
      source.statusMessage = `Processed ${liveStreamCount} Live channels.`;
      console.log(`[M3U] Source "${source.name}" processed successfully.`);
      sendStatus(` -> Processed ${liveStreamCount} Live channels from "${source.name}".`, 'info');
    } catch (error) {
      const errorMsg = `Failed to process source "${source.name}" from ${source.path}: ${(error as Error).message}`;
      console.error(`[M3U] ${errorMsg}`);
      sendStatus(`Error: ${errorMsg}`, 'error');
      source.status = 'Error';
      source.statusMessage = `Processing failed: ${(error as Error).message.substring(0, 100)}...`;
    }
    source.lastUpdated = new Date().toISOString();
  }

  try {
    fs.writeFileSync(LIVE_CHANNELS_M3U_PATH, mergedLiveM3uContent);
    console.log(`[M3U] Merged LIVE CHANNELS content saved to ${LIVE_CHANNELS_M3U_PATH}.`);
    sendStatus('Successfully merged all live channels.', 'success');
  } catch (writeErr) {
    console.error(`[PROCESS] Error writing LIVE M3U file: ${(writeErr as Error).message}`);
    sendStatus(`Error writing live channels file: ${(writeErr as Error).message}`, 'error');
  }

  // --- EPG processing ---
  const mergedProgramData: MergedEpgData = {};
  const timezoneOffset = settings.timezoneOffset || 0;

  if (activeEpgSources.length === 0) {
    console.log('[PROCESS] No active EPG sources found.');
    sendStatus('No active EPG sources found.', 'info');
  }

  for (const source of activeEpgSources) {
    console.log(`[EPG] Processing source: "${source.name}" (ID: ${source.id}, Type: ${source.type}, Path: ${source.path})`);
    sendStatus(`Processing EPG source: "${source.name}"...`, 'info');
    try {
      let xmlString = '';
      const epgFilePath = path.join(SOURCES_DIR, `epg_${source.id}.xml`);

      if (source.type === 'file') {
        if (!fs.existsSync(source.path)) {
          sendStatus(`Error: File not found for source "${source.name}". Skipping.`, 'error');
          source.status = 'Error';
          source.statusMessage = 'File not found.';
          continue;
        }
        xmlString = fs.readFileSync(source.path, 'utf-8');
      } else if (source.type === 'url') {
        sendStatus(' -> Fetching content from URL...', 'info');
        if (source.path.endsWith('.gz')) {
          const buffer = await fetchUrlContent(source.path, source.fetchOptions || {}, true) as Buffer;
          xmlString = zlib.gunzipSync(buffer).toString('utf-8');
          sendStatus(' -> Successfully fetched and decompressed EPG content.', 'info');
        } else {
          xmlString = await fetchUrlContent(source.path, source.fetchOptions || {}) as string;
          sendStatus(' -> Successfully fetched EPG content.', 'info');
        }

        try {
          fs.writeFileSync(epgFilePath, xmlString);
          console.log(`[EPG] Downloaded EPG for "${source.name}" saved to ${epgFilePath}.`);
        } catch (writeErr) {
          console.error(`[EPG] Error saving EPG file from URL for "${source.name}": ${(writeErr as Error).message}`);
        }
      }

      const epgJson = xmlJS.xml2js(xmlString, { compact: true }) as {
        tv?: { programme?: unknown };
      };
      const programs = (epgJson.tv && epgJson.tv.programme ? [].concat(epgJson.tv.programme as never) : []) as Array<{
        _attributes?: { channel?: string; start?: string; stop?: string };
        title?: { _cdata?: string; _text?: string };
        desc?: { _cdata?: string; _text?: string };
      }>;

      let programCount = 0;
      let epgAddedCount = 0;

      if (programs.length === 0) {
        sendStatus(`Warning: No programs found in "${source.name}".`, 'info');
      }

      const m3uSourceProviders = settings.m3uSources.filter((m3u) => m3u.isActive);

      for (const prog of programs) {
        const originalChannelId = prog._attributes?.channel;
        if (!originalChannelId) continue;
        programCount++;

        for (const m3uSource of m3uSourceProviders) {
          const uniqueChannelId = `${m3uSource.id}_${originalChannelId}`;
          if (!liveChannelIdSet.has(uniqueChannelId)) continue;

          if (!mergedProgramData[uniqueChannelId]) {
            mergedProgramData[uniqueChannelId] = [];
          }
          epgAddedCount++;

          const titleNode = prog.title?._cdata ?? prog.title?._text ?? 'No Title';
          const descNode = prog.desc?._cdata ?? prog.desc?._text ?? '';

          mergedProgramData[uniqueChannelId].push({
            start: parseEpgTime(prog._attributes!.start!, timezoneOffset).toISOString(),
            stop: parseEpgTime(prog._attributes!.stop!, timezoneOffset).toISOString(),
            title: titleNode.trim(),
            desc: descNode.trim(),
          });
        }
      }

      if (!source.isXcEpg) {
        source.status = 'Success';
        source.statusMessage = `Processed ${programCount} programs, added ${epgAddedCount} to live guide.`;
        console.log(`[EPG] Source "${source.name}" processed successfully from ${source.path}.`);
      }
      sendStatus(` -> Processed ${programCount} programs, added ${epgAddedCount} to live guide from "${source.name}".`, 'info');
    } catch (error) {
      const errorMsg = `Failed to process source "${source.name}" from ${source.path}: ${(error as Error).message}`;
      console.error(`[EPG] ${errorMsg}`);
      sendStatus(`Error: ${errorMsg}`, 'error');
      if (!source.isXcEpg) {
        source.status = 'Error';
        source.statusMessage = `Processing failed: ${(error as Error).message.substring(0, 100)}...`;
      }
    }
    if (!source.isXcEpg) {
      source.lastUpdated = new Date().toISOString();
    }
  }

  for (const channelId in mergedProgramData) {
    mergedProgramData[channelId].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  try {
    fs.writeFileSync(LIVE_EPG_JSON_PATH, JSON.stringify(mergedProgramData));
    console.log(`[EPG] Merged EPG JSON content saved to ${LIVE_EPG_JSON_PATH}.`);
    sendStatus('Successfully merged all EPG data for live channels.', 'success');
  } catch (writeErr) {
    console.error(`[EPG] Error writing merged EPG JSON file: ${(writeErr as Error).message}`);
    sendStatus(`Error writing merged EPG JSON file: ${(writeErr as Error).message}`, 'error');
  }

  settings.sourcesLastUpdated = new Date().toISOString();
  console.log(`[PROCESS] Finished processing. New 'sourcesLastUpdated' timestamp: ${settings.sourcesLastUpdated}`);
  sendStatus('All sources processed successfully!', 'final_success');

  return { success: true, message: 'Sources merged successfully.', updatedSettings: settings };
}

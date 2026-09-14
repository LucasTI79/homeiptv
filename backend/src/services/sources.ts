import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import type { Channel } from '@homeiptv/shared-types';
import { refreshVodContent, processM3uVod } from './vodProcessor';

// Ports fetchUrlContent from server.js:1174-1222 verbatim: follows redirects
// recursively, supports a 60s timeout, and can return either text or a raw
// Buffer (asBuffer -- used for binary sources like compressed EPG files).
export function fetchUrlContent(
  url: string,
  options: http.RequestOptions = {},
  asBuffer = false,
  maxBytes = 150 * 1024 * 1024 // 150 MB safety limit
): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const TIMEOUT_DURATION = 60000;
    console.log(`[FETCH] Attempting to fetch URL content: ${url} (Timeout: ${TIMEOUT_DURATION / 1000}s)`);

    let isDone = false;
    const finish = (err?: Error, data?: string | Buffer) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(hardTimer);
      if (err) reject(err);
      else resolve(data!);
    };

    const hardTimer = setTimeout(() => {
      try { request.destroy(); } catch {}
      const timeoutError = new Error(`Request to ${url} exceeded hard timeout of ${TIMEOUT_DURATION / 1000} seconds.`);
      console.error(`[FETCH] ${timeoutError.message}`);
      finish(timeoutError);
    }, TIMEOUT_DURATION);

    const request = protocol.get(url, { timeout: TIMEOUT_DURATION, ...options }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[FETCH] Redirecting to: ${res.headers.location}`);
        try { request.destroy(); } catch {}
        clearTimeout(hardTimer);
        return fetchUrlContent(new URL(res.headers.location, url).href, options, asBuffer, maxBytes).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        console.error(`[FETCH] Failed to fetch ${url}: Status Code ${res.statusCode}`);
        try { request.destroy(); res.destroy(); } catch {}
        return finish(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
      }

      let totalBytes = 0;

      if (asBuffer) {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            try { request.destroy(); res.destroy(); } catch {}
            return finish(new Error(`Response from ${url} exceeded maximum size limit of ${Math.round(maxBytes / 1024 / 1024)}MB.`));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          console.log(`[FETCH] Successfully fetched content as buffer from: ${url} (${totalBytes} bytes)`);
          finish(undefined, Buffer.concat(chunks));
        });
      } else {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            try { request.destroy(); res.destroy(); } catch {}
            return finish(new Error(`Response from ${url} exceeded maximum size limit of ${Math.round(maxBytes / 1024 / 1024)}MB.`));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          console.log(`[FETCH] Successfully fetched content from: ${url} (${totalBytes} bytes)`);
          finish(undefined, Buffer.concat(chunks).toString('utf-8'));
        });
      }
    });

    request.on('timeout', () => {
      try { request.destroy(); } catch {}
      const timeoutError = new Error(`Request to ${url} socket idle timed out after ${TIMEOUT_DURATION / 1000} seconds.`);
      console.error(`[FETCH] ${timeoutError.message}`);
      finish(timeoutError);
    });

    request.on('error', (err) => {
      console.error(`[FETCH] Network error fetching ${url}: ${err.message}`);
      finish(err);
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
  const seenIds = new Map<string, number>();

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
        const rawId = idMatch ? idMatch[1] : `unknown-${channels.length}`;

        const count = seenIds.get(rawId) || 0;
        seenIds.set(rawId, count + 1);
        const uniqueId = count > 0 ? `${rawId}_dup${count}` : rawId;

        channels.push({
          id: uniqueId,
          tvgId: rawId,
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
import type { M3uSource, EpgSource, Settings } from '@homeiptv/shared-types';
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

// Helper to process async tasks concurrently with a maximum parallel pool limit
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function processAndMergeSources(sendStatus: SendStatus = noopStatus): Promise<ProcessResult> {
  console.log('[PROCESS] Starting to process and merge all active sources.');
  sendStatus('Starting to process sources...', 'info');
  const settings = getSettings();

  const liveChannelIdSet = new Set<string>();
  const groupTitleRegex = /group-title="([^"]*)"/;

  const activeM3uSources = settings.m3uSources.filter((s) => s.isActive);
  const activeEpgSources = settings.epgSources.filter((s) => s.isActive);

  if (activeM3uSources.length === 0) {
    console.log('[PROCESS] No active M3U sources found.');
    sendStatus('No active M3U sources found.', 'info');
  }

  // --- M3U Parallel Processing (Max 3 concurrent downloads) ---
  const M3U_CONCURRENCY = 3;
  const m3uResults = await mapConcurrent(activeM3uSources, M3U_CONCURRENCY, async (source) => {
    console.log(`[M3U] Processing source: "${source.name}" (ID: ${source.id}, Type: ${source.type}, Path: ${source.path})`);
    sendStatus(`Processing M3U source: "${source.name}"...`, 'info');

    const selectedGroups = source.selectedGroups || [];
    const isGroupFilteringActive = selectedGroups.length > 0;
    if (isGroupFilteringActive) {
      sendStatus(` -> Applying group filter. ${selectedGroups.length} groups selected for "${source.name}".`, 'info');
    }

    let partialM3u = '';
    const channelIds: string[] = [];
    let liveStreamCount = 0;

    try {
      const { selectPlaylistStrategy } = await import('./sourceStrategies');
      const content = await selectPlaylistStrategy(source.type).fetchContent(source, settings, sendStatus);

      // Trigger VOD refresh in background so Live channels load without delay
      const activeUserAgent = settings.userAgents.find((ua) => ua.id === settings.activeUserAgentId)?.value || 'VLC/3.0.20 (Linux; x86_64)';
      if (source.type === 'xc') {
        refreshVodContent(source, activeUserAgent).catch((e) => {
          console.error(`[VOD] Background VOD refresh error for "${source.name}":`, (e as Error).message);
        });
      } else if (content.includes('/movie/') || content.includes('/series/')) {
        processM3uVod(content, source).catch((e) => {
          console.error(`[VOD] Background M3U VOD error for "${source.name}":`, (e as Error).message);
        });
      }

      const lines = content.split('\n');
      let currentExtInf = '';

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

          partialM3u += processedExtInf + '\n' + streamUrl + '\n';
          channelIds.push(finalUniqueChannelId);

          currentExtInf = '';
        }
      }

      source.status = 'Success';
      source.statusMessage = `Processed ${liveStreamCount} Live channels.`;
      console.log(`[M3U] Source "${source.name}" processed successfully (${liveStreamCount} channels).`);
      sendStatus(` -> Processed ${liveStreamCount} Live channels from "${source.name}".`, 'info');
    } catch (error) {
      const errorMsg = `Failed to process source "${source.name}" from ${source.path}: ${(error as Error).message}`;
      console.error(`[M3U] ${errorMsg}`);
      sendStatus(`Error: ${errorMsg}`, 'error');
      source.status = 'Error';
      source.statusMessage = `Processing failed: ${(error as Error).message.substring(0, 100)}...`;
    }
    source.lastUpdated = new Date().toISOString();
    return { partialM3u, channelIds };
  });

  let mergedLiveM3uContent = '#EXTM3U\n';
  for (const res of m3uResults) {
    if (res.partialM3u) mergedLiveM3uContent += res.partialM3u;
    for (const chId of res.channelIds) liveChannelIdSet.add(chId);
  }

  try {
    fs.writeFileSync(LIVE_CHANNELS_M3U_PATH, mergedLiveM3uContent);
    console.log(`[M3U] Merged LIVE CHANNELS content saved to ${LIVE_CHANNELS_M3U_PATH}.`);
    sendStatus('Successfully merged all live channels.', 'success');
  } catch (writeErr) {
    console.error(`[PROCESS] Error writing LIVE M3U file: ${(writeErr as Error).message}`);
    sendStatus(`Error writing live channels file: ${(writeErr as Error).message}`, 'error');
  }

  // --- EPG Parallel Processing (Max 2 concurrent XML parses to protect RAM and CPU) ---
  const mergedProgramData: MergedEpgData = {};
  const timezoneOffset = settings.timezoneOffset || 0;
  const m3uSourceProviders = settings.m3uSources.filter((m3u) => m3u.isActive);

  if (activeEpgSources.length === 0) {
    console.log('[PROCESS] No active EPG sources found.');
    sendStatus('No active EPG sources found.', 'info');
  }

  const EPG_CONCURRENCY = 2;
  const epgResults = await mapConcurrent(activeEpgSources, EPG_CONCURRENCY, async (source) => {
    console.log(`[EPG] Processing source: "${source.name}" (ID: ${source.id}, Type: ${source.type}, Path: ${source.path})`);
    sendStatus(`Processing EPG source: "${source.name}"...`, 'info');

    const sourceProgramMap: Record<string, Array<{ start: string; stop: string; title: string; desc: string }>> = {};

    try {
      let xmlString = '';
      const epgFilePath = path.join(SOURCES_DIR, `epg_${source.id}.xml`);

      if (source.type === 'file') {
        if (!fs.existsSync(source.path)) {
          sendStatus(`Error: File not found for source "${source.name}". Skipping.`, 'error');
          source.status = 'Error';
          source.statusMessage = 'File not found.';
          return sourceProgramMap;
        }
        xmlString = fs.readFileSync(source.path, 'utf-8');
      } else if (source.type === 'url') {
        sendStatus(` -> Fetching EPG content from URL for "${source.name}"...`, 'info');
        if (source.path.endsWith('.gz')) {
          const buffer = await fetchUrlContent(source.path, source.fetchOptions || {}, true) as Buffer;
          xmlString = zlib.gunzipSync(buffer).toString('utf-8');
          sendStatus(` -> Successfully decompressed EPG for "${source.name}".`, 'info');
        } else {
          xmlString = await fetchUrlContent(source.path, source.fetchOptions || {}) as string;
          sendStatus(` -> Successfully fetched EPG for "${source.name}".`, 'info');
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
      // Release raw XML string reference immediately to assist garbage collection
      xmlString = '';

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

      for (const prog of programs) {
        const originalChannelId = prog._attributes?.channel;
        if (!originalChannelId) continue;
        programCount++;

        for (const m3uSource of m3uSourceProviders) {
          const uniqueChannelId = `${m3uSource.id}_${originalChannelId}`;
          if (!liveChannelIdSet.has(uniqueChannelId)) continue;

          if (!sourceProgramMap[uniqueChannelId]) {
            sourceProgramMap[uniqueChannelId] = [];
          }
          epgAddedCount++;

          const titleNode = prog.title?._cdata ?? prog.title?._text ?? 'No Title';
          const descNode = prog.desc?._cdata ?? prog.desc?._text ?? '';

          sourceProgramMap[uniqueChannelId].push({
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
        console.log(`[EPG] Source "${source.name}" processed successfully.`);
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
    return sourceProgramMap;
  });

  // Combine EPG maps from all concurrent sources
  for (const sourceMap of epgResults) {
    for (const channelId in sourceMap) {
      if (!mergedProgramData[channelId]) {
        mergedProgramData[channelId] = [];
      }
      mergedProgramData[channelId].push(...sourceMap[channelId]);
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

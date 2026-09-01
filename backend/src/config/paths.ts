import fs from 'fs';
import path from 'path';
import { env } from './env';

// Mirrors server.js's directory layout (server.js:76-106): same DATA_DIR,
// same file names, so both apps read/write the exact same on-disk state
// during the Wave 2/3 transition.
export const DATA_DIR = env.dataDir;
export const SOURCES_DIR = path.join(DATA_DIR, 'sources');
export const RAW_CACHE_DIR = path.join(SOURCES_DIR, 'raw_cache');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const PUBLIC_DIR = path.resolve(__dirname, '../../../public');
export const LIVE_CHANNELS_M3U_PATH = path.join(DATA_DIR, 'live_channels.m3u');
export const LIVE_EPG_JSON_PATH = path.join(DATA_DIR, 'epg.json');
export const VOD_MOVIES_JSON_PATH = path.join(DATA_DIR, 'vod_movies.json');
export const VOD_SERIES_JSON_PATH = path.join(DATA_DIR, 'vod_series.json');

for (const dir of [DATA_DIR, SOURCES_DIR, RAW_CACHE_DIR, LOGS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

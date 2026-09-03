import fs from 'fs';
import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { getSettings } from '../services/settings';
import { LIVE_CHANNELS_M3U_PATH, LIVE_EPG_JSON_PATH, VOD_MOVIES_JSON_PATH, VOD_SERIES_JSON_PATH } from '../config/paths';

// Ports GET /api/config from server.js:2002-2195.
export const configRouter = Router();

interface AllowedSourceRule {
  allowed: boolean;
  groups?: string[];
}

let cachedM3uRaw: string | null = null;
let cachedM3uMtime = 0;

let cachedFullEpg: Record<string, unknown> = {};
let cachedEpgMtime = 0;

function getCachedM3u(): string | null {
  if (!fs.existsSync(LIVE_CHANNELS_M3U_PATH)) return null;
  try {
    const stat = fs.statSync(LIVE_CHANNELS_M3U_PATH);
    if (stat.mtimeMs !== cachedM3uMtime || cachedM3uRaw === null) {
      cachedM3uRaw = fs.readFileSync(LIVE_CHANNELS_M3U_PATH, 'utf-8');
      cachedM3uMtime = stat.mtimeMs;
    }
    return cachedM3uRaw;
  } catch {
    return null;
  }
}

function getCachedEpg(): Record<string, unknown> {
  if (!fs.existsSync(LIVE_EPG_JSON_PATH)) return {};
  try {
    const stat = fs.statSync(LIVE_EPG_JSON_PATH);
    if (stat.mtimeMs !== cachedEpgMtime || Object.keys(cachedFullEpg).length === 0) {
      cachedFullEpg = JSON.parse(fs.readFileSync(LIVE_EPG_JSON_PATH, 'utf-8')) as Record<string, unknown>;
      cachedEpgMtime = stat.mtimeMs;
    }
    return cachedFullEpg;
  } catch {
    return {};
  }
}

configRouter.get('/config', requireAuth, async (req, res) => {
  try {
    const config: {
      m3uContent: string | null;
      epgContent: Record<string, unknown>;
      settings: Record<string, unknown>;
      vodMovies: unknown[];
      vodSeries: unknown[];
    } = { m3uContent: null, epgContent: {}, settings: {}, vodMovies: [], vodSeries: [] };

    const globalSettings = getSettings();
    config.settings = globalSettings as unknown as Record<string, unknown>;

    let allowedSources: Record<string, AllowedSourceRule> | null = null;
    try {
      const user = await db('users').select('allowed_sources', 'username').where({ id: req.session.userId }).first();
      if (user?.allowed_sources) {
        allowedSources = JSON.parse(user.allowed_sources);
      }
    } catch (dbErr) {
      console.error('[API] Error fetching user permissions:', dbErr);
    }

    // LOAD + FILTER M3U (from memory cache)
    const m3uRaw = getCachedM3u();
    if (m3uRaw) {
      if (allowedSources) {
        const lines = m3uRaw.split('\n');
        const filteredLines: string[] = [];
        if (lines.length > 0 && lines[0].startsWith('#EXTM3U')) {
          filteredLines.push(lines[0]);
        }

        let currentExtInf: string | null = null;
        const groupTitleRegex = /group-title="([^"]*)"/;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXTINF:')) {
            currentExtInf = line;
            const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
            let isAllowed = false;

            if (tvgIdMatch) {
              const fullId = tvgIdMatch[1];
              const underscoreIndex = fullId.indexOf('_');
              if (underscoreIndex !== -1) {
                const sourceId = fullId.substring(0, underscoreIndex);
                const rule = allowedSources[sourceId];
                if (rule?.allowed) {
                  isAllowed = true;
                  const groups = rule.groups;
                  if (groups && groups.length > 0) {
                    const groupMatch = line.match(groupTitleRegex);
                    const group = groupMatch ? groupMatch[1] : 'Uncategorized';
                    if (!groups.includes(group)) {
                      isAllowed = false;
                    }
                  }
                }
              }
            }

            if (!isAllowed) currentExtInf = null;
          } else if (line.startsWith('http') || (line.startsWith('/') && !line.startsWith('//'))) {
            if (currentExtInf) {
              filteredLines.push(currentExtInf);
              filteredLines.push(line);
            }
            currentExtInf = null;
          }
        }
        config.m3uContent = filteredLines.join('\n');
      } else {
        config.m3uContent = m3uRaw;
      }
    }

    // LOAD + FILTER EPG (from memory cache)
    const fullEpg = getCachedEpg();
    if (allowedSources) {
      const filteredEpg: Record<string, unknown> = {};
      for (const channelId of Object.keys(fullEpg)) {
        const underscoreIndex = channelId.indexOf('_');
        if (underscoreIndex !== -1) {
          const sourceId = channelId.substring(0, underscoreIndex);
          if (allowedSources[sourceId]?.allowed) {
            filteredEpg[channelId] = fullEpg[channelId];
          }
        }
      }
      config.epgContent = filteredEpg;
    } else {
      config.epgContent = fullEpg;
    }

    // Legacy VOD JSON files (best-effort, same as server.js:2138-2148)
    if (fs.existsSync(VOD_MOVIES_JSON_PATH)) {
      try { config.vodMovies = JSON.parse(fs.readFileSync(VOD_MOVIES_JSON_PATH, 'utf-8')); } catch { /* ignore */ }
    }
    if (fs.existsSync(VOD_SERIES_JSON_PATH)) {
      try { config.vodSeries = JSON.parse(fs.readFileSync(VOD_SERIES_JSON_PATH, 'utf-8')); } catch { /* ignore */ }
    }

    const userSettingRows = await db('user_settings').select('key', 'value').where({ user_id: req.session.userId });
    const userSettings: Record<string, unknown> = {};
    for (const row of userSettingRows) {
      try {
        userSettings[row.key] = JSON.parse(row.value);
      } catch {
        userSettings[row.key] = row.value;
      }
    }
    config.settings = { ...config.settings, ...userSettings };

    let userPermissionsSignature = 'default';
    if (allowedSources) {
      const str = JSON.stringify(allowedSources);
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      userPermissionsSignature = 'v1_' + hash;
    }
    config.settings.userPermissionsSignature = userPermissionsSignature;

    res.status(200).json(config);
  } catch (error) {
    console.error('[API] Error reading config or related files:', error);
    res.status(500).json({ error: 'Could not load configuration from server.' });
  }
});

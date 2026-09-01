import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { getSettings, saveSettings } from '../services/settings';
import { fetchUrlContent, processAndMergeSources } from '../services/sources';
import { SOURCES_DIR } from '../config/paths';
import type { M3uSource, EpgSource } from '@viniplay/shared-types';

// Ports the source-management routes from server.js:1741-1843, 2582-3008.
export const sourcesRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(SOURCES_DIR, { recursive: true });
      cb(null, SOURCES_DIR);
    },
    filename: (_req, file, cb) => {
      cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    },
  }),
});

sourcesRouter.post('/sources/fetch-groups', requireAuth, async (req, res) => {
  const forceRefresh = req.query.refresh === 'true' || req.body.refresh === true;
  const { type, url, xc, sourceId } = req.body as { type?: string; url?: string; xc?: string; sourceId?: string };

  console.log(`[API_GROUPS] Fetching groups for type: ${type}, SourceID: ${sourceId}, Refresh: ${forceRefresh}`);

  try {
    let sourceToUse: M3uSource | EpgSource | undefined;
    if (sourceId) {
      const settings = getSettings();
      sourceToUse = settings.m3uSources.find((s) => s.id === sourceId) || settings.epgSources.find((s) => s.id === sourceId);
    }

    let content = '';
    let usedCache = false;

    if (!forceRefresh && sourceToUse?.cachedRawPath && fs.existsSync(sourceToUse.cachedRawPath)) {
      try {
        content = fs.readFileSync(sourceToUse.cachedRawPath, 'utf-8');
        usedCache = true;
      } catch (cacheReadError) {
        console.warn(`[API_GROUPS] Failed to read cache file ${sourceToUse.cachedRawPath}. Will fetch fresh.`, (cacheReadError as Error).message);
      }
    }

    if (type === 'xc' && xc) {
      const xcInfo = JSON.parse(xc) as { server?: string; username?: string; password?: string };
      if (!xcInfo.server || !xcInfo.username || !xcInfo.password) {
        return res.status(400).json({ error: 'XC source requires server, username, and password.' });
      }
      // TODO(VOD domain, task #14): use the ported XtreamClient once available
      // (server.js:1781-1786 uses it to fetch every category, not just live).
      return res.status(501).json({ error: 'XC group listing is not yet available on the new backend (pending VOD domain port).' });
    }

    if (!usedCache) {
      if (type === 'url' && url) {
        content = await fetchUrlContent(url) as string;
      } else if (type === 'file' && url) {
        const filePath = (sourceToUse as M3uSource | undefined)?.path || path.join(SOURCES_DIR, path.basename(url));
        if (!fs.existsSync(filePath)) {
          return res.status(400).json({ error: 'File source path not found or invalid.' });
        }
        content = fs.readFileSync(filePath, 'utf-8');
      } else {
        return res.status(400).json({ error: 'Valid source details (URL, XC, or File path) are required.' });
      }
    }

    const groups = new Set<string>();
    try {
      const groupJsonArray = JSON.parse(content);
      if (Array.isArray(groupJsonArray)) {
        for (const category of groupJsonArray) {
          if (category && typeof category.category_name === 'string') {
            const groupName = category.category_name.trim();
            if (groupName) groups.add(groupName);
          }
        }
      }
    } catch {
      const groupTitleRegex = /group-title="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = groupTitleRegex.exec(content)) !== null) {
        const groupName = match[1].trim();
        if (groupName) groups.add(groupName);
      }
    }

    const sortedGroups = Array.from(groups).sort((a, b) => a.localeCompare(b));
    res.json({ success: true, groups: sortedGroups, usedCache });
  } catch (error) {
    console.error(`[API_GROUPS] Failed to fetch or parse M3U for groups: ${(error as Error).message}`);
    res.status(500).json({ error: `Failed to fetch or process groups: ${(error as Error).message}` });
  }
});

sourcesRouter.post('/sources', requireAuth, upload.single('sourceFile'), async (req, res) => {
  const { sourceType, name, url, isActive, id, refreshHours, xc, selectedGroups } = req.body as Record<string, string | undefined>;

  if (!sourceType || !name) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Source type and name are required.' });
  }

  const settings = getSettings();
  const sourceList: Array<M3uSource | EpgSource> = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;

  if (id) {
    const source = sourceList.find((s) => s.id === id) as M3uSource | undefined;
    if (!source) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Source to update not found.' });
    }

    source.name = name;
    source.isActive = isActive === 'true';
    source.refreshHours = parseInt(refreshHours || '0', 10) || 0;
    source.lastUpdated = new Date().toISOString();

    try {
      source.selectedGroups = JSON.parse(selectedGroups || '[]');
    } catch {
      source.selectedGroups = [];
    }

    if (req.file) {
      if (source.type === 'file' && fs.existsSync(source.path)) {
        try { fs.unlinkSync(source.path); } catch (e) { console.error('[SOURCES_API] Could not delete old source file:', e); }
      }
      const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
      const newPath = path.join(SOURCES_DIR, `${sourceType}_${id}${extension}`);
      try {
        fs.renameSync(req.file.path, newPath);
        source.path = newPath;
        source.type = 'file';
        delete source.xc_data;
      } catch (e) {
        console.error('[SOURCES_API] Error renaming updated source file:', e);
        return res.status(500).json({ error: 'Could not save updated file.' });
      }
    } else if (url !== undefined && url !== null) {
      if (source.type === 'file' && fs.existsSync(source.path)) {
        try { fs.unlinkSync(source.path); } catch (e) { console.error('[SOURCES_API] Could not delete old source file (on type change):', e); }
      }
      source.path = url;
      source.type = 'url';
      delete source.xc_data;
    } else if (xc) {
      if (source.type === 'file' && fs.existsSync(source.path)) {
        try { fs.unlinkSync(source.path); } catch (e) { console.error('[SOURCES_API] Could not delete old source file (on type change):', e); }
      }
      source.xc_data = xc;
      source.type = 'xc';
      try {
        source.path = (JSON.parse(xc) as { server?: string }).server || 'Xtream Codes Source';
      } catch {
        source.path = 'Xtream Codes Source';
      }
    } else if (source.type === 'file' && !req.file && (!source.path || !fs.existsSync(source.path))) {
      return res.status(400).json({ error: 'Existing file source requires a new file if original is missing.' });
    }

    const wasXc = source.type === 'xc';
    const isNowXc = xc !== undefined && xc !== null && xc !== '';

    if (wasXc && !isNowXc) {
      const epgIdToDelete = `epg_for_${id}`;
      settings.epgSources = settings.epgSources.filter((epg) => epg.id !== epgIdToDelete);
    }

    if (isNowXc) {
      const epgId = `epg_for_${id}`;
      let epgSource = settings.epgSources.find((epg) => epg.id === epgId);
      try {
        const xcData = JSON.parse(xc as string) as { server: string; username: string; password: string };
        const newEpgUrl = `${xcData.server}/xmltv.php?username=${xcData.username}&password=${xcData.password}`;
        if (epgSource) {
          epgSource.name = `${name} (EPG)`;
          epgSource.path = newEpgUrl;
          epgSource.refreshHours = parseInt(refreshHours || '0', 10) || 0;
        } else {
          epgSource = {
            id: epgId,
            name: `${name} (EPG)`,
            type: 'url',
            path: newEpgUrl,
            isActive: true,
            isXcEpg: true,
            refreshHours: parseInt(refreshHours || '0', 10) || 0,
            lastUpdated: new Date().toISOString(),
            status: 'Pending',
            statusMessage: 'Managed by XC source. Process to load data.',
          };
          settings.epgSources.push(epgSource);
        }
      } catch (e) {
        console.error('[SOURCES_API] Error processing XC data for EPG sync on update:', (e as Error).message);
      }
    }

    let shouldDeleteCache = false;
    const existingCachePath = source.cachedRawPath;
    let newSourceType = source.type;
    if (req.file) newSourceType = 'file';
    else if (url !== undefined && url !== null) newSourceType = 'url';
    else if (xc) newSourceType = 'xc';

    if (existingCachePath && newSourceType === 'file') {
      shouldDeleteCache = true;
    } else if (existingCachePath && newSourceType === 'url' && source.path !== url) {
      shouldDeleteCache = true;
    } else if (existingCachePath && newSourceType === 'xc' && source.xc_data !== xc) {
      shouldDeleteCache = true;
    }

    if (shouldDeleteCache && existingCachePath && fs.existsSync(existingCachePath)) {
      try { fs.unlinkSync(existingCachePath); } catch (e) { console.error('[SOURCES_API_CACHE_CLEANUP] Could not delete stale cached raw file during update:', e); }
      delete source.cachedRawPath;
    }

    saveSettings(settings);
    res.json({ success: true, message: 'Source updated successfully.', settings: getSettings() });
    return;
  }

  // Add new source
  let parsedSelectedGroups: string[] = [];
  try {
    parsedSelectedGroups = JSON.parse(selectedGroups || '[]');
  } catch {
    // keep default []
  }

  let newSource: M3uSource | EpgSource;

  if (xc) {
    let xcData: { server?: string };
    try {
      xcData = JSON.parse(xc);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid XC data format.' });
    }
    newSource = {
      id: `src-${Date.now()}`,
      name: name as string,
      type: 'xc',
      path: xcData.server || 'Xtream Codes Source',
      xc_data: xc,
      isActive: isActive === 'true',
      refreshHours: parseInt(refreshHours || '0', 10) || 0,
      lastUpdated: new Date().toISOString(),
      status: 'Pending',
      statusMessage: 'Source added. Process to load data.',
      selectedGroups: parsedSelectedGroups,
    };
  } else {
    newSource = {
      id: `src-${Date.now()}`,
      name: name as string,
      type: req.file ? 'file' : 'url',
      path: req.file ? req.file.path : (url as string),
      isActive: isActive === 'true',
      refreshHours: parseInt(refreshHours || '0', 10) || 0,
      lastUpdated: new Date().toISOString(),
      status: 'Pending',
      statusMessage: 'Source added. Process to load data.',
      selectedGroups: parsedSelectedGroups,
    };
  }

  if (newSource.type === 'url' && !newSource.path) {
    return res.status(400).json({ error: 'URL is required for URL-type source.' });
  }
  if (newSource.type === 'file' && !req.file) {
    return res.status(400).json({ error: 'A file must be selected for new file-based sources.' });
  }

  if (req.file) {
    const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
    const newPath = path.join(SOURCES_DIR, `${sourceType}_${newSource.id}${extension}`);
    try {
      fs.renameSync(req.file.path, newPath);
      newSource.path = newPath;
    } catch (e) {
      console.error('[SOURCES_API] Error renaming new source file:', e);
      return res.status(500).json({ error: 'Could not save uploaded file.' });
    }
  }

  sourceList.push(newSource);

  if (newSource.type === 'xc') {
    try {
      const xcData = JSON.parse((newSource as M3uSource).xc_data as string) as { server: string; username: string; password: string };
      const epgUrl = `${xcData.server}/xmltv.php?username=${xcData.username}&password=${xcData.password}`;
      settings.epgSources.push({
        id: `epg_for_${newSource.id}`,
        name: `${newSource.name} (EPG)`,
        type: 'url',
        path: epgUrl,
        isActive: true,
        isXcEpg: true,
        refreshHours: newSource.refreshHours,
        lastUpdated: new Date().toISOString(),
        status: 'Pending',
        statusMessage: 'Managed by XC source. Process to load data.',
      });
    } catch (e) {
      console.error(`[SOURCES_API] Failed to create automatic EPG for new XC source ${newSource.id}:`, (e as Error).message);
    }
  }

  saveSettings(settings);
  res.json({ success: true, message: 'Source added successfully.', settings: getSettings() });
});

sourcesRouter.put('/sources/:sourceType/:id', requireAuth, (req, res) => {
  const { sourceType, id } = req.params;
  const { name, path: newPath, isActive } = req.body as { name?: string; path?: string; isActive?: boolean };

  const settings = getSettings();
  const sourceList: Array<M3uSource | EpgSource> = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
  const source = sourceList.find((s) => s.id === id) as M3uSource | undefined;

  if (!source) {
    return res.status(404).json({ error: 'Source not found.' });
  }

  source.name = name ?? source.name;
  source.isActive = isActive ?? source.isActive;
  if (source.type === 'url' && newPath !== undefined) {
    source.path = newPath;
  }
  source.lastUpdated = new Date().toISOString();

  saveSettings(settings);
  res.json({ success: true, message: 'Source updated.', settings: getSettings() });
});

sourcesRouter.delete('/sources/:sourceType/:id', requireAuth, async (req, res) => {
  const { sourceType, id } = req.params;

  const settings = getSettings();
  const sourceList: Array<M3uSource | EpgSource> = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
  const source = sourceList.find((s) => s.id === id) as M3uSource | undefined;

  if (source && source.type === 'file' && fs.existsSync(source.path)) {
    try { fs.unlinkSync(source.path); } catch (e) { console.error(`[SOURCES_API] Could not delete source file: ${source.path}`, e); }
  }
  if (source?.cachedRawPath && fs.existsSync(source.cachedRawPath)) {
    try { fs.unlinkSync(source.cachedRawPath); } catch (e) { console.error(`[SOURCES_API] Could not delete cached raw file: ${source.cachedRawPath}`, e); }
  }

  const initialLength = sourceList.length;
  const newList = sourceList.filter((s) => s.id !== id);
  if (sourceType === 'm3u') settings.m3uSources = newList as M3uSource[];
  else settings.epgSources = newList as EpgSource[];

  if (newList.length === initialLength) {
    return res.status(404).json({ error: 'Source not found.' });
  }

  if (sourceType === 'm3u' && source && source.type === 'xc') {
    const epgIdToDelete = `epg_for_${id}`;
    settings.epgSources = settings.epgSources.filter((epg) => epg.id !== epgIdToDelete);
  }

  saveSettings(settings);

  if (sourceType === 'm3u' && source?.type === 'xc') {
    try {
      await db.transaction(async (trx) => {
        await trx('provider_movie_relations').where({ provider_id: id }).del();
        await trx('provider_series_relations').where({ provider_id: id }).del();
        await trx('provider_episode_relations').where({ provider_id: id }).del();
        await trx('movies').whereNotIn('id', trx('provider_movie_relations').distinct('movie_id')).del();
        await trx('series').whereNotIn('id', trx('provider_series_relations').distinct('series_id')).del();
        await trx('episodes').whereNotIn('id', trx('provider_episode_relations').distinct('episode_id')).del();
      });
    } catch (dbErr) {
      console.error(`[SOURCES_API] Error cleaning up VOD data for provider ${id}:`, (dbErr as Error).message);
    }
  }

  res.json({ success: true, message: 'Source deleted.', settings: getSettings() });
});

sourcesRouter.post('/process-sources', requireAuth, async (_req, res) => {
  try {
    const result = await processAndMergeSources();
    if (result.success) {
      saveSettings(result.updatedSettings);
      res.json({ success: true, message: 'Sources merged successfully.' });
    } else {
      res.status(500).json({ error: result.message || 'Failed to process sources.' });
    }
  } catch (error) {
    console.error('[API] Error during manual source processing:', error);
    res.status(500).json({ error: 'Failed to process sources. Check server logs.' });
  }
});

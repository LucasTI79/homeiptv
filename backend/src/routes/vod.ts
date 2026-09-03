import fs from 'fs';
import { spawn } from 'child_process';
import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { getSettings } from '../services/settings';
import { XtreamClient } from '../services/xtreamClient';
import { refreshVodContent, processM3uVod } from '../services/vodProcessor';
import type { M3uSource } from '@homeiptv/shared-types';

// Ports the four /api/vod/* routes from server.js:2198-2357, 2362-2567,
// 2570-2580, 3387-3444.
export const vodRouter = Router();

interface AllowedSourceRule {
  allowed: boolean;
  groups?: string[];
}

function buildProviderMap(providers: M3uSource[]): Map<string, { baseUrl: string; username: string; password: string }> {
  const providerMap = new Map<string, { baseUrl: string; username: string; password: string }>();
  for (const p of providers) {
    try {
      const xcInfo = JSON.parse(p.xc_data as string) as { server: string; username: string; password: string };
      const url = new URL(xcInfo.server);
      providerMap.set(p.id, { baseUrl: `${url.protocol}//${url.host}`, username: xcInfo.username, password: xcInfo.password });
    } catch (e) {
      console.error(`[API_VOD] Skipping provider ${p.name}, invalid XC data: ${(e as Error).message}`);
    }
  }
  return providerMap;
}

vodRouter.post('/vod/refresh', requireAuth, async (_req, res) => {
  try {
    const settings = getSettings();
    const activeSources = settings.m3uSources.filter((s) => s.isActive);
    const activeUserAgent = settings.userAgents.find((ua) => ua.id === settings.activeUserAgentId)?.value || 'VLC/3.0.20 (Linux; x86_64)';

    let syncedCount = 0;
    for (const source of activeSources) {
      if (source.type === 'xc') {
        await refreshVodContent(source, activeUserAgent);
        syncedCount++;
      } else if (source.type === 'file' || source.type === 'url') {
        if (source.cachedRawPath && fs.existsSync(source.cachedRawPath)) {
          const content = fs.readFileSync(source.cachedRawPath, 'utf-8');
          await processM3uVod(content, source);
          syncedCount++;
        }
      }
    }

    res.json({ success: true, message: `VOD content refreshed for ${syncedCount} sources.` });
  } catch (err) {
    console.error('[API_VOD] Failed to refresh VOD library:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

vodRouter.get('/vod/library', requireAuth, async (req, res) => {
  try {
    let allowedSources: Record<string, AllowedSourceRule> | null = null;
    try {
      const user = await db('users').select('allowed_sources').where({ id: req.session.userId }).first();
      if (user?.allowed_sources) allowedSources = JSON.parse(user.allowed_sources);
    } catch (dbErr) {
      console.error('[API_VOD] Error fetching user permissions:', dbErr);
    }

    const settings = getSettings();
    let activeXcProviders = settings.m3uSources.filter((s) => s.isActive && s.type === 'xc');

    if (allowedSources) {
      const rules = allowedSources;
      activeXcProviders = activeXcProviders.filter((p) => Boolean(rules[p.id]?.allowed));
    }

    const providerMap = buildProviderMap(activeXcProviders);
    const activeProviderIds = Array.from(providerMap.keys());
    if (activeProviderIds.length === 0) {
      return res.json({ movies: [], series: [] });
    }

    const movies = await db('movies as m')
      .join('provider_movie_relations as r', 'm.id', 'r.movie_id')
      .whereIn('r.provider_id', activeProviderIds)
      .select('m.provider_unique_id', 'm.name', 'm.year', 'm.description', 'm.logo', 'm.tmdb_id', 'm.imdb_id', 'm.category_name', 'r.stream_id', 'r.container_extension', 'r.provider_id')
      .orderBy('m.name');

    const processedMovies = movies
      .map((m) => {
        const provider = providerMap.get(m.provider_id);
        if (!provider) return null;

        if (allowedSources) {
          const perms = allowedSources[m.provider_id];
          if (perms?.allowed) {
            const allowedGroups = perms.groups || [];
            if (allowedGroups.length > 0 && !allowedGroups.includes(m.category_name)) return null;
          }
        }

        const ext = m.container_extension || 'mp4';
        return {
          id: m.provider_unique_id,
          name: m.name,
          year: m.year,
          description: m.description,
          logo: m.logo,
          tmdb_id: m.tmdb_id,
          imdb_id: m.imdb_id,
          url: `${provider.baseUrl}/movie/${provider.username}/${provider.password}/${m.stream_id}.${ext}`,
          type: 'movie',
          group: m.category_name,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const seriesList = await db('series as s')
      .join('provider_series_relations as r', 's.id', 'r.series_id')
      .whereIn('r.provider_id', activeProviderIds)
      .distinct('s.provider_unique_id', 's.name', 's.year', 's.description', 's.logo', 's.tmdb_id', 's.imdb_id', 's.category_name', 'r.provider_id')
      .orderBy('s.name');

    const processedSeries = seriesList
      .map((series) => {
        if (allowedSources) {
          const perms = allowedSources[series.provider_id];
          if (perms?.allowed) {
            const allowedGroups = perms.groups || [];
            if (allowedGroups.length > 0 && !allowedGroups.includes(series.category_name)) return null;
          }
        }
        return { ...series, type: 'series', id: series.provider_unique_id, group: series.category_name };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const uniqueCategories = new Set<string>();
    processedMovies.forEach((m) => { if (m.group) uniqueCategories.add(m.group); });
    processedSeries.forEach((s) => { if (s.group) uniqueCategories.add(s.group); });

    res.json({ movies: processedMovies, series: processedSeries, categories: Array.from(uniqueCategories).sort() });
  } catch (error) {
    console.error(`[API_VOD] Error fetching VOD library from DB: ${(error as Error).message}`, error);
    res.status(500).json({ error: 'Could not retrieve VOD library from database.' });
  }
});

const pendingSeriesFetches = new Map<number, Promise<void>>();

vodRouter.get('/vod/series/:seriesId', requireAuth, async (req, res) => {
  const seriesIdParam = req.params.seriesId;

  try {
    const seriesInfo = await db('series').where({ provider_unique_id: seriesIdParam }).first();
    if (!seriesInfo) {
      return res.status(404).json({ error: 'Series not found.' });
    }
    const numericSeriesId: number = seriesInfo.id;

    const episodeQuery = () =>
      db('episodes as e')
        .join('provider_episode_relations as r', 'e.id', 'r.episode_id')
        .where('e.series_id', numericSeriesId)
        .select('e.*', 'r.provider_id', 'r.provider_stream_id', 'r.container_extension')
        .orderBy(['e.season_num', 'e.episode_num']);

    let episodesToReturn = await episodeQuery();

    if (episodesToReturn.length === 0) {
      const relation = await db('provider_series_relations').select('provider_id', 'external_series_id').where({ series_id: numericSeriesId }).first();
      if (!relation) {
        return res.status(404).json({ error: 'Could not find provider information for this series.' });
      }

      try {
        const user = await db('users').select('allowed_sources').where({ id: req.session.userId }).first();
        if (user?.allowed_sources) {
          const allowedSources = JSON.parse(user.allowed_sources) as Record<string, AllowedSourceRule>;
          const rule = allowedSources[relation.provider_id];
          if (!rule || !rule.allowed) {
            return res.status(403).json({ error: 'Access denied to this series.' });
          }
        }
      } catch (dbErr) {
        console.error('[API_VOD] Error checking user permissions:', dbErr);
      }

      if (pendingSeriesFetches.has(numericSeriesId)) {
        await pendingSeriesFetches.get(numericSeriesId);
      } else {
        const fetchPromise = (async () => {
          const settings = getSettings();
          const providerConfig = settings.m3uSources.find((s) => s.id === relation.provider_id);
          if (!providerConfig || providerConfig.type !== 'xc' || !providerConfig.xc_data) {
            throw new Error('Could not find or parse XC provider configuration for this series.');
          }

          const xcInfo = JSON.parse(providerConfig.xc_data) as { server: string; username: string; password: string };
          const activeUserAgent = settings.userAgents.find((ua) => ua.id === settings.activeUserAgentId)?.value || 'VLC/3.0.20 (Linux; x86_64)';
          const client = new XtreamClient(xcInfo.server, xcInfo.username, xcInfo.password, activeUserAgent);

          const seriesDetails = await client.getSeriesInfo(relation.external_series_id) as {
            episodes?: unknown;
          };
          if (!seriesDetails?.episodes) {
            console.warn(`[API_VOD_SERIES] Provider returned no episode data for external ID ${relation.external_series_id}.`);
            return;
          }

          const lastSeen = new Date().toISOString();
          const seasonsEntries = Array.isArray(seriesDetails.episodes)
            ? ([['1', seriesDetails.episodes]] as [string, unknown[]][])
            : (Object.entries(seriesDetails.episodes as Record<string, unknown[]>));

          await db.transaction(async (trx) => {
            for (const [seasonNum, epList] of seasonsEntries) {
              if (!Array.isArray(epList)) continue;
              for (const epDataRaw of epList) {
                const epData = epDataRaw as {
                  season?: number; episode_num?: number; episode?: number; title?: string; name?: string;
                  info?: { plot?: string; releasedate?: string; release_date?: string }; plot?: string; release_date?: string;
                  id?: string | number; stream_id?: string | number; container_extension?: string;
                };
                const season = parseInt(String(epData.season ?? seasonNum), 10) || 0;
                const epNum = parseInt(String(epData.episode_num ?? epData.episode ?? 0), 10) || 0;
                const title = epData.title || epData.name || `Episode ${epNum}`;
                const plot = epData.info?.plot ?? epData.plot ?? null;
                const releaseDate = epData.info?.releasedate ?? epData.info?.release_date ?? epData.release_date ?? null;
                const streamId = String(epData.id || epData.stream_id || '');
                const ext = epData.container_extension || 'mp4';

                let episodeId: number;
                const existingEp = await trx('episodes').select('id').where({ series_id: numericSeriesId, season_num: season, episode_num: epNum }).first();

                if (existingEp) {
                  episodeId = existingEp.id;
                } else {
                  const [row] = await trx('episodes')
                    .insert({ series_id: numericSeriesId, season_num: season, episode_num: epNum, name: title, description: plot, air_date: releaseDate })
                    .returning('id');
                  episodeId = typeof row === 'number' ? row : (row as { id: number }).id;
                }

                if (episodeId && streamId) {
                  await trx('provider_episode_relations')
                    .insert({ provider_id: relation.provider_id, episode_id: episodeId, provider_stream_id: streamId, container_extension: ext, last_seen: lastSeen })
                    .onConflict(['provider_id', 'episode_id']).ignore();
                }
              }
            }
          });
          console.log(`[API_VOD_SERIES] Successfully saved episodes for Series ID ${numericSeriesId} to DB.`);
        })();

        pendingSeriesFetches.set(numericSeriesId, fetchPromise);
        try {
          await fetchPromise;
        } finally {
          pendingSeriesFetches.delete(numericSeriesId);
        }
      }

      episodesToReturn = await episodeQuery();
    }

    const seasons = new Map<number, unknown[]>();
    const settings = getSettings();
    const providerMap = buildProviderMap(settings.m3uSources.filter((s) => s.isActive && s.type === 'xc'));

    episodesToReturn.forEach((ep) => {
      const provider = providerMap.get(ep.provider_id);
      if (!provider) return;

      const ext = ep.container_extension || 'mp4';
      const epUrl = `${provider.baseUrl}/series/${provider.username}/${provider.password}/${ep.provider_stream_id}.${ext}`;
      if (!seasons.has(ep.season_num)) seasons.set(ep.season_num, []);
      seasons.get(ep.season_num)!.push({
        id: String(ep.id),
        name: ep.name,
        description: ep.description,
        air_date: ep.air_date,
        tmdb_id: ep.tmdb_id,
        season: ep.season_num,
        episode: ep.episode_num,
        url: epUrl,
      });
    });

    res.json({
      ...seriesInfo,
      id: seriesInfo.provider_unique_id,
      type: 'series',
      group: seriesInfo.category_name,
      seasons: Object.fromEntries(seasons),
    });
  } catch (error) {
    console.error(`[API_VOD_SERIES] Error fetching details for Series ID ${seriesIdParam}: ${(error as Error).message}`, error);
    res.status(500).json({ error: 'Could not retrieve series details.' });
  }
});

vodRouter.get('/vod/categories', requireAuth, async (_req, res) => {
  try {
    const categories = await db('vod_categories').select('category_name').orderBy('category_name');
    res.json({ success: true, categories: categories.map((c) => c.category_name) });
  } catch (error) {
    console.error(`[API_VOD] Error fetching VOD categories: ${(error as Error).message}`, error);
    res.status(500).json({ error: 'Could not retrieve VOD categories.' });
  }
});

vodRouter.get('/vod/duration', requireAuth, (req, res) => {
  const sourceUrl = req.query.url as string | undefined;
  const userAgentId = req.query.userAgentId as string | undefined;
  if (!sourceUrl) {
    return res.status(400).json({ error: '`url` query parameter is required.' });
  }

  const settings = getSettings();
  const userAgent = settings.userAgents.find((ua) => ua.id === userAgentId);

  const args = [
    '-v', 'error',
    ...(userAgent ? ['-user_agent', userAgent.value] : []),
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    sourceUrl,
  ];

  console.log(`[VOD_DURATION] Probing: ${sourceUrl}`);
  const ffprobe = spawn('ffprobe', args);
  let output = '';
  let errorOutput = '';
  let responded = false;

  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      ffprobe.kill('SIGKILL');
      console.warn(`[VOD_DURATION] Probe timed out: ${sourceUrl}`);
      res.status(504).json({ error: 'Probe timed out' });
    }
  }, 8000);

  ffprobe.stdout.on('data', (data) => { output += data.toString(); });
  ffprobe.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ffprobe.on('close', () => {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);
    const duration = parseFloat(output.trim());
    if (!isNaN(duration) && duration > 0) {
      res.json({ duration });
    } else {
      console.warn(`[VOD_DURATION] Could not determine duration for ${sourceUrl}: ${errorOutput.trim()}`);
      res.status(422).json({ error: 'Could not determine duration' });
    }
  });

  ffprobe.on('error', (err) => {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);
    console.error(`[VOD_DURATION] ffprobe spawn error: ${err.message}`);
    res.status(500).json({ error: 'ffprobe failed to start' });
  });
});

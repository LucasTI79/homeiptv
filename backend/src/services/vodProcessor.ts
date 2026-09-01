import { db } from '../db/connection';
import { XtreamClient } from './xtreamClient';
import type { M3uSource } from '@viniplay/shared-types';

export type SendStatus = (message: string, type?: string) => void;
const noopStatus: SendStatus = () => {};

// Ports refreshVodContent from vodProcessor.js:10-247, using Knex instead of
// raw sqlite3 prepared statements (so it works against any of the drivers
// configured in db/knexfile.ts, not just SQLite). Behavior -- including the
// app-level "look up by provider_unique_id, update if found else insert"
// pattern for movies/series -- is kept identical to the original; only the
// query mechanics changed. The original's ad-hoc "ALTER TABLE ADD COLUMN
// provider_unique_id" migration is dropped since the Knex schema already
// includes that column from the initial migration.
export async function refreshVodContent(
  provider: M3uSource,
  userAgent: string,
  sendStatus: SendStatus = noopStatus,
): Promise<void> {
  console.log(`[VOD Processor] Starting VOD refresh for: ${provider.name}`);
  const scanStartTime = new Date().toISOString();

  let serverUrl: string, username: string, password: string;
  try {
    if (!provider.xc_data) throw new Error('Provider object is missing xc_data.');
    const xcInfo = JSON.parse(provider.xc_data) as { server?: string; username?: string; password?: string };
    if (!xcInfo.server || !xcInfo.username || !xcInfo.password) {
      throw new Error('Missing server, username, or password within xc_data.');
    }
    serverUrl = xcInfo.server;
    username = xcInfo.username;
    password = xcInfo.password;
  } catch (parseError) {
    console.error(`[VOD Processor] Failed to parse XC credentials for provider ${provider.name}: ${(parseError as Error).message}`);
    sendStatus(`Failed to parse XC credentials for ${provider.name}`, 'error');
    return;
  }

  const client = new XtreamClient(serverUrl, username, password, userAgent);
  const providerId = provider.id;

  const categoryMap = new Map<string, string>();
  try {
    sendStatus(`Fetching VOD and Series categories for ${provider.name}...`, 'info');
    const [vodCategories, seriesCategories] = await Promise.all([client.getVodCategories(), client.getSeriesCategories()]);

    const allCategories: Record<string, { category_id: string; category_name: string }> = {};
    if (Array.isArray(vodCategories)) vodCategories.forEach((cat) => { allCategories[cat.category_id] = cat; });
    if (Array.isArray(seriesCategories)) seriesCategories.forEach((cat) => { allCategories[cat.category_id] = cat; });
    const combinedCategories = Object.values(allCategories);

    if (combinedCategories.length > 0) {
      console.log(`[VOD Processor] Fetched ${combinedCategories.length} combined VOD/Series categories from provider.`);
      sendStatus(`Processing ${combinedCategories.length} VOD/Series categories...`, 'info');

      await db.transaction(async (trx) => {
        for (const cat of combinedCategories) {
          if (cat.category_id && cat.category_name) {
            await trx('vod_categories').insert({ category_id: cat.category_id, category_name: cat.category_name }).onConflict('category_id').ignore();
            categoryMap.set(String(cat.category_id), cat.category_name);
          }
        }
      });
    }
  } catch (error) {
    console.error(`[VOD Processor] Category processing FAILED for ${provider.name}:`, (error as Error).message);
    sendStatus(`Category processing FAILED for ${provider.name}: ${(error as Error).message}`, 'error');
    return;
  }

  // --- Movies ---
  try {
    sendStatus(`Fetching movies for ${provider.name}...`, 'info');
    const movies = await client.getVodStreams() as Array<{
      name: string; plot?: string; stream_icon?: string; stream_id: string | number;
      container_extension?: string; category_id?: string; releaseDate?: string;
    }>;

    if (Array.isArray(movies)) {
      console.log(`[VOD Processor] Fetched ${movies.length} movies from provider.`);
      sendStatus(`Processing ${movies.length} movies...`, 'info');

      await db.transaction(async (trx) => {
        const existingMovies = await trx('movies').select('id', 'provider_unique_id').whereNotNull('provider_unique_id');
        const providerUniqueIdMap = new Map<string, number>(existingMovies.map((m) => [m.provider_unique_id, m.id]));

        for (const movieData of movies) {
          const { name, plot, stream_icon: streamIcon, stream_id: streamId, container_extension: containerExtension, category_id: categoryId } = movieData;
          if (!streamId) continue;

          const providerUniqueId = `movie_${providerId}_${streamId}`;
          let year: number | null = null;
          if (movieData.releaseDate) year = new Date(movieData.releaseDate).getFullYear();
          else if (name) {
            const yearMatch = name.match(/\((\d{4})\)/);
            if (yearMatch) year = parseInt(yearMatch[1], 10);
          }
          const categoryName = categoryMap.get(String(categoryId)) || 'VOD';

          let movieId = providerUniqueIdMap.get(providerUniqueId);
          if (movieId) {
            await trx('movies').where({ id: movieId }).update({ name, year, description: plot, logo: streamIcon, category_name: categoryName });
          } else {
            const [row] = await trx('movies').insert({ name, year, description: plot, logo: streamIcon, category_name: categoryName, provider_unique_id: providerUniqueId }).returning('id');
            movieId = typeof row === 'number' ? row : (row as { id: number }).id;
            providerUniqueIdMap.set(providerUniqueId, movieId);
          }

          await trx('provider_movie_relations')
            .insert({ provider_id: providerId, movie_id: movieId, stream_id: streamId, container_extension: containerExtension || 'mp4', last_seen: scanStartTime })
            .onConflict(['provider_id', 'stream_id']).merge();
        }
      });
    }
  } catch (error) {
    console.error(`[VOD Processor] Movie processing FAILED for ${provider.name}:`, (error as Error).message);
    sendStatus(`Movie processing FAILED for ${provider.name}: ${(error as Error).message}`, 'error');
  }

  // --- Series ---
  try {
    sendStatus(`Fetching series for ${provider.name}...`, 'info');
    const seriesList = await client.getSeries() as Array<{
      name: string; plot?: string; cover?: string; series_id: string | number; category_id?: string; releaseDate?: string;
    }>;

    if (Array.isArray(seriesList)) {
      console.log(`[VOD Processor] Fetched ${seriesList.length} series from provider.`);
      sendStatus(`Processing ${seriesList.length} series...`, 'info');

      await db.transaction(async (trx) => {
        const existingSeries = await trx('series').select('id', 'provider_unique_id').whereNotNull('provider_unique_id');
        const providerUniqueIdMap = new Map<string, number>(existingSeries.map((s) => [s.provider_unique_id, s.id]));

        for (const seriesData of seriesList) {
          const { name, plot, cover, series_id: externalSeriesId, category_id: categoryId } = seriesData;
          if (!externalSeriesId) continue;

          const providerUniqueId = `series_${providerId}_${externalSeriesId}`;
          let year: number | null = null;
          if (seriesData.releaseDate) year = new Date(seriesData.releaseDate).getFullYear();
          else if (name) {
            const yearMatch = name.match(/\((\d{4})\)/);
            if (yearMatch) year = parseInt(yearMatch[1], 10);
          }
          const categoryName = categoryMap.get(String(categoryId)) || 'Series';

          let seriesId = providerUniqueIdMap.get(providerUniqueId);
          if (seriesId) {
            await trx('series').where({ id: seriesId }).update({ name, year, description: plot, logo: cover, category_name: categoryName });
          } else {
            const [row] = await trx('series').insert({ name, year, description: plot, logo: cover, category_name: categoryName, provider_unique_id: providerUniqueId }).returning('id');
            seriesId = typeof row === 'number' ? row : (row as { id: number }).id;
            providerUniqueIdMap.set(providerUniqueId, seriesId);
          }

          await trx('provider_series_relations')
            .insert({ provider_id: providerId, series_id: seriesId, external_series_id: String(externalSeriesId), last_seen: scanStartTime })
            .onConflict(['provider_id', 'external_series_id']).merge();
        }
      });
    }
  } catch (error) {
    console.error(`[VOD Processor] Series processing FAILED for ${provider.name}:`, (error as Error).message);
    sendStatus(`Series processing FAILED for ${provider.name}: ${(error as Error).message}`, 'error');
  }

  // --- Cleanup stale + orphaned content ---
  try {
    console.log(`[VOD Processor] Cleaning up stale VOD content for ${provider.name}...`);
    sendStatus(`Cleaning up old VOD entries for ${provider.name}...`, 'info');

    await db.transaction(async (trx) => {
      const staleMovies = await trx('provider_movie_relations').where('provider_id', providerId).andWhere('last_seen', '<', scanStartTime).del();
      if (staleMovies > 0) console.log(`[VOD Processor] Removed ${staleMovies} stale movie relations.`);

      const staleSeries = await trx('provider_series_relations').where('provider_id', providerId).andWhere('last_seen', '<', scanStartTime).del();
      if (staleSeries > 0) console.log(`[VOD Processor] Removed ${staleSeries} stale series relations.`);

      const staleEpisodes = await trx('provider_episode_relations').where('provider_id', providerId).andWhere('last_seen', '<', scanStartTime).del();
      if (staleEpisodes > 0) console.log(`[VOD Processor] Removed ${staleEpisodes} stale episode relations.`);

      await trx('movies').whereNotIn('id', trx('provider_movie_relations').distinct('movie_id')).del();
      await trx('series').whereNotIn('id', trx('provider_series_relations').distinct('series_id')).del();
      await trx('episodes').whereNotIn('id', trx('provider_episode_relations').distinct('episode_id')).del();
    });

    console.log(`[VOD Processor] VOD cleanup completed for: ${provider.name}`);
  } catch (error) {
    console.error(`[VOD Processor] Cleanup FAILED for ${provider.name}:`, (error as Error).message);
    sendStatus(`Cleanup FAILED for ${provider.name}: ${(error as Error).message}`, 'error');
  }

  console.log(`[VOD Processor] VOD refresh completed for: ${provider.name}`);
  sendStatus(`VOD refresh successful for ${provider.name}.`, 'success');
}

// Ports processM3uVod from vodProcessor.js:259-380 (plain-M3U VOD detection,
// for non-XC sources) using Knex instead of raw prepared statements.
export async function processM3uVod(m3uContent: string, provider: M3uSource, sendStatus: SendStatus = noopStatus): Promise<void> {
  console.log(`[VOD Processor M3U] Starting VOD processing for M3U source: ${provider.name}`);
  const scanStartTime = new Date().toISOString();
  const providerId = provider.id;

  try {
    const lines = m3uContent.split('\n');
    let currentExtInf: { line: string; attributes: Record<string, string>; name: string } | null = null;
    const movies: Array<{ name: string; attributes: Record<string, string>; url: string }> = [];
    const series: Array<{ name: string; attributes: Record<string, string>; url: string }> = [];
    const attributeRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        const attributes: Record<string, string> = {};
        let match: RegExpExecArray | null;
        while ((match = attributeRegex.exec(line)) !== null) {
          attributes[match[1]] = match[2];
        }
        const nameMatch = line.match(/,(.*)$/);
        currentExtInf = { line: line.trim(), attributes, name: nameMatch ? nameMatch[1].trim() : 'Untitled' };
      } else if (line.trim().startsWith('http') && currentExtInf) {
        const url = line.trim();
        const isMovie = url.includes('/movie/') || currentExtInf.attributes['tvg-type'] === 'movie';
        const isSeries = url.includes('/series/') || currentExtInf.attributes['tvg-type'] === 'series';

        if (isMovie) movies.push({ ...currentExtInf, url });
        else if (isSeries) series.push({ ...currentExtInf, url });
        currentExtInf = null;
      }
    }

    console.log(`[VOD Processor M3U] Found ${movies.length} movies and ${series.length} series in M3U.`);
    sendStatus(`Processing ${movies.length} movies and ${series.length} series from ${provider.name}...`, 'info');

    await db.transaction(async (trx) => {
      if (movies.length > 0) {
        const existingMovies = await trx('movies').select('id', 'provider_unique_id').whereNotNull('provider_unique_id');
        const providerUniqueIdMap = new Map<string, number>(existingMovies.map((m) => [m.provider_unique_id, m.id]));

        for (const movieData of movies) {
          const { name, attributes, url } = movieData;
          const streamId = url.substring(url.lastIndexOf('/') + 1).split('.')[0];
          const providerUniqueId = `movie_${providerId}_${streamId}`;
          const yearMatch = name.match(/\((\d{4})\)/);
          const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
          const logo = attributes['tvg-logo'] || null;
          const categoryName = attributes['group-title'] || 'VOD';

          let movieId = providerUniqueIdMap.get(providerUniqueId);
          if (!movieId) {
            const [row] = await trx('movies').insert({ name, year, logo, category_name: categoryName, provider_unique_id: providerUniqueId }).onConflict('provider_unique_id').ignore().returning('id');
            if (row === undefined) {
              const existing = await trx('movies').select('id').where({ provider_unique_id: providerUniqueId }).first();
              movieId = existing!.id;
            } else {
              movieId = typeof row === 'number' ? row : (row as { id: number }).id;
            }
            providerUniqueIdMap.set(providerUniqueId, movieId!);
          }

          const extension = url.split('.').pop() || 'mp4';
          await trx('provider_movie_relations')
            .insert({ provider_id: providerId, movie_id: movieId, stream_id: streamId, container_extension: extension, last_seen: scanStartTime })
            .onConflict(['provider_id', 'stream_id']).merge();
        }
      }

      if (series.length > 0) {
        const existingSeries = await trx('series').select('id', 'provider_unique_id').whereNotNull('provider_unique_id');
        const providerUniqueIdMap = new Map<string, number>(existingSeries.map((s) => [s.provider_unique_id, s.id]));

        for (const seriesData of series) {
          const { name, attributes, url } = seriesData;
          const externalSeriesId = name.replace(/\s+/g, '_').toLowerCase();
          const providerUniqueId = `series_${providerId}_${externalSeriesId}`;
          const yearMatch = name.match(/\((\d{4})\)/);
          const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
          const logo = attributes['tvg-logo'] || null;
          const categoryName = attributes['group-title'] || 'Series';

          let seriesId = providerUniqueIdMap.get(providerUniqueId);
          if (!seriesId) {
            const [row] = await trx('series').insert({ name, year, logo, category_name: categoryName, provider_unique_id: providerUniqueId }).onConflict('provider_unique_id').ignore().returning('id');
            if (row === undefined) {
              const existing = await trx('series').select('id').where({ provider_unique_id: providerUniqueId }).first();
              seriesId = existing!.id;
            } else {
              seriesId = typeof row === 'number' ? row : (row as { id: number }).id;
            }
            providerUniqueIdMap.set(providerUniqueId, seriesId!);
          }

          await trx('provider_series_relations')
            .insert({ provider_id: providerId, series_id: seriesId, external_series_id: externalSeriesId, last_seen: scanStartTime })
            .onConflict(['provider_id', 'external_series_id']).merge();
        }
      }
    });

    sendStatus(`Successfully processed VOD content from ${provider.name}.`, 'success');
  } catch (error) {
    console.error(`[VOD Processor M3U] Processing FAILED for ${provider.name}:`, (error as Error).message);
    sendStatus(`M3U VOD processing FAILED for ${provider.name}: ${(error as Error).message}`, 'error');
  }
}

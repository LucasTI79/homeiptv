import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { allowLocalOrAuth } from '../middleware/allowLocalOrAuth';
import { activeCastTokens } from '../state/streamState';
import { getSettings, saveSettings } from '../services/settings';
import {
  previewFolderScan,
  prepareFolderStructure,
  scanAllFolders,
  getLocalMediaIndex,
} from '../services/localMediaScanner';
import type { LocalMediaFolder } from '@homeiptv/shared-types';

export const localMediaRouter = Router();
const streamAuth = allowLocalOrAuth(activeCastTokens);

// MIME type dictionary
const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * POST /api/local-media/validate-path
 * Validates a folder path on the server and returns a preview/diagnostic scan.
 */
localMediaRouter.post('/local-media/validate-path', requireAuth, (req, res) => {
  const { folderPath } = req.body as { folderPath?: string };
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'folderPath é obrigatório.' });
  }

  const normalized = path.resolve(folderPath.trim());
  const preview = previewFolderScan(normalized);
  return res.json(preview);
});

/**
 * POST /api/local-media/prepare-structure
 * Automatically creates the recommended folder structure (Filmes/..., Series/...) and README guide.
 */
localMediaRouter.post('/local-media/prepare-structure', requireAuth, (req, res) => {
  const { folderPath } = req.body as { folderPath?: string };
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'folderPath é obrigatório.' });
  }

  const normalized = path.resolve(folderPath.trim());
  const result = prepareFolderStructure(normalized);
  return res.json(result);
});

/**
 * GET /api/local-media/folders
 * Returns the list of registered local media folders.
 */
localMediaRouter.get('/local-media/folders', requireAuth, (_req, res) => {
  const settings = getSettings();
  return res.json({ folders: settings.localMediaFolders || [] });
});

/**
 * POST /api/local-media/folders
 * Adds or updates a local media folder configuration.
 */
localMediaRouter.post('/local-media/folders', requireAuth, (req, res) => {
  const { id, name, path: folderPath, category, isActive } = req.body as Partial<LocalMediaFolder>;

  if (!name || !folderPath) {
    return res.status(400).json({ error: 'Nome e caminho da pasta são obrigatórios.' });
  }

  const normalizedPath = path.resolve(folderPath.trim());
  if (!fs.existsSync(normalizedPath)) {
    return res.status(400).json({ error: 'O caminho especificado não existe no servidor.' });
  }

  const settings = getSettings();
  if (!settings.localMediaFolders) {
    settings.localMediaFolders = [];
  }

  const folderId = id || `lmf-${Date.now()}`;
  const existingIdx = settings.localMediaFolders.findIndex((f) => f.id === folderId);

  const newFolder: LocalMediaFolder = {
    id: folderId,
    name: name.trim(),
    path: normalizedPath,
    category: category?.trim() || 'Mídia Local',
    isActive: isActive !== false,
  };

  if (existingIdx >= 0) {
    settings.localMediaFolders[existingIdx] = {
      ...settings.localMediaFolders[existingIdx],
      ...newFolder,
    };
  } else {
    settings.localMediaFolders.push(newFolder);
  }

  saveSettings(settings);

  // Trigger background scan to update library immediately
  try {
    const index = scanAllFolders();
    return res.json({
      success: true,
      folder: newFolder,
      totalMovies: index.movies.length,
      totalSeries: index.series.length,
    });
  } catch (err) {
    console.error('[LOCAL_MEDIA_API] Error scanning after save:', err);
    return res.json({ success: true, folder: newFolder });
  }
});

/**
 * DELETE /api/local-media/folders/:id
 * Removes a local media folder and updates index.
 */
localMediaRouter.delete('/local-media/folders/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const settings = getSettings();

  if (!settings.localMediaFolders) {
    return res.json({ success: true });
  }

  settings.localMediaFolders = settings.localMediaFolders.filter((f) => f.id !== id);
  saveSettings(settings);

  try {
    scanAllFolders();
  } catch (e) {
    console.warn('[LOCAL_MEDIA_API] Error rescan after delete:', e);
  }

  return res.json({ success: true });
});

/**
 * POST /api/local-media/scan
 * Force re-scan of all active folders.
 */
localMediaRouter.post('/local-media/scan', requireAuth, (_req, res) => {
  try {
    const index = scanAllFolders();
    return res.json({
      success: true,
      moviesCount: index.movies.length,
      seriesCount: index.series.length,
      episodesCount: index.episodes.length,
    });
  } catch (err) {
    console.error('[LOCAL_MEDIA_API] Error scanning folders:', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/local-media/poster
 * Serves local poster images with authentication / token support.
 */
localMediaRouter.get('/local-media/poster', streamAuth, (req, res) => {
  const fileQuery = req.query.file as string | undefined;
  if (!fileQuery) return res.status(400).send('Missing file parameter');

  const resolved = path.resolve(fileQuery);
  if (!fs.existsSync(resolved)) {
    return res.status(404).send('Poster not found');
  }

  const ext = path.extname(resolved).replace('.', '').toLowerCase();
  const contentType = MIME_TYPES[ext] || 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(resolved).pipe(res);
});

/**
 * GET /api/local-media/stream
 * High-performance HTTP Range (206) media streaming for local files.
 */
localMediaRouter.get('/local-media/stream', streamAuth, (req, res) => {
  const mediaId = req.query.id as string | undefined;
  const fileParam = req.query.file as string | undefined;

  let targetFilePath: string | null = null;

  if (mediaId) {
    const index = getLocalMediaIndex();
    const movie = index.movies.find((m) => m.id === mediaId);
    if (movie) {
      targetFilePath = movie.filePath;
    } else {
      const episode = index.episodes.find((e) => e.id === mediaId);
      if (episode) {
        targetFilePath = episode.filePath;
      }
    }
  } else if (fileParam) {
    targetFilePath = path.resolve(fileParam);
  }

  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    return res.status(404).json({ error: 'Media file not found.' });
  }

  try {
    const stat = fs.statSync(targetFilePath);
    const fileSize = stat.size;
    const ext = path.extname(targetFilePath).replace('.', '').toLowerCase();
    const forceTranscode = req.query.transcode === '1' || req.query.transcode === 'true';
    const NATIVE_VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm']);
    const isNative = NATIVE_VIDEO_EXTS.has(ext) && !forceTranscode;

    if (req.method === 'HEAD') {
      const contentType = isNative ? (MIME_TYPES[ext] || 'video/mp4') : 'video/mp4';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Accept-Ranges': isNative ? 'bytes' : 'none',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      });
      return res.end();
    }

    if (isNative) {
      const contentType = MIME_TYPES[ext] || 'video/mp4';
      const range = req.headers.range;

      if (range) {
        // Parse Range Header
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          return res.end();
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(targetFilePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
        });

        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
        });

        fs.createReadStream(targetFilePath).pipe(res);
      }
    } else {
      // Transcode sob demanda para fMP4 (fragmented MP4) com codec universal H.264 + AAC
      // Compatível com todos os navegadores modernos (Chrome, Firefox, Safari, Edge) e Chromecast
      const seekSeconds = Math.max(0, parseFloat((req.query.seek || req.query.t || req.query.start || '0') as string) || 0);

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'none',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      });

      const ffmpegArgs: string[] = [
        '-hide_banner',
        '-loglevel', 'warning',
      ];

      if (seekSeconds > 0) {
        ffmpegArgs.push('-ss', seekSeconds.toString());
      }

      ffmpegArgs.push(
        '-i', targetFilePath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
      );

      console.log(`[LOCAL_MEDIA_STREAM] Transcoding "${path.basename(targetFilePath)}" to fMP4 (seek: ${seekSeconds}s)`);
      const ffmpegProc = spawn('ffmpeg', ffmpegArgs);

      ffmpegProc.stdout.pipe(res);

      ffmpegProc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) {
          console.warn(`[LOCAL_MEDIA_STREAM_FFMPEG] ${msg}`);
        }
      });

      let isCleanedUp = false;
      const cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        try {
          ffmpegProc.stdout.unpipe(res);
          ffmpegProc.stdout.destroy();
          ffmpegProc.kill('SIGTERM');
          setTimeout(() => {
            if (!ffmpegProc.killed) {
              try {
                ffmpegProc.kill('SIGKILL');
              } catch {
                // ignore
              }
            }
          }, 1000);
        } catch {
          // ignore
        }
      };

      req.on('close', cleanup);
      req.on('error', cleanup);
      res.on('close', cleanup);
      res.on('finish', cleanup);
      res.on('error', cleanup);
      ffmpegProc.on('close', () => {
        isCleanedUp = true;
      });
    }
  } catch (err) {
    console.error('[LOCAL_MEDIA_STREAM] Error streaming file:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream media file.' });
    }
  }
});

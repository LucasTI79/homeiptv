import path from 'path';
import fs from 'fs';
import { Router } from 'express';
import { DOWNLOADS_DIR } from '../config/paths';
import { allowLocalOrAuth } from '../middleware/allowLocalOrAuth';
import { activeCastTokens } from '../state/streamState';

export const downloadsRouter = Router();
const streamAuth = allowLocalOrAuth(activeCastTokens);

// GET /api/downloads/check/:fileName
// Checks if a downloaded file is already available on the backend server
downloadsRouter.get('/downloads/check/:fileName', streamAuth, (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const filePath = path.join(DOWNLOADS_DIR, fileName);

  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    return res.json({
      exists: true,
      fileName,
      size: stat.size,
      streamUrl: `/api/downloads/stream/${fileName}`,
    });
  }

  return res.json({ exists: false, fileName });
});

// GET /api/downloads/list
// Returns all downloaded media files available in the backend storage
downloadsRouter.get('/downloads/list', streamAuth, (_req, res) => {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      return res.json({ files: [] });
    }
    const entries = fs.readdirSync(DOWNLOADS_DIR);
    const files = entries
      .filter((name) => !name.startsWith('.'))
      .map((name) => {
        const stat = fs.statSync(path.join(DOWNLOADS_DIR, name));
        return {
          fileName: name,
          size: stat.size,
          mtime: stat.mtimeMs,
          streamUrl: `/api/downloads/stream/${name}`,
        };
      });
    res.json({ files });
  } catch (err) {
    console.error('[DOWNLOADS_API] Error listing downloads:', err);
    res.status(500).json({ error: 'Failed to list downloads' });
  }
});

// POST /api/downloads/upload-local/:fileName
// Streams local media from client/PC directly to the backend storage
downloadsRouter.post('/downloads/upload-local/:fileName', streamAuth, (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const filePath = path.join(DOWNLOADS_DIR, fileName);
  const tempPath = `${filePath}.tmp_${Date.now()}`;

  const writeStream = fs.createWriteStream(tempPath);

  req.pipe(writeStream);

  writeStream.on('finish', () => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fs.renameSync(tempPath, filePath);
      const stat = fs.statSync(filePath);
      console.log(`[DOWNLOADS_API] Successfully stored local media: ${fileName} (${stat.size} bytes)`);
      res.json({
        success: true,
        fileName,
        size: stat.size,
        streamUrl: `/api/downloads/stream/${fileName}`,
      });
    } catch (err) {
      console.error('[DOWNLOADS_API] Error finalizing uploaded file:', err);
      res.status(500).json({ error: 'Failed to save downloaded file' });
    }
  });

  writeStream.on('error', (err) => {
    console.error('[DOWNLOADS_API] Error writing file stream:', err);
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
    res.status(500).json({ error: 'Stream write error' });
  });
});

// OPTIONS /api/downloads/stream/:fileName
downloadsRouter.options('/downloads/stream/:fileName', (_req, res) => {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  return res.end();
});

// GET /api/downloads/stream/:fileName
// Streams downloaded file with full HTTP Range request support (206 Partial Content) for Smart TVs, Chromecast, and local players
downloadsRouter.get('/downloads/stream/:fileName', streamAuth, (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const filePath = path.join(DOWNLOADS_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo baixado não encontrado no servidor' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return res.end();
  }

  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// DELETE /api/downloads/file/:fileName
downloadsRouter.delete('/downloads/file/:fileName', streamAuth, (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const filePath = path.join(DOWNLOADS_DIR, fileName);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return res.json({ success: true, message: 'Arquivo excluído com sucesso' });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao excluir arquivo' });
    }
  }

  return res.json({ success: true, message: 'Arquivo já removido' });
});

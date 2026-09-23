import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import { Router } from 'express';
import { allowLocalOrAuth } from '../middleware/allowLocalOrAuth';
import { requireAuth } from '../middleware/auth';
import { getSettings } from '../services/settings';
import { parseM3U } from '../services/sources';
import { LIVE_CHANNELS_M3U_PATH } from '../config/paths';
import { IMAGE_CACHE_DIR, cachePathsFor } from '../services/imageCache';
import { activeCastTokens } from '../state/streamState';

export const proxyRouter = Router();

function isForbiddenIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const o = ip.split('.').map(Number);
    if (o[0] === 127) return true;
    if (o[0] === 10) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    if (o[0] === 0) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) return isForbiddenIp(lower.slice(7));
    return false;
  }
  return true;
}

proxyRouter.get('/image-proxy', allowLocalOrAuth(), async (req, res) => {
  const imageUrl = req.query.url as string | undefined;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return res.status(400).send('Invalid URL');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).send('URL must use http or https');
  }

  const { cacheFilePath, cacheMetaPath } = cachePathsFor(imageUrl);
  if (fs.existsSync(cacheFilePath) && fs.existsSync(cacheMetaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf-8'));
      res.setHeader('Content-Type', meta.contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=2592000');
      res.setHeader('X-Cache', 'HIT');
      return fs.createReadStream(cacheFilePath).pipe(res);
    } catch {
      // ignore
    }
  }

  let resolvedAddress: string;
  let family: number;
  try {
    const lookupResult = await dns.promises.lookup(parsedUrl.hostname);
    resolvedAddress = lookupResult.address;
    family = lookupResult.family;
  } catch (err) {
    console.error(`[IMAGE_PROXY] DNS resolution failed for ${parsedUrl.hostname}:`, (err as Error).message);
    return res.status(400).send('Could not resolve image host');
  }

  if (isForbiddenIp(resolvedAddress)) {
    console.warn(`[IMAGE_PROXY] Blocked SSRF attempt to ${parsedUrl.hostname} (${resolvedAddress})`);
    return res.status(403).send('Access to private/internal network addresses is forbidden');
  }

  const client = parsedUrl.protocol === 'https:' ? https : http;
  const imageReq = client.get(imageUrl, {
    headers: { 'User-Agent': 'ViniPlay/1.0 (ImageProxy)' },
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions && (lookupOptions as { all?: boolean }).all) {
        callback(null, [{ address: resolvedAddress, family }]);
      } else {
        callback(null, resolvedAddress, family);
      }
    },
  }, (imageRes) => {
    const contentType = imageRes.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).send('URL does not point to an image');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.setHeader('X-Cache', 'MISS');

    const fileStream = fs.createWriteStream(cacheFilePath);
    imageRes.pipe(fileStream);
    imageRes.pipe(res);

    const abortImageStreams = () => {
      try {
        imageRes.unpipe(res);
        imageRes.destroy();
        imageRes.socket?.destroy();
        fileStream.destroy();
      } catch {}
    };

    req.on('close', abortImageStreams);
    res.on('close', abortImageStreams);

    fileStream.on('finish', () => {
      try {
        fs.writeFileSync(cacheMetaPath, JSON.stringify({ url: imageUrl, contentType, cachedAt: new Date().toISOString() }, null, 2));
      } catch (err) {
        console.error('[IMAGE_PROXY] Failed to write cache metadata:', (err as Error).message);
      }
    });
    fileStream.on('error', (err) => console.error('[IMAGE_PROXY] Error writing to cache:', err.message));
  });

  imageReq.on('error', (err) => {
    console.error(`[IMAGE_PROXY] Error fetching image from ${imageUrl}:`, err.message);
    if (!res.headersSent) {
      res.status(500).send('Failed to fetch image');
    }
  });

  req.on('close', () => {
    try { imageReq.destroy(); } catch {}
  });
});

proxyRouter.get('/playlist-proxy', requireAuth, (req, res) => {
  if (!fs.existsSync(LIVE_CHANNELS_M3U_PATH)) {
    return res.status(404).send('No merged playlist available yet. Process sources first.');
  }

  const settings = getSettings();
  const profileId = (req.query.profileId as string | undefined) || settings.activeStreamProfileId;
  const userAgentId = (req.query.userAgentId as string | undefined) || settings.activeUserAgentId;

  const channels = parseM3U(fs.readFileSync(LIVE_CHANNELS_M3U_PATH, 'utf-8'));

  const host = req.get('host');
  const origin = `${req.protocol}://${host}`;

  let out = '#EXTM3U\n';
  for (const ch of channels) {
    const proxiedUrl = `${origin}/stream?url=${encodeURIComponent(ch.url)}&profileId=${encodeURIComponent(profileId)}&userAgentId=${encodeURIComponent(userAgentId)}`;
    out += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" tvg-logo="${ch.logo || ''}" tvg-chno="${ch.chno || ''}" group-title="${ch.group || 'Uncategorized'}",${ch.displayName || ch.name}\n`;
    out += `${proxiedUrl}\n`;
  }

  res.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="viniplay.m3u"');
  res.send(out);
});

const proxyHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, keepAliveMsecs: 5000 });
const proxyHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, keepAliveMsecs: 5000 });

// Stream proxy endpoint to forward VOD video streams with redirect follow & HTTP Range support
const mediaProxyAuth = allowLocalOrAuth(activeCastTokens);

proxyRouter.options('/media-proxy', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.status(204).end();
});

proxyRouter.all('/media-proxy', mediaProxyAuth, (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Method Not Allowed');
  }

  const targetUrl = req.query.url as string | undefined;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  const settings = getSettings();
  const ua = settings.userAgents.find((u) => u.id === settings.activeUserAgentId)?.value || 'VLC/3.0.20 (Linux; x86_64)';

  let currentProxyReq: http.ClientRequest | null = null;
  let currentUpstreamRes: http.IncomingMessage | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;

    if (currentUpstreamRes) {
      try {
        currentUpstreamRes.unpipe(res);
        currentUpstreamRes.destroy();
        currentUpstreamRes.socket?.destroy();
      } catch {}
      currentUpstreamRes = null;
    }

    if (currentProxyReq) {
      try {
        currentProxyReq.destroy();
      } catch {}
      currentProxyReq = null;
    }

    try {
      if (!res.headersSent) {
        res.status(502).end();
      } else if (!res.writableEnded) {
        res.destroy();
      }
    } catch {}
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);

  function executeProxy(urlStr: string, redirectCount = 0) {
    if (isClosed) return;

    if (redirectCount > 5) {
      if (!res.headersSent) {
        res.status(502).send('Too many redirects from media server');
      }
      cleanup();
      return;
    }

    let parsed: URL;
    try {
      if (urlStr.startsWith('/')) {
        return res.redirect(urlStr);
      }
      parsed = new URL(urlStr);
    } catch {
      if (!res.headersSent) {
        res.status(400).send('Invalid URL');
      }
      cleanup();
      return;
    }

    const headers: Record<string, string> = {
      'User-Agent': ua,
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // Clean up previous request before initiating redirect
    if (currentProxyReq) {
      try { currentProxyReq.destroy(); } catch {}
      currentProxyReq = null;
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const proxyReq = client.request(
      parsed,
      {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        agent: isHttps ? proxyHttpsAgent : proxyHttpAgent,
        timeout: 30000,
      },
      (upstreamRes) => {
        if (isClosed) {
          try {
            upstreamRes.destroy();
            upstreamRes.socket?.destroy();
          } catch {}
          return;
        }

        // Handle HTTP 301, 302, 307, 308 redirects automatically (very common in XC IPTV servers)
        if (
          upstreamRes.statusCode &&
          [301, 302, 303, 307, 308].includes(upstreamRes.statusCode) &&
          upstreamRes.headers.location
        ) {
          const redirectLocation = new URL(upstreamRes.headers.location, urlStr).toString();
          try {
            upstreamRes.destroy();
            upstreamRes.socket?.destroy();
          } catch {}
          return executeProxy(redirectLocation, redirectCount + 1);
        }

        currentUpstreamRes = upstreamRes;

        res.status(upstreamRes.statusCode || 200);

        const passHeaders = [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'last-modified',
          'etag',
        ];
        for (const h of passHeaders) {
          if (upstreamRes.headers[h]) {
            res.setHeader(h, upstreamRes.headers[h] as string);
          }
        }

        if (!upstreamRes.headers['content-type'] || upstreamRes.headers['content-type'].includes('text/html')) {
          const cleanUrl = urlStr.split('?')[0].toLowerCase();
          if (cleanUrl.endsWith('.m3u8')) {
            res.setHeader('Content-Type', 'application/x-mpegURL');
          } else if (cleanUrl.endsWith('.mkv')) {
            res.setHeader('Content-Type', 'video/x-matroska');
          } else if (cleanUrl.endsWith('.webm')) {
            res.setHeader('Content-Type', 'video/webm');
          } else {
            res.setHeader('Content-Type', 'video/mp4');
          }
        }
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

        if (req.method === 'HEAD') {
          res.end();
          cleanup();
          return;
        }

        upstreamRes.pipe(res);

        upstreamRes.on('error', (err) => {
          if (!isClosed) {
            console.error('[MEDIA_PROXY] Upstream pipe error:', err.message);
          }
          cleanup();
        });

        upstreamRes.on('end', () => {
          cleanup();
        });
      }
    );

    currentProxyReq = proxyReq;

    proxyReq.on('timeout', () => {
      if (!isClosed) {
        console.warn(`[MEDIA_PROXY] Upstream timeout for ${urlStr}`);
        proxyReq.destroy(new Error('Upstream IPTV connection timeout'));
      }
    });

    proxyReq.on('error', (err) => {
      if (!isClosed) {
        console.error(`[MEDIA_PROXY] Request error for ${urlStr}:`, err.message);
        if (!res.headersSent) {
          res.status(502).send('Error connecting to upstream IPTV media server');
        }
      }
      cleanup();
    });

    proxyReq.end();
  }

  executeProxy(targetUrl);
});

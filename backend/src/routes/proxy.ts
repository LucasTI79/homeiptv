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

// Ports /api/image-proxy from server.js (Wave 0 hardened version: DNS-pinned,
// blocks loopback/private/link-local targets -- see server.js:4908-5000+ for
// the version this was ported from) and adds a new /api/playlist-proxy
// endpoint (issue #124 on the upstream repo / the user's original HTTP->HTTPS
// proxy request): re-exports the merged live channel list with every entry
// pointed at this server's own /stream endpoint instead of the raw,
// often-http, provider URL.
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

  let resolvedAddress: string;
  try {
    resolvedAddress = (await dns.promises.lookup(parsedUrl.hostname)).address;
  } catch (err) {
    console.error(`[IMAGE_PROXY] DNS lookup failed for ${parsedUrl.hostname}:`, (err as Error).message);
    return res.status(400).send('Could not resolve host');
  }
  if (isForbiddenIp(resolvedAddress)) {
    console.warn(`[IMAGE_PROXY] Blocked SSRF attempt: ${parsedUrl.hostname} -> ${resolvedAddress}`);
    return res.status(400).send('URL points to a forbidden address');
  }

  const { cacheFilePath, cacheMetaPath } = cachePathsFor(imageUrl);

  if (fs.existsSync(cacheFilePath) && fs.existsSync(cacheMetaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf-8')) as { contentType: string };
      res.setHeader('Content-Type', meta.contentType);
      res.setHeader('Cache-Control', 'public, max-age=2592000');
      res.setHeader('X-Cache', 'HIT');
      const fileStream = fs.createReadStream(cacheFilePath);
      fileStream.pipe(res);
      fileStream.on('error', (err) => {
        console.error('[IMAGE_PROXY] Error reading cached file:', err.message);
        try { fs.unlinkSync(cacheFilePath); fs.unlinkSync(cacheMetaPath); } catch { /* ignore */ }
        res.status(500).send('Cache read error');
      });
      return;
    } catch (err) {
      console.error('[IMAGE_PROXY] Error reading cache metadata:', (err as Error).message);
    }
  }

  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  protocol.get(imageUrl, {
    lookup: (hostname, lookupOptions, callback) => {
      const family = net.isIPv6(resolvedAddress) ? 6 : 4;
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

    fileStream.on('finish', () => {
      try {
        fs.writeFileSync(cacheMetaPath, JSON.stringify({ url: imageUrl, contentType, cachedAt: new Date().toISOString() }, null, 2));
      } catch (err) {
        console.error('[IMAGE_PROXY] Failed to write cache metadata:', (err as Error).message);
      }
    });
    fileStream.on('error', (err) => console.error('[IMAGE_PROXY] Error writing to cache:', err.message));
  }).on('error', (err) => {
    console.error(`[IMAGE_PROXY] Error fetching image from ${imageUrl}:`, err.message);
    res.status(500).send('Failed to fetch image');
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

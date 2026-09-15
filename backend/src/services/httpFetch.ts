import http from 'http';
import https from 'https';

export type SendStatus = (message: string, type?: string) => void;

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

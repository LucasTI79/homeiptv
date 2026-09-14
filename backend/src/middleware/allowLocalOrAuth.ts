import type { Request, Response, NextFunction } from 'express';

// Ports allowLocalOrAuth from server.js:3313-3376(ish), with the Wave 0
// security fix already applied: req.ip is Express-computed and only honors
// X-Forwarded-For when the immediate TCP peer is the trusted Caddy proxy
// (see app.set('trust proxy', ...) in index.ts), so it can't be spoofed by an
// external client's own X-Forwarded-For header.
//
// routes/stream.ts wires the real activeCastTokens store in; other callers
// (e.g. the image proxy) use the no-op emptyCastTokenStore default below
// since cast tokens are only meaningful for stream playback.
export interface CastTokenStore {
  get(token: string): Promise<{ userId: number; username?: string; expiresAt: number } | undefined>;
  delete(token: string): Promise<void>;
}

const emptyCastTokenStore: CastTokenStore = {
  get: async () => undefined,
  delete: async () => {},
};

export function allowLocalOrAuth(castTokens: CastTokenStore = emptyCastTokenStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.session?.userId) {
      return next();
    }

    const setCorsHeaders = () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    };

    const castToken = req.query.castToken as string | undefined;
    if (castToken) {
      const tokenData = await castTokens.get(castToken);
      if (!tokenData) {
        setCorsHeaders();
        console.warn(`[STREAM_AUTH] Invalid cast token: ${castToken.substring(0, 8)}...`);
        return res.status(401).send('Invalid cast token');
      }
      if (tokenData.expiresAt < Date.now()) {
        setCorsHeaders();
        console.warn(`[STREAM_AUTH] Expired cast token: ${castToken.substring(0, 8)}...`);
        await castTokens.delete(castToken);
        return res.status(401).send('Expired cast token');
      }

      req.session = req.session || ({} as Request['session']);
      req.session.userId = tokenData.userId;
      req.session.username = 'Cast User';
      // Do not delete token immediately; media streaming issues multiple Range requests throughout playback
      return next();
    }

    const rawIp = (req.ip || '').trim();
    console.log(`[STREAM_AUTH] Checking IP: ${rawIp}`);

    const normalizedIp = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
    const octets = normalizedIp.split('.');
    const isPrivate172 = octets.length === 4 && octets[0] === '172' && Number(octets[1]) >= 16 && Number(octets[1]) <= 31;
    const isLocal =
      normalizedIp.startsWith('192.168.') ||
      normalizedIp.startsWith('10.') ||
      isPrivate172 ||
      normalizedIp === '127.0.0.1' ||
      normalizedIp === '::1';

    if (isLocal) {
      console.log(`[STREAM_AUTH] Allowing unauthenticated access from local network: ${normalizedIp}`);
      req.session = req.session || ({} as Request['session']);
      req.session.userId = 1;
      req.session.username = 'Local Network';
      return next();
    }

    setCorsHeaders();
    console.warn(`[STREAM_AUTH] Unauthorized access attempt from: ${rawIp}`);
    return res.status(401).send('Authentication required.');
  };
}

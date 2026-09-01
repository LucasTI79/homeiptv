import type { Request, Response, NextFunction } from 'express';

// Ports allowLocalOrAuth from server.js:3313-3376(ish), with the Wave 0
// security fix already applied: req.ip is Express-computed and only honors
// X-Forwarded-For when the immediate TCP peer is the trusted Caddy proxy
// (see app.set('trust proxy', ...) in index.ts), so it can't be spoofed by an
// external client's own X-Forwarded-For header.
//
// TODO(streaming domain, task #12): wire in the real activeCastTokens store
// once Chromecast token issuance is ported -- the castToken branch below is
// structurally in place but has nothing to look tokens up against yet.
export interface CastTokenStore {
  get(token: string): { userId: number; username?: string; expiresAt: number } | undefined;
  delete(token: string): void;
}

const emptyCastTokenStore: CastTokenStore = {
  get: () => undefined,
  delete: () => {},
};

export function allowLocalOrAuth(castTokens: CastTokenStore = emptyCastTokenStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.session?.userId) {
      return next();
    }

    const castToken = req.query.castToken as string | undefined;
    if (castToken) {
      const tokenData = castTokens.get(castToken);
      if (!tokenData) {
        console.warn(`[STREAM_AUTH] Invalid cast token: ${castToken.substring(0, 8)}...`);
        return res.status(401).send('Invalid cast token');
      }
      if (tokenData.expiresAt < Date.now()) {
        console.warn(`[STREAM_AUTH] Expired cast token: ${castToken.substring(0, 8)}...`);
        castTokens.delete(castToken);
        return res.status(401).send('Expired cast token');
      }

      req.session = req.session || ({} as Request['session']);
      req.session.userId = tokenData.userId;
      req.session.username = 'Cast User';
      castTokens.delete(castToken);
      return next();
    }

    const clientIp = req.ip || '';
    console.log(`[STREAM_AUTH] Checking IP: ${clientIp}`);

    const octets = clientIp.startsWith('::ffff:') ? clientIp.slice(7).split('.') : clientIp.split('.');
    const isPrivate172 = octets.length === 4 && octets[0] === '172' && Number(octets[1]) >= 16 && Number(octets[1]) <= 31;
    const isLocal = clientIp.startsWith('192.168.') ||
      clientIp.startsWith('10.') ||
      isPrivate172 ||
      clientIp === '127.0.0.1' ||
      clientIp === '::1' ||
      clientIp === '::ffff:127.0.0.1';

    if (isLocal) {
      console.log(`[STREAM_AUTH] Allowing unauthenticated access from local network: ${clientIp}`);
      req.session = req.session || ({} as Request['session']);
      req.session.userId = 1;
      req.session.username = 'Local Network';
      return next();
    }

    console.warn(`[STREAM_AUTH] Unauthorized access attempt from: ${clientIp}`);
    return res.status(401).send('Authentication required.');
  };
}

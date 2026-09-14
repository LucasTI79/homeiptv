import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';
import { allowLocalOrAuth } from '../../middleware/allowLocalOrAuth';

// requireAuth and session state aren't the concern of this test -- stub a
// minimal session so the route handler under test runs unauthenticated-free.
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1 };
    next();
  },
}));

import { streamRouter } from '../stream';
import { activeCastTokens } from '../../state/streamState';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(streamRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /api/cast/generate-token', () => {
  it('returns 400 with the standard error shape when streamUrl is missing', async () => {
    const res = await request(buildApp()).post('/api/cast/generate-token').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'streamUrl is required' } });
  });

  it('returns a token when streamUrl is provided', async () => {
    const res = await request(buildApp())
      .post('/api/cast/generate-token')
      .send({ streamUrl: 'http://example.com/stream.ts' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  it('stores the token in activeCastTokens with a 6-hour TTL, no manual cleanup timer', async () => {
    const { activeCastTokens } = await import('../../state/streamState');
    const res = await request(buildApp())
      .post('/api/cast/generate-token')
      .send({ streamUrl: 'http://example.com/stream.ts' });

    expect(res.status).toBe(200);
    const stored = await activeCastTokens.get(res.body.token);
    expect(stored).toMatchObject({ userId: 1, streamUrl: 'http://example.com/stream.ts' });
  });

  it('passes a 6-hour ttlMs to activeCastTokens.set', async () => {
    const setSpy = vi.spyOn(activeCastTokens, 'set');
    const res = await request(buildApp())
      .post('/api/cast/generate-token')
      .send({ streamUrl: 'http://example.com/stream.ts' });

    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith(
      res.body.token,
      expect.objectContaining({ userId: 1, streamUrl: 'http://example.com/stream.ts' }),
      expect.any(Number)
    );
    // The ttlMs given to the hub must be at least the 6-hour lifetime stated
    // in the token's own expiresAt field (a grace margin on top is fine and
    // expected -- see the Finding 1 fix in stream.ts).
    const ttlArg = setSpy.mock.calls[0][2] as number;
    expect(ttlArg).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
    setSpy.mockRestore();
  });

  it('a token generated via the real route validates through the real allowLocalOrAuth middleware', async () => {
    const genRes = await request(buildApp())
      .post('/api/cast/generate-token')
      .send({ streamUrl: 'http://example.com/stream.ts' });
    expect(genRes.status).toBe(200);
    const token = genRes.body.token;

    const castApp = express();
    castApp.use(allowLocalOrAuth(activeCastTokens));
    castApp.get('/protected', (req, res) => res.json({ userId: req.session?.userId }));

    const castRes = await request(castApp).get(`/protected?castToken=${token}`);
    expect(castRes.status).toBe(200);
    expect(castRes.body.userId).toBe(1);
  });

  it('reports "Expired cast token" (not "Invalid cast token") for a token whose expiresAt has passed but the hub has not yet purged it', async () => {
    const genRes = await request(buildApp())
      .post('/api/cast/generate-token')
      .send({ streamUrl: 'http://example.com/stream.ts' });
    expect(genRes.status).toBe(200);
    const token = genRes.body.token;

    // Simulate the token having logically expired (per its own expiresAt
    // field) while still being present in the hub -- this is the window the
    // Finding 1 fix must keep reachable.
    await activeCastTokens.set(
      token,
      { userId: 1, streamUrl: 'http://example.com/stream.ts', expiresAt: Date.now() - 1000, createdAt: Date.now() - 2000 },
      60_000
    );

    const castApp = express();
    castApp.use(allowLocalOrAuth(activeCastTokens));
    castApp.get('/protected', (req, res) => res.json({ userId: req.session?.userId }));

    const castRes = await request(castApp).get(`/protected?castToken=${token}`);
    expect(castRes.status).toBe(401);
    expect(castRes.text).toBe('Expired cast token');
  });
});

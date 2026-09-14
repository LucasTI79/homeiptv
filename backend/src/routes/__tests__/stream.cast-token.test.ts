import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

// requireAuth and session state aren't the concern of this test -- stub a
// minimal session so the route handler under test runs unauthenticated-free.
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1 };
    next();
  },
}));

import { streamRouter } from '../stream';

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
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1, username: 'admin' };
    next();
  },
}));

vi.mock('../../middleware/allowLocalOrAuth', () => ({
  allowLocalOrAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1, username: 'admin' };
    next();
  },
}));

import { streamRouter } from '../stream';
import { activeStreamProcesses, type ActiveStreamInfo } from '../../state/streamState';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(streamRouter);
  return app;
}

describe('POST /api/stream/keep-alive', () => {
  beforeEach(() => {
    activeStreamProcesses.clear();
  });

  it('updates lastAccess for matching streamKey', async () => {
    const past = Date.now() - 100_000;
    activeStreamProcesses.set('1::http://example.com/ch1::profile1', {
      lastAccess: past,
    } as ActiveStreamInfo);

    const res = await request(buildApp())
      .post('/api/stream/keep-alive')
      .send({ streamKey: '1::http://example.com/ch1::profile1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.touched).toBe(true);
    expect(activeStreamProcesses.get('1::http://example.com/ch1::profile1')!.lastAccess).toBeGreaterThan(past);
  });

  it('updates lastAccess for matching streamUrl if streamKey not provided', async () => {
    const past = Date.now() - 100_000;
    activeStreamProcesses.set('1::http://example.com/ch1::profile1', {
      lastAccess: past,
    } as ActiveStreamInfo);

    const res = await request(buildApp())
      .post('/api/stream/keep-alive')
      .send({ streamUrl: 'http://example.com/ch1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.touched).toBe(true);
    expect(activeStreamProcesses.get('1::http://example.com/ch1::profile1')!.lastAccess).toBeGreaterThan(past);
  });

  it('returns touched false gracefully when stream is not active', async () => {
    const res = await request(buildApp())
      .post('/api/stream/keep-alive')
      .send({ streamUrl: 'http://nonexistent.com/stream' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.touched).toBe(false);
  });
});

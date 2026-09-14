import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { allowLocalOrAuth, type CastTokenStore } from '../allowLocalOrAuth';

function buildApp(castTokens?: CastTokenStore) {
  const app = express();
  app.use(allowLocalOrAuth(castTokens));
  app.get('/protected', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('allowLocalOrAuth', () => {
  it('allows the request through when the cast token resolves to valid data', async () => {
    const store: CastTokenStore = {
      get: vi.fn(async (token: string) => (token === 'good-token' ? { userId: 42, expiresAt: Date.now() + 60_000 } : undefined)),
      delete: vi.fn(async () => {}),
    };

    const res = await request(buildApp(store)).get('/protected?castToken=good-token');

    expect(res.status).toBe(200);
    expect(store.get).toHaveBeenCalledWith('good-token');
  });

  it('rejects with 401 when the cast token is unknown', async () => {
    const store: CastTokenStore = {
      get: vi.fn(async () => undefined),
      delete: vi.fn(async () => {}),
    };

    const res = await request(buildApp(store)).get('/protected?castToken=bad-token');

    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid cast token');
  });

  it('rejects with 401 and deletes the token when it has expired', async () => {
    const store: CastTokenStore = {
      get: vi.fn(async () => ({ userId: 1, expiresAt: Date.now() - 1000 })),
      delete: vi.fn(async () => {}),
    };

    const res = await request(buildApp(store)).get('/protected?castToken=expired-token');

    expect(res.status).toBe(401);
    expect(res.text).toContain('Expired cast token');
    expect(store.delete).toHaveBeenCalledWith('expired-token');
  });
});

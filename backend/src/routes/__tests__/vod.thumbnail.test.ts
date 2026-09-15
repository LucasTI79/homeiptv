import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1 };
    next();
  },
}));

const { getOrCreateMock } = vi.hoisted(() => ({ getOrCreateMock: vi.fn() }));
vi.mock('../../services/thumbnails/ThumbnailService', () => ({
  thumbnailService: { getOrCreate: getOrCreateMock },
}));

import { vodRouter } from '../vod';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', vodRouter);
  app.use(errorHandler);
  return app;
}

describe('GET /api/vod/thumbnail/:id', () => {
  it('returns 400 with the standard error shape when mediaUrl is missing', async () => {
    const res = await request(buildApp()).get('/api/vod/thumbnail/abc123');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'mediaUrl query parameter is required' } });
  });

  it('returns 404 with the standard error shape when no thumbnail is available', async () => {
    getOrCreateMock.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/vod/thumbnail/abc123').query({ mediaUrl: 'http://example.com/video.mp4' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Thumbnail not available for this media' } });
  });

  it('calls thumbnailService.getOrCreate with the resolved media URL and target id', async () => {
    getOrCreateMock.mockResolvedValue(null);
    await request(buildApp()).get('/api/vod/thumbnail/abc123').query({ mediaUrl: 'http://example.com/video.mp4' });
    expect(getOrCreateMock).toHaveBeenCalledWith('http://example.com/video.mp4', 'abc123');
  });

  it('returns 400 with the standard error shape when targetId contains path traversal characters', async () => {
    getOrCreateMock.mockClear();
    const res = await request(buildApp())
      .get('/api/vod/thumbnail/..%2F..%2Fetc%2Fpasswd')
      .query({ mediaUrl: 'http://example.com/video.mp4' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid targetId' } });
    expect(getOrCreateMock).not.toHaveBeenCalled();
  });
});

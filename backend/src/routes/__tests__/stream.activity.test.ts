import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1, username: 'alice' };
    next();
  },
}));

const { createMock, endPlayingMock, endUnconditionalMock, getStartTimeMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  endPlayingMock: vi.fn(),
  endUnconditionalMock: vi.fn(),
  getStartTimeMock: vi.fn(),
}));

vi.mock('../../repositories', () => ({
  streamHistoryRepository: {
    create: createMock,
    endPlaying: endPlayingMock,
    endUnconditional: endUnconditionalMock,
    getStartTime: getStartTimeMock,
  },
}));

import { streamRouter } from '../stream';
import { activeStreamProcesses, activeRedirectStreams } from '../../state/streamState';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(streamRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /api/stream/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeStreamProcesses.clear();
  });

  it('returns 400 when url is missing', async () => {
    const res = await request(buildApp()).post('/api/stream/stop').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Stream URL is required to stop the stream.' });
  });

  it('returns success with a no-op message when no active stream matches', async () => {
    const res = await request(buildApp()).post('/api/stream/stop').send({ url: 'http://example.com/x.ts', profileId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'No active stream to stop.' });
  });

  it('keeps the stream alive without killing the process when references > 1', async () => {
    const kill = vi.fn();
    activeStreamProcesses.set('1::http://example.com/x.ts::p1', {
      process: { kill } as any, references: 2, lastAccess: Date.now(), userId: 1, username: 'alice',
      channelId: null, channelName: 'X', channelLogo: null, streamProfileName: 'p1',
      startTime: '2026-01-01T00:00:00.000Z', historyId: 42, clientIp: '127.0.0.1',
      streamKey: '1::http://example.com/x.ts::p1', isTranscoded: true,
    });

    const res = await request(buildApp()).post('/api/stream/stop').send({ url: 'http://example.com/x.ts', profileId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Stream kept alive for other active clients.' });
    expect(kill).not.toHaveBeenCalled();
  });

  it('kills the process, ends history, and removes the entry when it is the last reference', async () => {
    const kill = vi.fn();
    endPlayingMock.mockResolvedValue(undefined);
    activeStreamProcesses.set('1::http://example.com/x.ts::p1', {
      process: { kill } as any, references: 1, lastAccess: Date.now(), userId: 1, username: 'alice',
      channelId: null, channelName: 'X', channelLogo: null, streamProfileName: 'p1',
      startTime: '2026-01-01T00:00:00.000Z', historyId: 42, clientIp: '127.0.0.1',
      streamKey: '1::http://example.com/x.ts::p1', isTranscoded: true,
    });

    const res = await request(buildApp()).post('/api/stream/stop').send({ url: 'http://example.com/x.ts', profileId: 'p1' });

    expect(res.status).toBe(200);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(endPlayingMock).toHaveBeenCalledWith(42, '2026-01-01T00:00:00.000Z');
    expect(activeStreamProcesses.has('1::http://example.com/x.ts::p1')).toBe(false);
  });
});

describe('POST /api/activity/start-redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeRedirectStreams.clear();
  });

  it('creates a history row, tracks the redirect stream, and returns the historyId', async () => {
    createMock.mockResolvedValue(99);

    const res = await request(buildApp())
      .post('/api/activity/start-redirect')
      .send({ streamUrl: 'http://example.com/x.ts', channelId: 'ch1', channelName: 'Channel 1', channelLogo: 'logo.png' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, historyId: 99 });
    expect(createMock).toHaveBeenCalledWith({
      userId: 1, username: 'alice', channelId: 'ch1', channelName: 'Channel 1',
      startTime: expect.any(String), status: 'playing', clientIp: expect.any(String),
      channelLogo: 'logo.png', streamProfileName: 'Redirect',
    });
    expect(activeRedirectStreams.has('1::99')).toBe(true);
  });

  it('falls back to null for missing optional fields on the history row', async () => {
    createMock.mockResolvedValue(100);

    await request(buildApp()).post('/api/activity/start-redirect').send({ streamUrl: 'http://example.com/x.ts' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: null, channelName: null, channelLogo: null })
    );
  });

  it('returns 500 with the ad hoc error shape when the repository throws', async () => {
    createMock.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp()).post('/api/activity/start-redirect').send({ streamUrl: 'http://example.com/x.ts' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Could not log stream start.' });
  });
});

describe('POST /api/activity/stop-redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeRedirectStreams.clear();
  });

  it('returns 400 when historyId is missing', async () => {
    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'History ID is required.' });
  });

  it('returns success without calling endUnconditional when no history record is found', async () => {
    getStartTimeMock.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({ historyId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Stream stopped, history record not found.' });
    expect(endUnconditionalMock).not.toHaveBeenCalled();
  });

  it('ends the history row and removes the tracked redirect stream when found', async () => {
    getStartTimeMock.mockResolvedValue('2026-01-01T00:00:00.000Z');
    activeRedirectStreams.set('1::42', { streamKey: '1::42' } as any);

    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({ historyId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(endUnconditionalMock).toHaveBeenCalledWith(42, '2026-01-01T00:00:00.000Z');
    expect(activeRedirectStreams.has('1::42')).toBe(false);
  });

  it('returns 500 with the ad hoc error shape when the repository throws', async () => {
    getStartTimeMock.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({ historyId: 42 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Could not log stream end.' });
  });
});

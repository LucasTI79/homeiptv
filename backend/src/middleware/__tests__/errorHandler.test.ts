import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler, notFoundHandler } from '../errorHandler';
import { NotFoundError, ValidationError } from '../../errors';

function buildApp() {
  const app = express();
  app.get('/known-error', (_req, _res, next) => next(new NotFoundError('Channel not found')));
  app.get('/validation-error', (_req, _res, next) =>
    next(new ValidationError('Missing url parameter', { field: 'url' }))
  );
  app.get('/unknown-error', () => {
    throw new Error('boom - raw internal detail that must not leak');
  });
  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to next(err) instead of writing a new response when headers are already sent', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('failure mid-stream');
    const jsonSpy = vi.fn();
    const statusSpy = vi.fn(() => ({ json: jsonSpy }));
    const nextSpy = vi.fn();

    const req = { method: 'GET', originalUrl: '/partial-response' } as unknown as Parameters<typeof errorHandler>[1];
    const res = {
      headersSent: true,
      status: statusSpy,
      json: jsonSpy,
    } as unknown as Parameters<typeof errorHandler>[2];

    errorHandler(err, req, res, nextSpy);

    // Must not attempt to write a new response on top of one already started.
    expect(statusSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(nextSpy).toHaveBeenCalledWith(err);
    expect(
      consoleErrorSpy.mock.calls.some((call) =>
        String(call[0]).includes('Error after response started on GET /partial-response')
      )
    ).toBe(true);
  });

  it('logs the request method and URL for unhandled errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(buildApp()).get('/unknown-error');

    expect(
      consoleErrorSpy.mock.calls.some((call) =>
        String(call[0]).includes('Unhandled error on GET /unknown-error')
      )
    ).toBe(true);
  });

  it('maps a NotFoundError to a 404 with the standard shape', async () => {
    const res = await request(buildApp()).get('/known-error');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Channel not found' } });
  });

  it('includes details when the AppError carries them', async () => {
    const res = await request(buildApp()).get('/validation-error');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Missing url parameter', details: { field: 'url' } },
    });
  });

  it('maps an unrecognized Error to a generic 500 without leaking its message', async () => {
    const res = await request(buildApp()).get('/unknown-error');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    expect(JSON.stringify(res.body)).not.toContain('raw internal detail');
  });
});

describe('notFoundHandler', () => {
  it('returns a standard 404 for unmatched /api routes', async () => {
    const res = await request(buildApp()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
});

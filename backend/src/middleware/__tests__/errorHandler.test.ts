import { describe, it, expect } from 'vitest';
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

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { CAST_RECEIVER_DIR } from '../../config/paths';

describe('Cast Receiver static routes', () => {
  function buildApp() {
    const app = express();
    app.use('/cast-receiver', express.static(CAST_RECEIVER_DIR, {
      setHeaders: (res) => {
        res.set('Access-Control-Allow-Origin', '*');
      },
    }));
    app.get('/cast-receiver', (_req, res) => res.redirect(301, '/cast-receiver/'));
    return app;
  }

  it('serves cast-receiver index.html at /cast-receiver/', async () => {
    const res = await request(buildApp()).get('/cast-receiver/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<cast-media-player>');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('serves receiver.js with CORS header', async () => {
    const res = await request(buildApp()).get('/cast-receiver/receiver.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('redirects /cast-receiver to /cast-receiver/', async () => {
    const res = await request(buildApp()).get('/cast-receiver');
    expect(res.status).toBe(301);
    expect(res.headers['location']).toBe('/cast-receiver/');
  });
});

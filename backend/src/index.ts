import http from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { ConnectSessionKnexStore } from 'connect-session-knex';
import { env } from './config/env';
import { db } from './db/connection';
import { PUBLIC_DIR } from './config/paths';
import { requireAuth } from './middleware/auth';
import { initializeLogSystem } from './services/logSystem';
import { initializeVapid } from './services/vapid';
import { checkAndSendNotifications } from './services/notificationChecker';
import { detectHardwareAcceleration } from './services/hardwareDetection';
import { MemoryRemoteSessionHub } from './services/remote/MemoryRemoteSessionHub';
import { setupRemoteWebSocketServer } from './services/remote/remoteWsServer';
import { createRemoteRouter } from './routes/remote';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { settingsRouter } from './routes/settings';
import { sourcesRouter } from './routes/sources';
import { configRouter } from './routes/config';
import { vodRouter } from './routes/vod';
import { proxyRouter } from './routes/proxy';
import { streamRouter } from './routes/stream';
import { dvrRouter } from './routes/dvr';
import { logsRouter } from './routes/logs';
import { sseRouter } from './routes/sse';
import { adminRouter } from './routes/admin';
import { miscRouter } from './routes/misc';
import { notificationsRouter } from './routes/notifications';
import { diagnosticsRouter } from './routes/diagnostics';
import { cleanupInactiveStreams, setBroadcastAdminUpdate } from './state/streamState';
import { broadcastAdminUpdateImpl } from './state/sseState';

// Global console.log/error/warn override -- must happen before anything else
// logs, so persisted log files capture the whole startup sequence too.
initializeLogSystem();
initializeVapid();

// Closes the seam left in streamState.ts: streaming/DVR code calls
// broadcastAdminUpdate() without depending on the SSE layer directly.
setBroadcastAdminUpdate(broadcastAdminUpdateImpl);

const app = express();

// Same reasoning as the Wave 0 fix in server.js: only trust X-Forwarded-For
// when it comes from the Caddy reverse proxy (loopback/private network).
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://www.gstatic.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["*", "data:", "blob:"], // Allow images from any source and data URIs for M3U logos
        mediaSrc: ["*", "'self'", "blob:", "data:"], // Allow media streams and local proxies
        connectSrc: ["'self'", "https://google.com", "ws:", "wss:"],
        frameSrc: ["'none'"],
      },
    },
  })
);

app.use(express.json());
app.use(
  session({
    store: new ConnectSessionKnexStore({ knex: db, tableName: 'sessions', createTable: true }),
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: env.nodeEnv === 'production',
    },
  })
);

// server.js:302-314 -- API responses always revalidate; static assets cache
// but must check for changes (304), so a deploy doesn't strand old JS on
// clients. This is Wave 2's checkpoint scaffolding: it lets the *existing*
// public/js frontend run against this backend unmodified, which is how the
// Wave 2 checkpoint (frontend contract must not change) actually gets
// exercised end-to-end. Wave 3 replaces this with the React app's own build
// output and this block goes away.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'private, no-cache, must-revalidate');
  next();
});
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('.js')) {
      res.set('Cache-Control', 'public, no-cache, must-revalidate');
    }
  },
}));

// server.js:459 -- recorded files playback, not the DVR management API.
app.use('/dvr', requireAuth, express.static(env.dvrDir));

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', usersRouter);
app.use('/api', settingsRouter);
app.use('/api', sourcesRouter);
app.use('/api', configRouter);
app.use('/api', vodRouter);
app.use('/api', proxyRouter);
app.use(streamRouter);
app.use('/api', dvrRouter);
app.use('/api', logsRouter);
app.use('/api', sseRouter);
app.use('/api', adminRouter);
app.use('/api', miscRouter);
app.use('/api', notificationsRouter);
app.use('/api', diagnosticsRouter);

const remoteHub = new MemoryRemoteSessionHub();
app.use('/api/remote', createRemoteRouter(remoteHub));

// server.js:5241-5247 -- SPA fallback, must be registered last.
app.get('*', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, req.path);
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// server.js:600-609 -- kills ffmpeg processes nobody is watching anymore.
setInterval(cleanupInactiveStreams, 15000);
setInterval(checkAndSendNotifications, 60000);

detectHardwareAcceleration().then(() => {
  console.log('[HW] Hardware acceleration detection complete.');
});

const server = http.createServer(app);
setupRemoteWebSocketServer(server, remoteHub);

server.listen(env.port, () => {
  console.log(`[viniplay-backend] listening on port ${env.port} (db client: ${env.dbClient})`);
});

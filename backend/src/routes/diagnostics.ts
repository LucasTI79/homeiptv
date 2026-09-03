import os from 'os';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { activeStreamProcesses, activeRedirectStreams } from '../state/streamState';
import { DATA_DIR, LOGS_DIR, LIVE_CHANNELS_M3U_PATH, LIVE_EPG_JSON_PATH } from '../config/paths';

export const diagnosticsRouter = Router();

export function getSystemDiagnostics() {
  const mem = process.memoryUsage();
  const osTotalMem = os.totalmem();
  const osFreeMem = os.freemem();
  const osLoad = os.loadavg();

  // Active streams summary
  const streams = Array.from(activeStreamProcesses.entries()).map(([key, info]) => ({
    key,
    pid: info.process.pid,
    startTime: info.startTime,
    references: info.references,
    lastAccess: new Date(info.lastAccess).toISOString(),
  }));

  // File size metrics
  let liveM3uSize = 0;
  if (fs.existsSync(LIVE_CHANNELS_M3U_PATH)) {
    try { liveM3uSize = fs.statSync(LIVE_CHANNELS_M3U_PATH).size; } catch { /* ignore */ }
  }

  let liveEpgSize = 0;
  if (fs.existsSync(LIVE_EPG_JSON_PATH)) {
    try { liveEpgSize = fs.statSync(LIVE_EPG_JSON_PATH).size; } catch { /* ignore */ }
  }

  const dbPath = path.join(DATA_DIR, 'homeiptv.db');
  let dbSize = 0;
  if (fs.existsSync(dbPath)) {
    try { dbSize = fs.statSync(dbPath).size; } catch { /* ignore */ }
  }

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        externalMb: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      },
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      loadAverage: osLoad,
      totalMemoryMb: Math.round(osTotalMem / 1024 / 1024),
      freeMemoryMb: Math.round(osFreeMem / 1024 / 1024),
      memoryUsagePercent: Math.round(((osTotalMem - osFreeMem) / osTotalMem) * 100),
    },
    streaming: {
      activeFfmpegProcesses: activeStreamProcesses.size,
      activeRedirectStreams: activeRedirectStreams.size,
      streams,
    },
    storage: {
      liveM3uSizeBytes: liveM3uSize,
      liveM3uSizeFormatted: `${(liveM3uSize / 1024 / 1024).toFixed(2)} MB`,
      liveEpgSizeBytes: liveEpgSize,
      liveEpgSizeFormatted: `${(liveEpgSize / 1024 / 1024).toFixed(2)} MB`,
      databaseSizeBytes: dbSize,
      databaseSizeFormatted: `${(dbSize / 1024 / 1024).toFixed(2)} MB`,
    },
  };
}

// GET /api/diagnostics: returns live resource profile
diagnosticsRouter.get('/diagnostics', requireAuth, async (_req, res) => {
  try {
    const diag = getSystemDiagnostics();

    // Query database row counts
    let movieCount = 0;
    let seriesCount = 0;
    let channelCount = 0;
    try {
      const [m] = await db('movies').count<{ count: number }[]>('* as count');
      movieCount = Number(m?.count || 0);
      const [s] = await db('series').count<{ count: number }[]>('* as count');
      seriesCount = Number(s?.count || 0);
    } catch {
      // ignore
    }

    res.json({
      ...diag,
      databaseStats: {
        moviesInDb: movieCount,
        seriesInDb: seriesCount,
      },
    });
  } catch (error) {
    console.error('[DIAGNOSTICS] Error fetching diagnostics:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/diagnostics/dump: creates diagnostic report file in data/logs/
diagnosticsRouter.post('/diagnostics/dump', requireAuth, async (_req, res) => {
  try {
    const diag = getSystemDiagnostics();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = `diagnostic-report-${timestamp}.json`;
    const reportPath = path.join(LOGS_DIR, reportFilename);

    // Also include last 50 lines of pm2 / error logs if available
    let recentErrors = '';
    const errLogPath = path.join(LOGS_DIR, 'homeiptv-error.log');
    if (fs.existsSync(errLogPath)) {
      try {
        const raw = fs.readFileSync(errLogPath, 'utf-8');
        recentErrors = raw.split('\n').slice(-50).join('\n');
      } catch {
        // ignore
      }
    }

    const fullReport = {
      ...diag,
      recentErrors,
    };

    fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
    console.log(`[DIAGNOSTICS] Saved snapshot report to: ${reportPath}`);

    res.json({
      success: true,
      message: `Diagnostic report generated: ${reportFilename}`,
      filename: reportFilename,
      report: fullReport,
    });
  } catch (error) {
    console.error('[DIAGNOSTICS] Error generating dump:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

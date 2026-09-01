import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { LOGS_DIR } from '../config/paths';
import { resetLogStream } from '../services/logSystem';

// Ports /api/logs/* from server.js:5117-5238.
export const logsRouter = Router();

function listLogFiles() {
  return fs.readdirSync(LOGS_DIR)
    .filter((file) => file.startsWith('viniplay-') && file.endsWith('.log'))
    .map((file) => {
      const filePath = path.join(LOGS_DIR, file);
      const stats = fs.statSync(filePath);
      return { name: file, path: filePath, size: stats.size, mtime: stats.mtime };
    });
}

logsRouter.get('/logs/info', requireAuth, requireAdmin, (_req, res) => {
  try {
    const logFiles = listLogFiles().sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const totalSize = logFiles.reduce((sum, file) => sum + file.size, 0);
    const oldestFile = logFiles.length > 0 ? logFiles[logFiles.length - 1] : null;

    res.json({
      fileCount: logFiles.length,
      totalSize,
      oldestDate: oldestFile ? oldestFile.mtime : null,
      files: logFiles.map(({ name, size, mtime }) => ({ name, size, mtime })),
    });
  } catch (error) {
    console.error('[API] Error getting log info:', error);
    res.status(500).json({ error: 'Failed to get log information.' });
  }
});

logsRouter.get('/logs/download', requireAuth, requireAdmin, (req, res) => {
  try {
    const logFiles = listLogFiles().sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
    if (logFiles.length === 0) {
      return res.status(404).json({ error: 'No log files found.' });
    }

    let combinedLogs = 'ViniPlay Application Logs\n';
    combinedLogs += `Generated: ${new Date().toISOString()}\n`;
    combinedLogs += `Total Files: ${logFiles.length}\n`;
    combinedLogs += `${'='.repeat(80)}\n\n`;

    for (const file of logFiles) {
      combinedLogs += `\n${'='.repeat(80)}\n`;
      combinedLogs += `File: ${file.name}\n`;
      combinedLogs += `Modified: ${file.mtime.toISOString()}\n`;
      combinedLogs += `${'='.repeat(80)}\n\n`;
      try {
        combinedLogs += fs.readFileSync(file.path, 'utf-8');
        combinedLogs += '\n\n';
      } catch (err) {
        combinedLogs += `[ERROR] Could not read file: ${(err as Error).message}\n\n`;
      }
    }

    const filename = `viniplay-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(combinedLogs);
    console.log(`[API] User ${req.session.userId} downloaded logs.`);
  } catch (error) {
    console.error('[API] Error downloading logs:', error);
    res.status(500).json({ error: 'Failed to download logs.' });
  }
});

logsRouter.post('/logs/cleanup', requireAuth, requireAdmin, (req, res) => {
  try {
    const logFiles = listLogFiles();
    let deletedCount = 0;
    for (const file of logFiles) {
      try {
        fs.unlinkSync(file.path);
        deletedCount++;
      } catch (err) {
        console.error(`[API] Error deleting log file ${file.name}:`, err);
      }
    }

    resetLogStream();

    console.log(`[API] User ${req.session.userId} cleared ${deletedCount} log files.`);
    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('[API] Error cleaning up logs:', error);
    res.status(500).json({ error: 'Failed to cleanup logs.' });
  }
});

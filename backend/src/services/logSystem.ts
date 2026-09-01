import fs from 'fs';
import path from 'path';
import { LOGS_DIR } from '../config/paths';
import { getSettings } from './settings';
import type { LogSettings } from '@viniplay/shared-types';

// Ports the log rotation system from server.js:922-1140: overrides
// console.log/error/warn to also persist to rotating files under
// DATA_DIR/logs. The console.* override is a deliberate global side effect
// (same as the original) -- call initializeLogSystem() once, early, from
// index.ts. Unlike the original (which stashes the pre-override functions as
// a `.__original` property on console.log itself), these are kept as plain
// module-level references -- same recursion-avoidance, cleaner typing.
let currentLogStream: fs.WriteStream | null = null;
let currentLogFilePath: string | null = null;
let currentLogSize = 0;
let cachedLogSettings: LogSettings = {
  maxFiles: 5,
  maxFileSizeBytes: 5 * 1024 * 1024,
  autoDeleteDays: 7,
};

type ConsoleFn = (...args: unknown[]) => void;
let originalLog: ConsoleFn = console.log.bind(console);
let originalError: ConsoleFn = console.error.bind(console);
let originalWarn: ConsoleFn = console.warn.bind(console);

export function refreshLogSettings(): void {
  try {
    const settings = getSettings();
    if (settings.logs) {
      cachedLogSettings = settings.logs;
    }
  } catch {
    // Silently fail to avoid recursion
  }
}

function getCurrentLogFilePath(): string {
  if (!currentLogFilePath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    currentLogFilePath = path.join(LOGS_DIR, `viniplay-${timestamp}.log`);
  }
  return currentLogFilePath;
}

export function cleanupOldLogsByCount(): void {
  try {
    const maxFiles = cachedLogSettings.maxFiles || 5;
    const logFiles = fs.readdirSync(LOGS_DIR)
      .filter((file) => file.startsWith('viniplay-') && file.endsWith('.log'))
      .map((file) => ({ name: file, path: path.join(LOGS_DIR, file), mtime: fs.statSync(path.join(LOGS_DIR, file)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (logFiles.length > maxFiles) {
      for (const file of logFiles.slice(maxFiles)) {
        try {
          fs.unlinkSync(file.path);
          originalLog(`[LOG_CLEANUP] Deleted old log file: ${file.name}`);
        } catch {
          // Silently fail
        }
      }
    }
  } catch {
    // Silently fail to avoid recursion
  }
}

function rotateLogFile(): void {
  try {
    if (currentLogStream) {
      currentLogStream.end();
      currentLogStream = null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    currentLogFilePath = path.join(LOGS_DIR, `viniplay-${timestamp}.log`);
    currentLogSize = 0;

    originalLog(`[LOG_ROTATE] Created new log file: ${path.basename(currentLogFilePath)}`);
    cleanupOldLogsByCount();
  } catch {
    // Silently fail to avoid recursion
  }
}

export function cleanupOldLogsByAge(): void {
  try {
    const autoDeleteDays = cachedLogSettings.autoDeleteDays || 0;
    if (autoDeleteDays === 0) return;

    const cutoffTime = Date.now() - autoDeleteDays * 24 * 60 * 60 * 1000;
    const logFiles = fs.readdirSync(LOGS_DIR).filter((file) => file.startsWith('viniplay-') && file.endsWith('.log'));

    for (const file of logFiles) {
      const filePath = path.join(LOGS_DIR, file);
      const stats = fs.statSync(filePath);
      if (stats.mtime.getTime() < cutoffTime) {
        try {
          fs.unlinkSync(filePath);
          originalLog(`[LOG_CLEANUP] Deleted old log file (age): ${file}`);
        } catch {
          // Silently fail
        }
      }
    }
  } catch {
    // Silently fail to avoid recursion
  }
}

function writeToLogFile(message: string): void {
  try {
    const maxSize = cachedLogSettings.maxFileSizeBytes || 5 * 1024 * 1024;
    if (currentLogSize >= maxSize) {
      rotateLogFile();
    }

    if (!currentLogStream) {
      const logPath = getCurrentLogFilePath();
      currentLogStream = fs.createWriteStream(logPath, { flags: 'a' });
      currentLogStream.on('error', (err) => {
        originalError(`[LOG_SYSTEM] Write stream error for ${logPath}: ${err.message}`);
        currentLogStream = null;
      });
      if (fs.existsSync(logPath)) {
        currentLogSize = fs.statSync(logPath).size;
      }
    }

    const logLine = `${message}\n`;
    currentLogStream.write(logLine);
    currentLogSize += Buffer.byteLength(logLine);
  } catch {
    // Silently fail to avoid infinite loop
  }
}

export function resetLogStream(): void {
  if (currentLogStream) {
    currentLogStream.end();
    currentLogStream = null;
  }
  currentLogFilePath = null;
  currentLogSize = 0;
}

export function initializeLogSystem(): void {
  originalLog = console.log.bind(console);
  originalError = console.error.bind(console);
  originalWarn = console.warn.bind(console);

  console.log = (...args: unknown[]) => {
    const message = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
    originalLog(...args);
    writeToLogFile(`[LOG] ${new Date().toISOString()} ${message}`);
  };

  console.error = (...args: unknown[]) => {
    const message = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
    originalError(...args);
    writeToLogFile(`[ERROR] ${new Date().toISOString()} ${message}`);
  };

  console.warn = (...args: unknown[]) => {
    const message = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
    originalWarn(...args);
    writeToLogFile(`[WARN] ${new Date().toISOString()} ${message}`);
  };

  refreshLogSettings();
  cleanupOldLogsByAge();
  setInterval(cleanupOldLogsByAge, 24 * 60 * 60 * 1000);

  console.log('[LOG_SYSTEM] Log rotation system initialized.');
}

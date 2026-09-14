import fs from 'fs';
import path from 'path';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { LOGS_DIR } from '../config/paths';
import { getSettings } from './settings';
import type { LogSettings } from '@homeiptv/shared-types';
import { WinstonLogger } from '../logging';
import type { ILogger } from '../logging';

let cachedLogSettings: LogSettings = {
  maxFiles: 5,
  maxFileSizeBytes: 5 * 1024 * 1024,
  autoDeleteDays: 7,
};

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let out = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (stack) {
      out += `\n${stack}`;
    }
    if (Object.keys(meta).length > 0) {
      out += `\n${JSON.stringify(meta, null, 2)}`;
    }
    return out;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `[${timestamp}] ${level}: ${stack || message}`;
  })
);

const winstonInstance = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(LOGS_DIR, 'viniplay-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: false,
      maxSize: '5m', // Overridden dynamically if needed
      maxFiles: '7d', // Overridden dynamically
      level: 'info',
    }),
  ],
});

export const logger: ILogger = new WinstonLogger(winstonInstance);

export function refreshLogSettings(): void {
  try {
    const settings = getSettings();
    if (settings.logs) {
      cachedLogSettings = settings.logs;
      // Re-configure transports based on DB settings if necessary
      const fileTransport = winstonInstance.transports.find(
        (t: any) => t.name === 'dailyRotateFile'
      ) as any;

      if (fileTransport) {
        fileTransport.maxFiles = `${cachedLogSettings.autoDeleteDays || 7}d`;
        fileTransport.maxSize = cachedLogSettings.maxFileSizeBytes || 5 * 1024 * 1024;
      }
    }
  } catch {
    // Silently fail during early startup
  }
}

export function resetLogStream(): void {
  // With Winston, rotation is handled automatically.
  // We don't need to manually reset the stream when files are deleted.
  // The daily rotate file transport will recreate the file if it's missing on the next log write.
}

export function initializeLogSystem(): void {
  refreshLogSettings();
  
  // Monkey patch console.* to route to Winston
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.log = (...args: unknown[]) => {
    logger.info(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  };
  console.error = (...args: unknown[]) => {
    logger.error(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    logger.warn(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  };

  logger.info('[LOG_SYSTEM] Winston logger initialized and console overridden.');
}

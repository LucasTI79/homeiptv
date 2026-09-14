import type winston from 'winston';
import type { ILogger } from './ILogger';

export class WinstonLogger implements ILogger {
  constructor(private readonly winstonInstance: winston.Logger) {}

  info(message: string, meta?: Record<string, unknown>): void {
    if (meta === undefined) {
      this.winstonInstance.info(message);
    } else {
      this.winstonInstance.info(message, this.normalizeMeta(meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (meta === undefined) {
      this.winstonInstance.warn(message);
    } else {
      this.winstonInstance.warn(message, this.normalizeMeta(meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (meta === undefined) {
      this.winstonInstance.error(message);
    } else {
      this.winstonInstance.error(message, this.normalizeMeta(meta));
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (meta === undefined) {
      this.winstonInstance.debug(message);
    } else {
      this.winstonInstance.debug(message, this.normalizeMeta(meta));
    }
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new WinstonLogger(this.winstonInstance.child(bindings));
  }

  private normalizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(meta)) {
      if (value instanceof Error) {
        normalized[key] = { message: value.message, stack: value.stack, name: value.name };
      } else {
        normalized[key] = value;
      }
    }
    return normalized;
  }
}

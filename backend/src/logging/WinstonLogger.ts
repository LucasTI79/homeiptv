import type winston from 'winston';
import type { ILogger } from './ILogger';

export class WinstonLogger implements ILogger {
  constructor(private readonly winstonInstance: winston.Logger) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.warn(message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.error(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.debug(message, meta);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new WinstonLogger(this.winstonInstance.child(bindings));
  }
}

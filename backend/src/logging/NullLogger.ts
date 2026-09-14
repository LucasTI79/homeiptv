import type { ILogger } from './ILogger';

export class NullLogger implements ILogger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
  child(): ILogger {
    return new NullLogger();
  }
}

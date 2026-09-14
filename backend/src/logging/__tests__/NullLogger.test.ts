import { describe, it, expect } from 'vitest';
import { NullLogger } from '../NullLogger';
import type { ILogger } from '../ILogger';

describe('NullLogger', () => {
  it('implements every ILogger method as a no-op without throwing', () => {
    const logger: ILogger = new NullLogger();
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.warn('test', { a: 1 })).not.toThrow();
    expect(() => logger.error('test', { err: new Error('x') })).not.toThrow();
    expect(() => logger.debug('test')).not.toThrow();
  });

  it('child() returns another ILogger-compatible NullLogger', () => {
    const logger: ILogger = new NullLogger();
    const child = logger.child({ module: 'TEST' });
    expect(child).toBeInstanceOf(NullLogger);
    expect(() => child.info('nested')).not.toThrow();
  });
});

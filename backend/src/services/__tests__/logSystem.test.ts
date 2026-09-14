import { describe, it, expect } from 'vitest';
import { logger } from '../logSystem';
import type { ILogger } from '../../logging';

describe('logSystem', () => {
  it('exports a logger conforming to the ILogger interface', () => {
    const typedLogger: ILogger = logger;
    expect(typeof typedLogger.info).toBe('function');
    expect(typeof typedLogger.warn).toBe('function');
    expect(typeof typedLogger.error).toBe('function');
    expect(typeof typedLogger.debug).toBe('function');
    expect(typeof typedLogger.child).toBe('function');
  });

  it('child() returns a distinct ILogger that does not throw when used', () => {
    const child = logger.child({ module: 'TEST_LOGSYSTEM' });
    expect(() => child.info('child logger message')).not.toThrow();
  });
});

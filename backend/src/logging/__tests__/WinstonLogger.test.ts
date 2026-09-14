import { describe, it, expect, vi } from 'vitest';
import { WinstonLogger } from '../WinstonLogger';

function buildFakeWinstonLogger() {
  const calls: Array<{ level: string; message: string; meta?: unknown }> = [];
  const fake = {
    info: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'info', message, meta })),
    warn: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'warn', message, meta })),
    error: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'error', message, meta })),
    debug: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'debug', message, meta })),
    child: vi.fn((bindings: unknown) => ({ ...fake, _childBindings: bindings })),
  };
  return { fake, calls };
}

describe('WinstonLogger', () => {
  it('delegates info/warn/error/debug to the wrapped winston instance', () => {
    const { fake, calls } = buildFakeWinstonLogger();
    const logger = new WinstonLogger(fake as never);

    logger.info('hello', { a: 1 });
    logger.warn('careful');
    logger.error('boom', { err: 'detail' });
    logger.debug('trace');

    expect(fake.info).toHaveBeenCalledWith('hello', { a: 1 });
    expect(fake.warn).toHaveBeenCalledWith('careful');
    expect(fake.error).toHaveBeenCalledWith('boom', { err: 'detail' });
    expect(fake.debug).toHaveBeenCalledWith('trace');
    expect(calls).toHaveLength(4);
  });

  it('child() wraps winston.child() bindings in a new WinstonLogger', () => {
    const { fake } = buildFakeWinstonLogger();
    const logger = new WinstonLogger(fake as never);

    const child = logger.child({ module: 'VAPID' });
    child.info('scoped message');

    expect(fake.child).toHaveBeenCalledWith({ module: 'VAPID' });
    expect(child).toBeInstanceOf(WinstonLogger);
    expect(fake.info).toHaveBeenCalledWith('scoped message');
  });

  it('does not forward a second argument to winston when meta is omitted (regression)', () => {
    const { fake } = buildFakeWinstonLogger();
    const logger = new WinstonLogger(fake as never);

    logger.info('some message');

    expect(fake.info).toHaveBeenCalledWith('some message');
    expect(fake.info.mock.calls[0]).toHaveLength(1);
  });

  it('normalizes Error instances in meta so message/stack survive JSON serialization', () => {
    const { fake } = buildFakeWinstonLogger();
    const logger = new WinstonLogger(fake as never);

    logger.error('boom', { error: new Error('detail message') });

    const forwardedMeta = fake.error.mock.calls[0][1] as { error: { message: string; stack?: string; name: string } };
    expect(forwardedMeta.error).not.toBeInstanceOf(Error);
    expect(forwardedMeta.error.message).toBe('detail message');
    expect(typeof forwardedMeta.error.stack).toBe('string');
    expect(JSON.stringify(forwardedMeta)).toContain('detail message');
  });
});

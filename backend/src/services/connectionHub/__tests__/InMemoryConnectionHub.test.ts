import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryConnectionHub } from '../InMemoryConnectionHub';
import { runConnectionHubContract } from './connectionHubContract';

describe('InMemoryConnectionHub', () => {
  let hub: InMemoryConnectionHub<{ value: string }>;

  afterEach(() => {
    hub?.destroy();
    vi.useRealTimers();
  });

  runConnectionHubContract('InMemoryConnectionHub', () => {
    hub = new InMemoryConnectionHub(0); // 0 disables the periodic sweep for these tests
    return hub;
  });

  it('expires a value after its TTL elapses (lazy expiry on get)', async () => {
    vi.useFakeTimers();
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: 'hello' }, 1000);
    await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });

    vi.advanceTimersByTime(1001);

    await expect(hub.get('a')).resolves.toBeUndefined();
  });

  it('a value with no ttlMs never expires', async () => {
    vi.useFakeTimers();
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: 'hello' });

    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000); // 1 year

    await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });
  });

  it('destroy() can be called more than once without throwing', () => {
    hub = new InMemoryConnectionHub(0);
    expect(() => {
      hub.destroy();
      hub.destroy();
    }).not.toThrow();
  });
});

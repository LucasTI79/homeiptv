import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryConnectionHub } from '../InMemoryConnectionHub';

describe('InMemoryConnectionHub', () => {
  let hub: InMemoryConnectionHub<{ value: string }>;

  afterEach(() => {
    hub?.destroy();
    vi.useRealTimers();
  });

  it('stores and retrieves a value by key', async () => {
    hub = new InMemoryConnectionHub(0); // 0 disables the periodic sweep for this test
    await hub.set('a', { value: 'hello' });
    await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });
  });

  it('returns undefined for a missing key', async () => {
    hub = new InMemoryConnectionHub(0);
    await expect(hub.get('missing')).resolves.toBeUndefined();
  });

  it('deletes a key', async () => {
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: 'hello' });
    await hub.delete('a');
    await expect(hub.get('a')).resolves.toBeUndefined();
  });

  it('has() reflects presence and absence', async () => {
    hub = new InMemoryConnectionHub(0);
    await expect(hub.has('a')).resolves.toBe(false);
    await hub.set('a', { value: 'hello' });
    await expect(hub.has('a')).resolves.toBe(true);
  });

  it('size() counts stored entries', async () => {
    hub = new InMemoryConnectionHub(0);
    await expect(hub.size()).resolves.toBe(0);
    await hub.set('a', { value: '1' });
    await hub.set('b', { value: '2' });
    await expect(hub.size()).resolves.toBe(2);
  });

  it('clear() empties the store', async () => {
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: '1' });
    await hub.clear();
    await expect(hub.size()).resolves.toBe(0);
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

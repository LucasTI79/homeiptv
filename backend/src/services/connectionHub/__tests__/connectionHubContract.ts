import { describe, it, expect } from 'vitest';
import type { IConnectionHub } from '../IConnectionHub';

// Shared behavioral contract every IConnectionHub<T> implementation must
// satisfy, regardless of backing store (in-memory today, Redis or another
// store later). Call this from an implementation's own test file with a
// factory that returns a fresh instance per test. Deliberately excludes
// TTL and any implementation-specific lifecycle methods (e.g. destroy()) --
// those aren't part of IConnectionHub<T> itself, so a future backing store
// may implement them completely differently.
export function runConnectionHubContract(
  implementationName: string,
  createHub: () => IConnectionHub<{ value: string }>
): void {
  describe(`${implementationName} (IConnectionHub contract)`, () => {
    it('stores and retrieves a value by key', async () => {
      const hub = createHub();
      await hub.set('a', { value: 'hello' });
      await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });
    });

    it('returns undefined for a missing key', async () => {
      const hub = createHub();
      await expect(hub.get('missing')).resolves.toBeUndefined();
    });

    it('deletes a key', async () => {
      const hub = createHub();
      await hub.set('a', { value: 'hello' });
      await hub.delete('a');
      await expect(hub.get('a')).resolves.toBeUndefined();
    });

    it('deleting a key that was never set does not throw', async () => {
      const hub = createHub();
      await expect(hub.delete('missing')).resolves.toBeUndefined();
    });

    it('has() reflects presence and absence', async () => {
      const hub = createHub();
      await expect(hub.has('a')).resolves.toBe(false);
      await hub.set('a', { value: 'hello' });
      await expect(hub.has('a')).resolves.toBe(true);
    });

    it('size() counts stored entries', async () => {
      const hub = createHub();
      await expect(hub.size()).resolves.toBe(0);
      await hub.set('a', { value: '1' });
      await hub.set('b', { value: '2' });
      await expect(hub.size()).resolves.toBe(2);
    });

    it('setting the same key twice overwrites the value without changing size', async () => {
      const hub = createHub();
      await hub.set('a', { value: '1' });
      await hub.set('a', { value: '2' });
      await expect(hub.get('a')).resolves.toEqual({ value: '2' });
      await expect(hub.size()).resolves.toBe(1);
    });

    it('clear() empties the store', async () => {
      const hub = createHub();
      await hub.set('a', { value: '1' });
      await hub.set('b', { value: '2' });
      await hub.clear();
      await expect(hub.size()).resolves.toBe(0);
      await expect(hub.has('a')).resolves.toBe(false);
    });
  });
}

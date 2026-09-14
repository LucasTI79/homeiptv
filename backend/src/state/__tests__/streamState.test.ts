import { describe, it, expect, afterEach } from 'vitest';
import { activeCastTokens } from '../streamState';

describe('activeCastTokens', () => {
  afterEach(async () => {
    await activeCastTokens.clear();
  });

  it('conforms to the IConnectionHub async interface', async () => {
    await activeCastTokens.set('token-1', { userId: 1, streamUrl: 'http://example.com/a.ts', expiresAt: Date.now() + 1000, createdAt: Date.now() });
    await expect(activeCastTokens.get('token-1')).resolves.toMatchObject({ userId: 1, streamUrl: 'http://example.com/a.ts' });
    await expect(activeCastTokens.has('token-1')).resolves.toBe(true);
    await activeCastTokens.delete('token-1');
    await expect(activeCastTokens.get('token-1')).resolves.toBeUndefined();
  });

  it('supports the hub TTL feature for automatic cast-token expiry', async () => {
    await activeCastTokens.set('token-2', { userId: 1, streamUrl: 'http://example.com/a.ts', expiresAt: Date.now() + 1000, createdAt: Date.now() }, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(activeCastTokens.get('token-2')).resolves.toBeUndefined();
  });
});

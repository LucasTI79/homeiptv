import { describe, it, expect } from 'vitest';
import { NoSubtitleAvailableProvider } from '../NoSubtitleAvailableProvider';

describe('NoSubtitleAvailableProvider', () => {
  it('always resolves with available: false and never throws', async () => {
    const provider = new NoSubtitleAvailableProvider();

    const result = await provider.attempt({ mediaUrl: 'anything', targetId: 'anything' });

    expect(result).toEqual({ available: false });
  });
});

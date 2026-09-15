import { describe, it, expect, vi } from 'vitest';
import { ProviderChain, type ChainableProvider } from '../ProviderChain';
import { NullLogger } from '../../../logging';

interface Req { id: string; }
interface Res { ok: boolean; value?: string; }

function provider(name: string, attempt: ChainableProvider<Req, Res>['attempt']): ChainableProvider<Req, Res> {
  return { name, attempt };
}

const succeeds = (r: Res) => r.ok;

describe('ProviderChain', () => {
  it('returns the first provider result when it succeeds, without calling later providers', async () => {
    const second = vi.fn();
    const chain = new ProviderChain<Req, Res>(
      [provider('first', async () => ({ ok: true, value: 'from-first' })), provider('second', second)],
      succeeds,
      {},
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'from-first' });
    expect(second).not.toHaveBeenCalled();
  });

  it('retries a throwing provider up to retriesPerProvider extra times before giving up on it', async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error('transient failure');
      return { ok: true, value: 'recovered' };
    });
    const chain = new ProviderChain<Req, Res>(
      [provider('flaky', flaky)],
      succeeds,
      { retriesPerProvider: 1 },
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'recovered' });
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('moves to the next provider once a provider exhausts its retries', async () => {
    const alwaysThrows = vi.fn(async () => { throw new Error('permanent failure'); });
    const chain = new ProviderChain<Req, Res>(
      [
        provider('broken', alwaysThrows),
        provider('fallback', async () => ({ ok: true, value: 'from-fallback' })),
      ],
      succeeds,
      { retriesPerProvider: 1 },
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'from-fallback' });
    expect(alwaysThrows).toHaveBeenCalledTimes(2);
  });

  it('moves to the next provider immediately (no retry) when a provider resolves an unsuccessful result', async () => {
    const nothingToOffer = vi.fn(async () => ({ ok: false }));
    const chain = new ProviderChain<Req, Res>(
      [
        provider('empty', nothingToOffer),
        provider('fallback', async () => ({ ok: true, value: 'from-fallback' })),
      ],
      succeeds,
      { retriesPerProvider: 2 },
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'from-fallback' });
    expect(nothingToOffer).toHaveBeenCalledTimes(1);
  });

  it('returns the last unsuccessful result when every provider has nothing to offer', async () => {
    const chain = new ProviderChain<Req, Res>(
      [provider('empty1', async () => ({ ok: false })), provider('empty2', async () => ({ ok: false, value: 'last' }))],
      succeeds,
      {},
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: false, value: 'last' });
  });

  it('throws the last error when every provider throws', async () => {
    const chain = new ProviderChain<Req, Res>(
      [
        provider('a', async () => { throw new Error('a failed'); }),
        provider('b', async () => { throw new Error('b failed'); }),
      ],
      succeeds,
      { retriesPerProvider: 0 },
      new NullLogger()
    );

    await expect(chain.run({ id: 'x' })).rejects.toThrow('b failed');
  });
});

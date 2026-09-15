import { logger as defaultLogger } from '../logSystem';
import type { ILogger } from '../../logging';

export interface ChainableProvider<TRequest, TResult> {
  readonly name: string;
  attempt(request: TRequest): Promise<TResult>;
}

export interface ProviderChainOptions {
  retriesPerProvider?: number;
}

// Generic ordered fallback chain: tries each provider in turn. A provider
// that throws is retried up to `retriesPerProvider` extra times before the
// chain gives up on it and moves to the next one. A provider that resolves
// without throwing but whose result fails `succeeds` is treated as "this
// provider has nothing to offer" -- the chain moves on immediately, with no
// retry, since retrying won't change a provider's own "I can't help" answer.
export class ProviderChain<TRequest, TResult> {
  private readonly retriesPerProvider: number;

  constructor(
    private readonly providers: ChainableProvider<TRequest, TResult>[],
    private readonly succeeds: (result: TResult) => boolean,
    options: ProviderChainOptions = {},
    private readonly injectedLogger: ILogger = defaultLogger
  ) {
    this.retriesPerProvider = options.retriesPerProvider ?? 1;
  }

  async run(request: TRequest): Promise<TResult> {
    let lastResult: TResult | undefined;
    let lastError: unknown;

    for (const provider of this.providers) {
      const totalAttempts = this.retriesPerProvider + 1;
      let providerThrew = false;

      for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        try {
          const result = await provider.attempt(request);
          providerThrew = false;
          if (this.succeeds(result)) {
            this.injectedLogger.info(`[ProviderChain] ${provider.name} succeeded on attempt ${attempt}/${totalAttempts}`);
            return result;
          }
          this.injectedLogger.warn(`[ProviderChain] ${provider.name} returned an unsuccessful result, moving to next provider`);
          lastResult = result;
          break;
        } catch (err) {
          providerThrew = true;
          lastError = err;
          this.injectedLogger.warn(`[ProviderChain] ${provider.name} threw on attempt ${attempt}/${totalAttempts}: ${(err as Error).message}`);
        }
      }

      if (providerThrew) {
        this.injectedLogger.warn(`[ProviderChain] ${provider.name} exhausted all ${totalAttempts} attempts, moving to next provider`);
      }
    }

    if (lastResult !== undefined) return lastResult;
    if (lastError !== undefined) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    throw new Error('ProviderChain: no providers were configured');
  }
}

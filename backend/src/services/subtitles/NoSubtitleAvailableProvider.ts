import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { SubtitleRequest, SubtitleResult } from './ISubtitleProvider';

// Terminal fallback: always resolves (never throws) so the chain always has
// a final, non-throwing result to fall back to when every real provider
// fails or has nothing to offer.
export class NoSubtitleAvailableProvider implements ChainableProvider<SubtitleRequest, SubtitleResult> {
  public readonly name = 'NoSubtitleAvailableProvider';

  async attempt(_request: SubtitleRequest): Promise<SubtitleResult> {
    return { available: false };
  }
}

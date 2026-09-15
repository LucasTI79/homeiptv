import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { ThumbnailRequest, ThumbnailResult } from './IThumbnailProvider';

export class NoThumbnailAvailableProvider implements ChainableProvider<ThumbnailRequest, ThumbnailResult> {
  public readonly name = 'NoThumbnailAvailableProvider';

  async attempt(_request: ThumbnailRequest): Promise<ThumbnailResult> {
    return { available: false };
  }
}

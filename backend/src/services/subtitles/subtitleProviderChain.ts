import { ProviderChain } from '../mediaIntelligence/ProviderChain';
import { WhisperSubtitleProvider } from './WhisperSubtitleProvider';
import { EmbeddedTrackSubtitleProvider } from './EmbeddedTrackSubtitleProvider';
import { NoSubtitleAvailableProvider } from './NoSubtitleAvailableProvider';
import { SUBTITLES_DIR } from './subtitlesDir';
import type { SubtitleRequest, SubtitleResult } from './ISubtitleProvider';

export const subtitleProviderChain = new ProviderChain<SubtitleRequest, SubtitleResult>(
  [
    new WhisperSubtitleProvider(SUBTITLES_DIR),
    new EmbeddedTrackSubtitleProvider(SUBTITLES_DIR),
    new NoSubtitleAvailableProvider(),
  ],
  (result) => result.available
);

export type { SubtitleRequest, SubtitleResult } from './ISubtitleProvider';

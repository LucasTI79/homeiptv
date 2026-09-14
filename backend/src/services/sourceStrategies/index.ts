import type { M3uSource } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import { M3uFileStrategy } from './M3uFileStrategy';
import { M3uUrlStrategy } from './M3uUrlStrategy';
import { XtreamCodesStrategy } from './XtreamCodesStrategy';

const strategies: Record<M3uSource['type'], PlaylistSourceStrategy> = {
  file: new M3uFileStrategy(),
  url: new M3uUrlStrategy(),
  xc: new XtreamCodesStrategy(),
};

export function selectPlaylistStrategy(type: M3uSource['type']): PlaylistSourceStrategy {
  const strategy = strategies[type];
  if (!strategy) {
    throw new Error(`No playlist source strategy registered for type "${type}"`);
  }
  return strategy;
}

export type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
export { M3uFileStrategy } from './M3uFileStrategy';
export { M3uUrlStrategy } from './M3uUrlStrategy';
export { XtreamCodesStrategy } from './XtreamCodesStrategy';

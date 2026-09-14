import { describe, it, expect } from 'vitest';
import { selectPlaylistStrategy } from '../index';
import { M3uFileStrategy } from '../M3uFileStrategy';
import { M3uUrlStrategy } from '../M3uUrlStrategy';
import { XtreamCodesStrategy } from '../XtreamCodesStrategy';

describe('selectPlaylistStrategy', () => {
  it('resolves "file" to M3uFileStrategy', () => {
    expect(selectPlaylistStrategy('file')).toBeInstanceOf(M3uFileStrategy);
  });

  it('resolves "url" to M3uUrlStrategy', () => {
    expect(selectPlaylistStrategy('url')).toBeInstanceOf(M3uUrlStrategy);
  });

  it('resolves "xc" to XtreamCodesStrategy', () => {
    expect(selectPlaylistStrategy('xc')).toBeInstanceOf(XtreamCodesStrategy);
  });

  it('throws a descriptive error for an unregistered type', () => {
    // @ts-expect-error -- intentionally passing a value outside M3uSource['type'] to exercise the defensive branch
    expect(() => selectPlaylistStrategy('stalker')).toThrow('No playlist source strategy registered for type "stalker"');
  });
});

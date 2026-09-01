import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config/paths';

export const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'image_cache');
fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });

export function cachePathsFor(imageUrl: string) {
  const urlHash = crypto.createHash('sha256').update(imageUrl).digest('hex');
  return {
    cacheFilePath: path.join(IMAGE_CACHE_DIR, urlHash),
    cacheMetaPath: path.join(IMAGE_CACHE_DIR, `${urlHash}.meta`),
  };
}

import fs from 'fs';
import path from 'path';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import type { SendStatus } from '../httpFetch';
import { SOURCES_DIR } from '../../config/paths';

export class M3uFileStrategy implements PlaylistSourceStrategy {
  async fetchContent(source: M3uSource, _settings: Settings, sendStatus: SendStatus): Promise<string> {
    const sourceFilePath = path.join(SOURCES_DIR, path.basename(source.path));
    if (!fs.existsSync(sourceFilePath)) {
      sendStatus(`Error: File not found for source "${source.name}". Skipping.`, 'error');
      source.status = 'Error';
      source.statusMessage = 'File not found.';
      throw new Error('File not found.');
    }
    return fs.readFileSync(sourceFilePath, 'utf-8');
  }
}

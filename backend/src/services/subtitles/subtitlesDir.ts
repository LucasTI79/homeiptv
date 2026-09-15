import path from 'path';
import fs from 'fs';

// Preserves the exact pre-existing directory transcriptionQueue.ts used
// (backend/data/subtitles), NOT the repo-root DATA_DIR convention
// backend/src/config/paths.ts uses for everything else -- changing this
// would orphan already-generated .vtt files on disk. Deliberately kept as
// its own tiny module (not exported from transcriptionQueue.ts) so that
// file and this services/subtitles/ package never need to import each
// other, avoiding the kind of circular dependency Phase 4/5 had to unwind.
export const SUBTITLES_DIR = path.join(__dirname, '../../../data/subtitles');

fs.mkdirSync(SUBTITLES_DIR, { recursive: true });

# Progressive Subtitle Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing whole-file, single-queue subtitle transcription with a worker-pool-based system that generates subtitles chunk-by-chunk off the main thread, prioritized by playback position, with language selection, translation, a "forced" (only-foreign-segments) mode, retry, and Cast (TV) support.

**Architecture:** A fixed-size `worker_threads` pool pulls chunks (75s each) from a shared priority queue fed by all active jobs; each worker extracts audio (ffmpeg), transcribes (Whisper), detects the chunk's language (`franc`), optionally translates (`@xenova/transformers`, NLLB-200), and writes a per-chunk `.vtt`. The backend pushes `chunk-ready`/`chunk-failed`/`job-complete` events over the existing global SSE channel; the frontend reloads the concatenated VTT track incrementally and reports playback position for re-prioritization on seek. The Cast sender relays the same events to the custom Cast receiver over a custom message channel so the TV's subtitle track stays in sync without duplicating the pipeline.

**Tech Stack:** Node `worker_threads`, `fluent-ffmpeg`, `whisper-node` (existing), `franc` (new, language detection from text), `@xenova/transformers` (new, local NLLB-200 translation), Express + existing SSE infra (`sendSseEvent`), React 19, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-14-progressive-subtitle-generation-design.md](../specs/2026-10-14-progressive-subtitle-generation-design.md)

## Global Constraints

- Chunk size: 75 seconds, configurable via `SUBTITLE_CHUNK_SECONDS` env var (default `75`).
- Worker pool size: 2, configurable via `SUBTITLE_WORKER_POOL_SIZE` env var (default `2`).
- Chunk retry: up to 3 attempts with backoff 1s, 3s, 9s before marking a chunk `failed`.
- Subtitle files directory stays `backend/data/subtitles` (`SUBTITLES_DIR` from `backend/src/services/subtitles/subtitlesDir.ts`) — do not change this path, existing deployments depend on it.
- Translation and language detection run **inside the worker thread**, never on the main thread.
- A translation failure degrades gracefully (chunk still completes, cue kept in original language, `translationFailed: true`) — it must never fail the whole chunk or job.
- Every change touching player/Cast code must follow the new project rule in `CLAUDE.md` (Cast compatibility + test coverage for the Cast path).

## Review Focus

- Video shorter than one chunk (e.g. a 40s trailer) — `ChunkPlanner` must produce exactly one chunk covering the full duration, not zero chunks or a negative-length chunk.
- User seeks past every chunk generated so far (e.g. jumps to the last 5 minutes of a 2-hour movie) — `SubtitleJobManager.reprioritize` must not crash or infinite-loop when the target position has no chunk index yet computed, and must still enqueue that chunk with top priority.
- Two different users (or the same user in two tabs) request subtitle generation for the **same** `targetId` with different `outputLanguage`/`mode` combinations at the same time — jobs must be keyed by `(targetId, outputLanguage, mode)`, not just `targetId`, or one request silently overwrites the other's job state.
- `franc` returns `'und'` (undetermined) for a very short or silent chunk (e.g. 75s of near-silence or music with no lyrics) — the pipeline must treat this as "same as spoken language" in `forced` mode (no cue) rather than crashing on an unmapped language code or emitting a bogus cue.
- Cast session disconnects (TV turns off) mid-job — the backend job must keep running to completion in the background (it is not tied to any single SSE/Cast connection), and the sender must not crash when `sendCustomMessage` is called with no active session.

---

### Task 1: Subtitle config module and new dependencies

**Files:**
- Create: `backend/src/services/subtitles/subtitleConfig.ts`
- Test: `backend/src/services/subtitles/__tests__/subtitleConfig.test.ts`
- Modify: `backend/package.json` (add `franc`, `@xenova/transformers`)

**Interfaces:**
- Produces: `getSubtitleChunkSeconds(): number`, `getSubtitleWorkerPoolSize(): number` — used by `ChunkPlanner` (Task 2) and `SubtitleWorkerPool` (Task 9).

- [ ] **Step 1: Install new dependencies**

```bash
cd backend && npm install franc @xenova/transformers
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/subtitleConfig.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { getSubtitleChunkSeconds, getSubtitleWorkerPoolSize } from '../subtitleConfig';

describe('subtitleConfig', () => {
  const originalChunk = process.env.SUBTITLE_CHUNK_SECONDS;
  const originalPool = process.env.SUBTITLE_WORKER_POOL_SIZE;

  afterEach(() => {
    process.env.SUBTITLE_CHUNK_SECONDS = originalChunk;
    process.env.SUBTITLE_WORKER_POOL_SIZE = originalPool;
  });

  it('defaults chunk seconds to 75 when unset', () => {
    delete process.env.SUBTITLE_CHUNK_SECONDS;
    expect(getSubtitleChunkSeconds()).toBe(75);
  });

  it('reads chunk seconds from env when set to a valid positive integer', () => {
    process.env.SUBTITLE_CHUNK_SECONDS = '45';
    expect(getSubtitleChunkSeconds()).toBe(45);
  });

  it('falls back to default when env value is not a valid positive integer', () => {
    process.env.SUBTITLE_CHUNK_SECONDS = 'not-a-number';
    expect(getSubtitleChunkSeconds()).toBe(75);
  });

  it('defaults worker pool size to 2 when unset', () => {
    delete process.env.SUBTITLE_WORKER_POOL_SIZE;
    expect(getSubtitleWorkerPoolSize()).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/subtitleConfig.test.ts`
Expected: FAIL with "Cannot find module '../subtitleConfig'"

- [ ] **Step 4: Write minimal implementation**

```typescript
// backend/src/services/subtitles/subtitleConfig.ts
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getSubtitleChunkSeconds(): number {
  return parsePositiveInt(process.env.SUBTITLE_CHUNK_SECONDS, 75);
}

export function getSubtitleWorkerPoolSize(): number {
  return parsePositiveInt(process.env.SUBTITLE_WORKER_POOL_SIZE, 2);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/subtitleConfig.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/subtitles/subtitleConfig.ts backend/src/services/subtitles/__tests__/subtitleConfig.test.ts
git commit -m "feat(subtitles): add config module for chunk size and worker pool size"
```

---

### Task 2: ChunkPlanner

**Files:**
- Create: `backend/src/services/subtitles/ChunkPlanner.ts`
- Test: `backend/src/services/subtitles/__tests__/ChunkPlanner.test.ts`

**Interfaces:**
- Consumes: `getSubtitleChunkSeconds()` from Task 1.
- Produces: `export interface SubtitleChunk { index: number; startSec: number; endSec: number }`, `export function planChunks(durationSec: number, chunkSeconds?: number): SubtitleChunk[]` — consumed by `SubtitleJobManager` (Task 7).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/ChunkPlanner.test.ts
import { describe, it, expect } from 'vitest';
import { planChunks } from '../ChunkPlanner';

describe('planChunks', () => {
  it('splits a duration evenly divisible by chunk size into equal chunks', () => {
    const chunks = planChunks(150, 75);
    expect(chunks).toEqual([
      { index: 0, startSec: 0, endSec: 75 },
      { index: 1, startSec: 75, endSec: 150 },
    ]);
  });

  it('gives the last chunk the remainder when not evenly divisible', () => {
    const chunks = planChunks(160, 75);
    expect(chunks).toEqual([
      { index: 0, startSec: 0, endSec: 75 },
      { index: 1, startSec: 75, endSec: 150 },
      { index: 2, startSec: 150, endSec: 160 },
    ]);
  });

  it('produces exactly one chunk covering the whole duration when duration is shorter than chunk size', () => {
    const chunks = planChunks(40, 75);
    expect(chunks).toEqual([{ index: 0, startSec: 0, endSec: 40 }]);
  });

  it('throws for a non-positive duration', () => {
    expect(() => planChunks(0, 75)).toThrow('durationSec must be greater than 0');
    expect(() => planChunks(-10, 75)).toThrow('durationSec must be greater than 0');
  });

  it('uses the configured default chunk size when not passed explicitly', () => {
    const chunks = planChunks(75);
    expect(chunks).toEqual([{ index: 0, startSec: 0, endSec: 75 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/ChunkPlanner.test.ts`
Expected: FAIL with "Cannot find module '../ChunkPlanner'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/ChunkPlanner.ts
import { getSubtitleChunkSeconds } from './subtitleConfig';

export interface SubtitleChunk {
  index: number;
  startSec: number;
  endSec: number;
}

export function planChunks(durationSec: number, chunkSeconds: number = getSubtitleChunkSeconds()): SubtitleChunk[] {
  if (durationSec <= 0) {
    throw new Error('durationSec must be greater than 0');
  }

  const chunks: SubtitleChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < durationSec) {
    const end = Math.min(start + chunkSeconds, durationSec);
    chunks.push({ index, startSec: start, endSec: end });
    start = end;
    index += 1;
  }
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/ChunkPlanner.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/ChunkPlanner.ts backend/src/services/subtitles/__tests__/ChunkPlanner.test.ts
git commit -m "feat(subtitles): add ChunkPlanner to split a video duration into fixed-size chunks"
```

---

### Task 3: Language detector (franc wrapper + code mapping)

**Files:**
- Create: `backend/src/services/subtitles/languageDetector.ts`
- Test: `backend/src/services/subtitles/__tests__/languageDetector.test.ts`

**Interfaces:**
- Produces: `export type SupportedLanguage = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'ko' | 'zh' | 'ru'`, `export function detectLanguage(text: string): SupportedLanguage | 'und'` — consumed by `subtitleChunkWorker.ts` (Task 8).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/languageDetector.test.ts
import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../languageDetector';

describe('detectLanguage', () => {
  it('detects English text', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog near the riverbank.')).toBe('en');
  });

  it('detects Portuguese text', () => {
    expect(detectLanguage('O rato roeu a roupa do rei de Roma enquanto todos dormiam tranquilos.')).toBe('pt');
  });

  it('returns "und" for empty or whitespace-only text', () => {
    expect(detectLanguage('')).toBe('und');
    expect(detectLanguage('   ')).toBe('und');
  });

  it('returns "und" for text in a language outside the supported set', () => {
    // Thai - not in the curated SupportedLanguage list
    expect(detectLanguage('สวัสดีครับ วันนี้อากาศดีมาก ผมอยากไปเที่ยวทะเล')).toBe('und');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/languageDetector.test.ts`
Expected: FAIL with "Cannot find module '../languageDetector'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/languageDetector.ts
import { franc } from 'franc';

export type SupportedLanguage = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'ko' | 'zh' | 'ru';

// franc returns ISO 639-3 codes; map the ones we expose in the UI down to
// ISO 639-1, which is what Whisper and the translation model both expect.
// Any code outside this map (or franc's 'und') is reported as 'und' so
// callers have one explicit "unknown" value to branch on, instead of
// silently matching/mismatching an unmapped code against a user's choice.
const ISO_639_3_TO_1: Record<string, SupportedLanguage> = {
  eng: 'en',
  por: 'pt',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  cmn: 'zh',
  rus: 'ru',
};

export function detectLanguage(text: string): SupportedLanguage | 'und' {
  const trimmed = text.trim();
  if (!trimmed) return 'und';

  const code3 = franc(trimmed);
  return ISO_639_3_TO_1[code3] ?? 'und';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/languageDetector.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/languageDetector.ts backend/src/services/subtitles/__tests__/languageDetector.test.ts
git commit -m "feat(subtitles): add text-based language detector backed by franc"
```

---

### Task 4: TranslationService

**Files:**
- Create: `backend/src/services/subtitles/TranslationService.ts`
- Test: `backend/src/services/subtitles/__tests__/TranslationService.test.ts`

**Interfaces:**
- Consumes: `SupportedLanguage` from Task 3.
- Produces: `export interface TranslationService { translate(text: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage): Promise<string> }`, `export const translationService: TranslationService` — consumed by `subtitleChunkWorker.ts` (Task 8).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/TranslationService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pipelineMock = vi.fn();
vi.mock('@xenova/transformers', () => ({
  pipeline: pipelineMock,
}));

import { XenovaTranslationService } from '../TranslationService';

describe('XenovaTranslationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lazily loads the translation pipeline once and reuses it across calls', async () => {
    const translatorFn = vi.fn().mockResolvedValue([{ translation_text: 'Olá mundo' }]);
    pipelineMock.mockResolvedValue(translatorFn);

    const service = new XenovaTranslationService();
    const result1 = await service.translate('Hello world', 'en', 'pt');
    const result2 = await service.translate('Hello again', 'en', 'pt');

    expect(result1).toBe('Olá mundo');
    expect(result2).toBe('Olá mundo');
    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineMock).toHaveBeenCalledWith('translation', 'Xenova/nllb-200-distilled-600M');
  });

  it('passes the correct FLORES-200 source and target language codes', async () => {
    const translatorFn = vi.fn().mockResolvedValue([{ translation_text: 'Bonjour' }]);
    pipelineMock.mockResolvedValue(translatorFn);

    const service = new XenovaTranslationService();
    await service.translate('Hello', 'en', 'fr');

    expect(translatorFn).toHaveBeenCalledWith('Hello', {
      src_lang: 'eng_Latn',
      tgt_lang: 'fra_Latn',
    });
  });

  it('returns the original text unchanged when source and target language are the same', async () => {
    const service = new XenovaTranslationService();
    const result = await service.translate('Same language', 'en', 'en');
    expect(result).toBe('Same language');
    expect(pipelineMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/TranslationService.test.ts`
Expected: FAIL with "Cannot find module '../TranslationService'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/TranslationService.ts
import type { SupportedLanguage } from './languageDetector';

// Xenova/nllb-200-distilled-600M speaks FLORES-200 language tags, not plain
// ISO 639-1 -- this maps the curated set of languages the UI exposes.
const FLORES_200_CODE: Record<SupportedLanguage, string> = {
  en: 'eng_Latn',
  pt: 'por_Latn',
  es: 'spa_Latn',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  it: 'ita_Latn',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
  zh: 'zho_Hans',
  ru: 'rus_Cyrl',
};

export interface TranslationService {
  translate(text: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage): Promise<string>;
}

type TranslatorFn = (text: string, options: { src_lang: string; tgt_lang: string }) => Promise<Array<{ translation_text: string }>>;

export class XenovaTranslationService implements TranslationService {
  private translatorPromise: Promise<TranslatorFn> | null = null;

  private async getTranslator(): Promise<TranslatorFn> {
    if (!this.translatorPromise) {
      // Loaded lazily (and cached) so a server that never translates never
      // pays the model-load cost, and so every call after the first reuses
      // the same in-memory model instead of reloading it per chunk.
      this.translatorPromise = import('@xenova/transformers').then(({ pipeline }) =>
        pipeline('translation', 'Xenova/nllb-200-distilled-600M') as unknown as Promise<TranslatorFn>
      );
    }
    return this.translatorPromise;
  }

  async translate(text: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage): Promise<string> {
    if (sourceLang === targetLang) {
      return text;
    }

    const translator = await this.getTranslator();
    const output = await translator(text, {
      src_lang: FLORES_200_CODE[sourceLang],
      tgt_lang: FLORES_200_CODE[targetLang],
    });
    return output[0].translation_text;
  }
}

export const translationService: TranslationService = new XenovaTranslationService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/TranslationService.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/TranslationService.ts backend/src/services/subtitles/__tests__/TranslationService.test.ts
git commit -m "feat(subtitles): add local NLLB-200 translation service"
```

---

### Task 5: VttStore

**Files:**
- Create: `backend/src/services/subtitles/VttStore.ts`
- Test: `backend/src/services/subtitles/__tests__/VttStore.test.ts`

**Interfaces:**
- Consumes: `SUBTITLES_DIR` from `backend/src/services/subtitles/subtitlesDir.ts`.
- Produces: `export interface VttCue { startSec: number; endSec: number; text: string }`, `export function writeChunkVtt(jobId: string, chunkIndex: number, cues: VttCue[]): void`, `export function readChunkVtt(jobId: string, chunkIndex: number): VttCue[] | null`, `export function concatenateVtt(jobId: string, chunkIndexesInOrder: number[]): string` — consumed by `subtitleChunkWorker.ts` (Task 8) and the `GET /jobs/:jobId/vtt` route (Task 11).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/VttStore.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempDir: string;

vi.mock('../subtitlesDir', () => ({
  get SUBTITLES_DIR() {
    return tempDir;
  },
}));

import { writeChunkVtt, readChunkVtt, concatenateVtt } from '../VttStore';

describe('VttStore', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vttstore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a chunk with cues and reads it back', () => {
    writeChunkVtt('job1', 0, [{ startSec: 0, endSec: 2.5, text: 'hello' }]);
    const cues = readChunkVtt('job1', 0);
    expect(cues).toEqual([{ startSec: 0, endSec: 2.5, text: 'hello' }]);
  });

  it('writes an empty VTT (no cues) for a forced-mode chunk with no foreign speech', () => {
    writeChunkVtt('job1', 1, []);
    const cues = readChunkVtt('job1', 1);
    expect(cues).toEqual([]);
  });

  it('returns null for a chunk that was never written', () => {
    expect(readChunkVtt('job1', 99)).toBeNull();
  });

  it('concatenates chunks in the given order into one WEBVTT document with renumbered cues', () => {
    writeChunkVtt('job2', 0, [{ startSec: 0, endSec: 1, text: 'first' }]);
    writeChunkVtt('job2', 1, [{ startSec: 75, endSec: 76, text: 'second' }]);

    const merged = concatenateVtt('job2', [0, 1]);

    expect(merged.startsWith('WEBVTT\n\n')).toBe(true);
    expect(merged).toContain('1\n00:00:00.000 --> 00:00:01.000\nfirst');
    expect(merged).toContain('2\n00:01:15.000 --> 00:01:16.000\nsecond');
  });

  it('skips chunks that are not yet written when concatenating', () => {
    writeChunkVtt('job3', 0, [{ startSec: 0, endSec: 1, text: 'only this one exists' }]);
    const merged = concatenateVtt('job3', [0, 1, 2]);
    expect(merged).toContain('only this one exists');
    expect(merged.match(/-->/g)?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/VttStore.test.ts`
Expected: FAIL with "Cannot find module '../VttStore'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/VttStore.ts
import fs from 'fs';
import path from 'path';
import { SUBTITLES_DIR } from './subtitlesDir';

export interface VttCue {
  startSec: number;
  endSec: number;
  text: string;
}

function jobDir(jobId: string): string {
  const dir = path.join(SUBTITLES_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function chunkJsonPath(jobId: string, chunkIndex: number): string {
  return path.join(jobDir(jobId), `chunk-${chunkIndex}.json`);
}

function formatTimestamp(seconds: number): string {
  const date = new Date(0);
  date.setMilliseconds(Math.max(0, seconds) * 1000);
  return date.toISOString().substring(11, 23);
}

export function writeChunkVtt(jobId: string, chunkIndex: number, cues: VttCue[]): void {
  fs.writeFileSync(chunkJsonPath(jobId, chunkIndex), JSON.stringify(cues), 'utf8');
}

export function readChunkVtt(jobId: string, chunkIndex: number): VttCue[] | null {
  const filePath = chunkJsonPath(jobId, chunkIndex);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as VttCue[];
}

export function concatenateVtt(jobId: string, chunkIndexesInOrder: number[]): string {
  let vtt = 'WEBVTT\n\n';
  let cueNumber = 1;

  for (const chunkIndex of chunkIndexesInOrder) {
    const cues = readChunkVtt(jobId, chunkIndex);
    if (!cues) continue;

    for (const cue of cues) {
      vtt += `${cueNumber}\n${formatTimestamp(cue.startSec)} --> ${formatTimestamp(cue.endSec)}\n${cue.text}\n\n`;
      cueNumber += 1;
    }
  }

  return vtt;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/VttStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/VttStore.ts backend/src/services/subtitles/__tests__/VttStore.test.ts
git commit -m "feat(subtitles): add VttStore for per-chunk cue storage and concatenation"
```

---

### Task 6: SubtitlePriorityQueue

**Files:**
- Create: `backend/src/services/subtitles/SubtitlePriorityQueue.ts`
- Test: `backend/src/services/subtitles/__tests__/SubtitlePriorityQueue.test.ts`

**Interfaces:**
- Produces: `export interface QueuedChunk { jobId: string; chunkIndex: number; distance: number }`, `export class SubtitlePriorityQueue { enqueue(item: QueuedChunk): void; dequeueNext(): QueuedChunk | null; reprioritizeJob(jobId: string, distanceForChunk: (chunkIndex: number) => number): void; removeJob(jobId: string): void; size(): number }` — consumed by `SubtitleJobManager` (Task 7) and `SubtitleWorkerPool` (Task 9).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/SubtitlePriorityQueue.test.ts
import { describe, it, expect } from 'vitest';
import { SubtitlePriorityQueue } from '../SubtitlePriorityQueue';

describe('SubtitlePriorityQueue', () => {
  it('dequeues the item with the smallest distance first', () => {
    const queue = new SubtitlePriorityQueue();
    queue.enqueue({ jobId: 'a', chunkIndex: 2, distance: 50 });
    queue.enqueue({ jobId: 'a', chunkIndex: 0, distance: 5 });
    queue.enqueue({ jobId: 'a', chunkIndex: 1, distance: 20 });

    expect(queue.dequeueNext()).toEqual({ jobId: 'a', chunkIndex: 0, distance: 5 });
    expect(queue.dequeueNext()).toEqual({ jobId: 'a', chunkIndex: 1, distance: 20 });
    expect(queue.dequeueNext()).toEqual({ jobId: 'a', chunkIndex: 2, distance: 50 });
  });

  it('returns null when empty', () => {
    const queue = new SubtitlePriorityQueue();
    expect(queue.dequeueNext()).toBeNull();
  });

  it('interleaves chunks from multiple jobs by distance, not insertion order', () => {
    const queue = new SubtitlePriorityQueue();
    queue.enqueue({ jobId: 'job-A', chunkIndex: 0, distance: 100 });
    queue.enqueue({ jobId: 'job-B', chunkIndex: 0, distance: 1 });

    expect(queue.dequeueNext()?.jobId).toBe('job-B');
    expect(queue.dequeueNext()?.jobId).toBe('job-A');
  });

  it('reprioritizes all pending chunks of a job using the provided distance function, without dropping any', () => {
    const queue = new SubtitlePriorityQueue();
    queue.enqueue({ jobId: 'a', chunkIndex: 0, distance: 1000 });
    queue.enqueue({ jobId: 'a', chunkIndex: 1, distance: 2000 });

    queue.reprioritizeJob('a', (chunkIndex) => (chunkIndex === 1 ? 0 : 999));

    expect(queue.size()).toBe(2);
    expect(queue.dequeueNext()).toEqual({ jobId: 'a', chunkIndex: 1, distance: 0 });
  });

  it('removes all pending chunks for a job', () => {
    const queue = new SubtitlePriorityQueue();
    queue.enqueue({ jobId: 'a', chunkIndex: 0, distance: 1 });
    queue.enqueue({ jobId: 'b', chunkIndex: 0, distance: 2 });

    queue.removeJob('a');

    expect(queue.size()).toBe(1);
    expect(queue.dequeueNext()?.jobId).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/SubtitlePriorityQueue.test.ts`
Expected: FAIL with "Cannot find module '../SubtitlePriorityQueue'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/SubtitlePriorityQueue.ts
export interface QueuedChunk {
  jobId: string;
  chunkIndex: number;
  distance: number;
}

// A linear-scan priority queue, not a heap: job queues hold at most a few
// hundred chunks (a long movie at 75s/chunk is ~150 chunks), so O(n) scans
// on dequeue/reprioritize are simple and fast enough, and avoid the extra
// bookkeeping a heap needs to support "update the priority of an existing
// item", which reprioritizeJob needs on every seek.
export class SubtitlePriorityQueue {
  private items: QueuedChunk[] = [];

  enqueue(item: QueuedChunk): void {
    this.items.push(item);
  }

  dequeueNext(): QueuedChunk | null {
    if (this.items.length === 0) return null;

    let bestIndex = 0;
    for (let i = 1; i < this.items.length; i += 1) {
      if (this.items[i].distance < this.items[bestIndex].distance) {
        bestIndex = i;
      }
    }

    const [item] = this.items.splice(bestIndex, 1);
    return item;
  }

  reprioritizeJob(jobId: string, distanceForChunk: (chunkIndex: number) => number): void {
    this.items = this.items.map((item) =>
      item.jobId === jobId ? { ...item, distance: distanceForChunk(item.chunkIndex) } : item
    );
  }

  removeJob(jobId: string): void {
    this.items = this.items.filter((item) => item.jobId !== jobId);
  }

  size(): number {
    return this.items.length;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/SubtitlePriorityQueue.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/SubtitlePriorityQueue.ts backend/src/services/subtitles/__tests__/SubtitlePriorityQueue.test.ts
git commit -m "feat(subtitles): add shared priority queue for chunk scheduling across jobs"
```

---

### Task 7: SubtitleJobManager

**Files:**
- Create: `backend/src/services/subtitles/SubtitleJobManager.ts`
- Test: `backend/src/services/subtitles/__tests__/SubtitleJobManager.test.ts`

**Interfaces:**
- Consumes: `planChunks` from Task 2, `SubtitlePriorityQueue` from Task 6.
- Produces:
  ```typescript
  export type SubtitleMode = 'full' | 'forced';
  export type ChunkStatus = 'pending' | 'processing' | 'done' | 'failed';
  export interface ChunkState { index: number; startSec: number; endSec: number; status: ChunkStatus; retries: number; translationFailed?: boolean }
  export interface SubtitleJob {
    id: string;
    targetId: string;
    mediaUrl: string;
    spokenLanguage: string;
    outputLanguage: string;
    mode: SubtitleMode;
    status: 'processing' | 'completed' | 'failed';
    error?: string;
    chunks: ChunkState[];
  }
  export class SubtitleJobManager {
    createJob(params: { targetId: string; mediaUrl: string; durationSec: number; spokenLanguage: string; outputLanguage: string; mode: SubtitleMode }): SubtitleJob;
    findJob(targetId: string, outputLanguage: string, mode: SubtitleMode): SubtitleJob | undefined;
    getJob(jobId: string): SubtitleJob | undefined;
    reprioritize(jobId: string, positionSec: number): void;
    markChunkProcessing(jobId: string, chunkIndex: number): void;
    markChunkDone(jobId: string, chunkIndex: number, translationFailed: boolean): void;
    markChunkFailed(jobId: string, chunkIndex: number): boolean; // returns true if chunk can still be retried
    retryChunk(jobId: string, chunkIndex: number): void;
    on(event: 'chunk-ready' | 'chunk-failed' | 'job-complete' | 'job-failed', listener: (payload: { jobId: string; chunkIndex?: number; error?: string }) => void): void;
  }
  export const subtitleJobManager: SubtitleJobManager;
  ```
  — consumed by routes (Task 11) and `SubtitleWorkerPool` (Task 9).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/SubtitleJobManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SubtitleJobManager } from '../SubtitleJobManager';

function baseParams(overrides: Partial<Parameters<SubtitleJobManager['createJob']>[0]> = {}) {
  return {
    targetId: 'movie-1',
    mediaUrl: 'http://example.com/movie.mp4',
    durationSec: 150,
    spokenLanguage: 'en',
    outputLanguage: 'pt',
    mode: 'full' as const,
    ...overrides,
  };
}

describe('SubtitleJobManager', () => {
  it('creates a job with chunks planned from duration and status "processing"', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob(baseParams());

    expect(job.status).toBe('processing');
    expect(job.chunks).toHaveLength(2);
    expect(job.chunks[0]).toMatchObject({ index: 0, status: 'pending', retries: 0 });
  });

  it('keys jobs by targetId + outputLanguage + mode, so two different language/mode requests for the same target do not collide', () => {
    const manager = new SubtitleJobManager();
    const jobFullPt = manager.createJob(baseParams({ outputLanguage: 'pt', mode: 'full' }));
    const jobForcedPt = manager.createJob(baseParams({ outputLanguage: 'pt', mode: 'forced' }));

    expect(jobFullPt.id).not.toBe(jobForcedPt.id);
    expect(manager.findJob('movie-1', 'pt', 'full')?.id).toBe(jobFullPt.id);
    expect(manager.findJob('movie-1', 'pt', 'forced')?.id).toBe(jobForcedPt.id);
  });

  it('returns the existing job instead of creating a duplicate for the same key', () => {
    const manager = new SubtitleJobManager();
    const first = manager.createJob(baseParams());
    const second = manager.createJob(baseParams());
    expect(second.id).toBe(first.id);
  });

  it('marks a chunk done, and marks the whole job completed once every chunk is done', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob(baseParams());
    const onComplete = vi.fn();
    manager.on('job-complete', onComplete);

    manager.markChunkDone(job.id, 0, false);
    expect(manager.getJob(job.id)?.status).toBe('processing');

    manager.markChunkDone(job.id, 1, false);
    expect(manager.getJob(job.id)?.status).toBe('completed');
    expect(onComplete).toHaveBeenCalledWith({ jobId: job.id });
  });

  it('retries a chunk up to 3 times before marking it failed, then allows manual retry after that', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob(baseParams());

    expect(manager.markChunkFailed(job.id, 0)).toBe(true); // retry 1
    expect(manager.markChunkFailed(job.id, 0)).toBe(true); // retry 2
    expect(manager.markChunkFailed(job.id, 0)).toBe(false); // retry 3 exhausted -> chunk is failed

    expect(manager.getJob(job.id)?.chunks[0].status).toBe('failed');

    manager.retryChunk(job.id, 0);
    expect(manager.getJob(job.id)?.chunks[0].status).toBe('pending');
  });

  it('reprioritizes pending chunks by distance from the given playback position without touching done chunks', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob(baseParams({ durationSec: 300 })); // 4 chunks of 75s
    manager.markChunkDone(job.id, 0, false);

    manager.reprioritize(job.id, 160); // inside chunk index 2 (150-225)

    const updated = manager.getJob(job.id)!;
    expect(updated.chunks[0].status).toBe('done');
    expect(updated.chunks.filter((c) => c.status === 'pending').map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it('does not crash when reprioritizing to a position beyond every planned chunk', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob(baseParams());
    expect(() => manager.reprioritize(job.id, 999999)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/SubtitleJobManager.test.ts`
Expected: FAIL with "Cannot find module '../SubtitleJobManager'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/SubtitleJobManager.ts
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { planChunks } from './ChunkPlanner';
import { SubtitlePriorityQueue } from './SubtitlePriorityQueue';

export type SubtitleMode = 'full' | 'forced';
export type ChunkStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface ChunkState {
  index: number;
  startSec: number;
  endSec: number;
  status: ChunkStatus;
  retries: number;
  translationFailed?: boolean;
}

export interface SubtitleJob {
  id: string;
  targetId: string;
  mediaUrl: string;
  spokenLanguage: string;
  outputLanguage: string;
  mode: SubtitleMode;
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  chunks: ChunkState[];
}

const MAX_CHUNK_RETRIES = 3;

function jobKey(targetId: string, outputLanguage: string, mode: SubtitleMode): string {
  return `${targetId}::${outputLanguage}::${mode}`;
}

export class SubtitleJobManager extends EventEmitter {
  private jobsById: Map<string, SubtitleJob> = new Map();
  private jobIdByKey: Map<string, string> = new Map();
  readonly queue = new SubtitlePriorityQueue();

  createJob(params: {
    targetId: string;
    mediaUrl: string;
    durationSec: number;
    spokenLanguage: string;
    outputLanguage: string;
    mode: SubtitleMode;
  }): SubtitleJob {
    const key = jobKey(params.targetId, params.outputLanguage, params.mode);
    const existingId = this.jobIdByKey.get(key);
    if (existingId) {
      return this.jobsById.get(existingId)!;
    }

    const chunks: ChunkState[] = planChunks(params.durationSec).map((c) => ({
      ...c,
      status: 'pending',
      retries: 0,
    }));

    const job: SubtitleJob = {
      id: uuidv4(),
      targetId: params.targetId,
      mediaUrl: params.mediaUrl,
      spokenLanguage: params.spokenLanguage,
      outputLanguage: params.outputLanguage,
      mode: params.mode,
      status: 'processing',
      chunks,
    };

    this.jobsById.set(job.id, job);
    this.jobIdByKey.set(key, job.id);

    for (const chunk of chunks) {
      this.queue.enqueue({ jobId: job.id, chunkIndex: chunk.index, distance: chunk.startSec });
    }

    return job;
  }

  findJob(targetId: string, outputLanguage: string, mode: SubtitleMode): SubtitleJob | undefined {
    const id = this.jobIdByKey.get(jobKey(targetId, outputLanguage, mode));
    return id ? this.jobsById.get(id) : undefined;
  }

  getJob(jobId: string): SubtitleJob | undefined {
    return this.jobsById.get(jobId);
  }

  reprioritize(jobId: string, positionSec: number): void {
    const job = this.jobsById.get(jobId);
    if (!job) return;

    this.queue.reprioritizeJob(jobId, (chunkIndex) => {
      const chunk = job.chunks[chunkIndex];
      if (!chunk) return Number.MAX_SAFE_INTEGER;
      if (positionSec < chunk.startSec) return chunk.startSec - positionSec;
      if (positionSec > chunk.endSec) return positionSec - chunk.endSec;
      return 0;
    });
  }

  markChunkProcessing(jobId: string, chunkIndex: number): void {
    const chunk = this.jobsById.get(jobId)?.chunks[chunkIndex];
    if (chunk) chunk.status = 'processing';
  }

  markChunkDone(jobId: string, chunkIndex: number, translationFailed: boolean): void {
    const job = this.jobsById.get(jobId);
    const chunk = job?.chunks[chunkIndex];
    if (!job || !chunk) return;

    chunk.status = 'done';
    chunk.translationFailed = translationFailed;
    this.emit('chunk-ready', { jobId, chunkIndex });

    if (job.chunks.every((c) => c.status === 'done')) {
      job.status = 'completed';
      this.emit('job-complete', { jobId });
    }
  }

  /** Returns true if the chunk goes back to "pending" for another attempt, false if it is now permanently "failed". */
  markChunkFailed(jobId: string, chunkIndex: number): boolean {
    const job = this.jobsById.get(jobId);
    const chunk = job?.chunks[chunkIndex];
    if (!job || !chunk) return false;

    chunk.retries += 1;
    if (chunk.retries < MAX_CHUNK_RETRIES) {
      chunk.status = 'pending';
      this.queue.enqueue({ jobId, chunkIndex, distance: chunk.startSec });
      return true;
    }

    chunk.status = 'failed';
    this.emit('chunk-failed', { jobId, chunkIndex });
    return false;
  }

  retryChunk(jobId: string, chunkIndex: number): void {
    const job = this.jobsById.get(jobId);
    const chunk = job?.chunks[chunkIndex];
    if (!job || !chunk) return;

    chunk.status = 'pending';
    chunk.retries = 0;
    this.queue.enqueue({ jobId, chunkIndex, distance: 0 });
  }
}

export const subtitleJobManager = new SubtitleJobManager();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/SubtitleJobManager.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/SubtitleJobManager.ts backend/src/services/subtitles/__tests__/SubtitleJobManager.test.ts
git commit -m "feat(subtitles): add SubtitleJobManager to replace the whole-file TranscriptionQueue"
```

---

### Task 8: subtitleChunkWorker (worker_threads entry point)

**Files:**
- Create: `backend/src/services/subtitles/subtitleChunkWorker.ts`
- Test: `backend/src/services/subtitles/__tests__/subtitleChunkWorker.test.ts`

**Interfaces:**
- Consumes: `detectLanguage` (Task 3), `translationService` (Task 4), `writeChunkVtt` / `VttCue` (Task 5).
- Produces: `export interface ChunkWorkerInput { mediaUrl: string; jobId: string; chunkIndex: number; startSec: number; endSec: number; spokenLanguage: string; outputLanguage: string; mode: 'full' | 'forced' }`, `export interface ChunkWorkerOutput { translationFailed: boolean }`, `export async function processChunk(input: ChunkWorkerInput): Promise<ChunkWorkerOutput>` (the pure logic, unit-testable) plus a `parentPort.on('message', ...)` wrapper that only runs when this file is loaded as an actual worker thread (`isMainThread === false`) — consumed by `SubtitleWorkerPool` (Task 9), which spawns this file as a `Worker`.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/subtitleChunkWorker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ffmpegChain = {
  noVideo: vi.fn().mockReturnThis(),
  audioChannels: vi.fn().mockReturnThis(),
  audioFrequency: vi.fn().mockReturnThis(),
  seekInput: vi.fn().mockReturnThis(),
  duration: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  run: vi.fn(),
};
vi.mock('fluent-ffmpeg', () => ({ default: vi.fn(() => ffmpegChain) }));

const whisperMock = vi.fn();
vi.mock('whisper-node', () => ({ whisper: whisperMock }));

const detectLanguageMock = vi.fn();
vi.mock('../languageDetector', () => ({ detectLanguage: detectLanguageMock }));

const translateMock = vi.fn();
vi.mock('../TranslationService', () => ({
  translationService: { translate: translateMock },
}));

let tempDir: string;
vi.mock('../subtitlesDir', () => ({
  get SUBTITLES_DIR() {
    return tempDir;
  },
}));

import { processChunk } from '../subtitleChunkWorker';
import { readChunkVtt } from '../VttStore';

describe('processChunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunkworker-test-'));
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') {
        ffmpegChain.run.mockImplementation(() => cb());
      }
      return ffmpegChain;
    });
  });

  it('full mode: transcribes and translates when detected language differs from output language', async () => {
    whisperMock.mockResolvedValue([{ start: 0, end: 2, speech: 'Hello there' }]);
    detectLanguageMock.mockReturnValue('en');
    translateMock.mockResolvedValue('Olá');

    const result = await processChunk({
      mediaUrl: 'http://example.com/movie.mp4',
      jobId: 'job1',
      chunkIndex: 0,
      startSec: 0,
      endSec: 75,
      spokenLanguage: 'en',
      outputLanguage: 'pt',
      mode: 'full',
    });

    expect(result.translationFailed).toBe(false);
    expect(translateMock).toHaveBeenCalledWith('Hello there', 'en', 'pt');
    const cues = readChunkVtt('job1', 0);
    expect(cues).toEqual([{ startSec: 0, endSec: 2, text: 'Olá' }]);
  });

  it('full mode: skips translation when detected language already matches output language', async () => {
    whisperMock.mockResolvedValue([{ start: 0, end: 2, speech: 'Olá' }]);
    detectLanguageMock.mockReturnValue('pt');

    await processChunk({
      mediaUrl: 'http://example.com/movie.mp4',
      jobId: 'job2',
      chunkIndex: 0,
      startSec: 0,
      endSec: 75,
      spokenLanguage: 'pt',
      outputLanguage: 'pt',
      mode: 'full',
    });

    expect(translateMock).not.toHaveBeenCalled();
    expect(readChunkVtt('job2', 0)).toEqual([{ startSec: 0, endSec: 2, text: 'Olá' }]);
  });

  it('forced mode: produces no cues when the chunk language matches the spoken language', async () => {
    whisperMock.mockResolvedValue([{ start: 0, end: 2, speech: 'Falando em português' }]);
    detectLanguageMock.mockReturnValue('pt');

    await processChunk({
      mediaUrl: 'http://example.com/dubbed-movie.mp4',
      jobId: 'job3',
      chunkIndex: 0,
      startSec: 0,
      endSec: 75,
      spokenLanguage: 'pt',
      outputLanguage: 'pt',
      mode: 'forced',
    });

    expect(translateMock).not.toHaveBeenCalled();
    expect(readChunkVtt('job3', 0)).toEqual([]);
  });

  it('forced mode: translates and keeps cues when the chunk language differs from the spoken language (e.g. an English song in a dubbed movie)', async () => {
    whisperMock.mockResolvedValue([{ start: 10, end: 14, speech: 'Here comes the sun' }]);
    detectLanguageMock.mockReturnValue('en');
    translateMock.mockResolvedValue('Aqui vem o sol');

    await processChunk({
      mediaUrl: 'http://example.com/dubbed-movie.mp4',
      jobId: 'job4',
      chunkIndex: 0,
      startSec: 0,
      endSec: 75,
      spokenLanguage: 'pt',
      outputLanguage: 'pt',
      mode: 'forced',
    });

    expect(translateMock).toHaveBeenCalledWith('Here comes the sun', 'en', 'pt');
    expect(readChunkVtt('job4', 0)).toEqual([{ startSec: 10, endSec: 14, text: 'Aqui vem o sol' }]);
  });

  it('forced mode: treats an undetermined ("und") detected language as matching the spoken language, producing no cue', async () => {
    whisperMock.mockResolvedValue([{ start: 0, end: 75, speech: '' }]);
    detectLanguageMock.mockReturnValue('und');

    await processChunk({
      mediaUrl: 'http://example.com/dubbed-movie.mp4',
      jobId: 'job5',
      chunkIndex: 0,
      startSec: 0,
      endSec: 75,
      spokenLanguage: 'pt',
      outputLanguage: 'pt',
      mode: 'forced',
    });

    expect(translateMock).not.toHaveBeenCalled();
    expect(readChunkVtt('job5', 0)).toEqual([]);
  });

  it('degrades gracefully when translation fails: keeps the original-language cue and reports translationFailed', async () => {
    whisperMock.mockResolvedValue([{ start: 0, end: 2, speech: 'Hello there' }]);
    detectLanguageMock.mockReturnValue('en');
    translateMock.mockRejectedValue(new Error('model unavailable'));

    const result = await processChunk({
      mediaUrl: 'http://example.com/movie.mp4',
      jobId: 'job6',
      chunkIndex: 0,
      startSec: 0,
      endSec: 75,
      spokenLanguage: 'en',
      outputLanguage: 'pt',
      mode: 'full',
    });

    expect(result.translationFailed).toBe(true);
    expect(readChunkVtt('job6', 0)).toEqual([{ startSec: 0, endSec: 2, text: 'Hello there' }]);
  });

  it('offsets cue timestamps by the chunk startSec so they are absolute within the full video', async () => {
    whisperMock.mockResolvedValue([{ start: 1, end: 3, speech: 'Second chunk speech' }]);
    detectLanguageMock.mockReturnValue('en');

    await processChunk({
      mediaUrl: 'http://example.com/movie.mp4',
      jobId: 'job7',
      chunkIndex: 1,
      startSec: 75,
      endSec: 150,
      spokenLanguage: 'en',
      outputLanguage: 'en',
      mode: 'full',
    });

    expect(readChunkVtt('job7', 1)).toEqual([{ startSec: 76, endSec: 78, text: 'Second chunk speech' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/subtitleChunkWorker.test.ts`
Expected: FAIL with "Cannot find module '../subtitleChunkWorker'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/subtitleChunkWorker.ts
import { isMainThread, parentPort } from 'worker_threads';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectLanguage } from './languageDetector';
import { translationService } from './TranslationService';
import { writeChunkVtt, type VttCue } from './VttStore';

export interface ChunkWorkerInput {
  mediaUrl: string;
  jobId: string;
  chunkIndex: number;
  startSec: number;
  endSec: number;
  spokenLanguage: string;
  outputLanguage: string;
  mode: 'full' | 'forced';
}

export interface ChunkWorkerOutput {
  translationFailed: boolean;
}

interface WhisperSegment {
  start: number | string;
  end: number | string;
  speech?: string;
  text?: string;
}

function toSeconds(value: number | string): number {
  if (typeof value === 'number') return value;
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

function extractAudioRange(mediaUrl: string, startSec: number, endSec: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(mediaUrl)
      .seekInput(startSec)
      .duration(endSec - startSec)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .output(outPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

export async function processChunk(input: ChunkWorkerInput): Promise<ChunkWorkerOutput> {
  const tempAudioPath = path.join(os.tmpdir(), `subtitle-chunk-${input.jobId}-${input.chunkIndex}.wav`);

  try {
    await extractAudioRange(input.mediaUrl, input.startSec, input.endSec, tempAudioPath);

    // @ts-ignore -- whisper-node lacks type definitions
    const whisperNode: any = await import('whisper-node');
    const segments: WhisperSegment[] = await whisperNode.whisper(tempAudioPath, {
      modelName: 'tiny',
      whisperOptions: { language: 'auto', outputInText: false, outputInVtt: false, word_timestamps: false },
    });

    const fullText = segments.map((s) => (s.speech || s.text || '').trim()).join(' ').trim();
    const detected = detectLanguage(fullText);
    const effectiveSpokenLanguage = detected === 'und' ? input.spokenLanguage : detected;

    let translationFailed = false;
    const cues: VttCue[] = [];

    const shouldEmitCue = input.mode === 'full' || effectiveSpokenLanguage !== input.spokenLanguage;

    if (shouldEmitCue) {
      for (const segment of segments) {
        const text = (segment.speech || segment.text || '').trim();
        if (!text) continue;

        let cueText = text;
        if (effectiveSpokenLanguage !== input.outputLanguage) {
          try {
            cueText = await translationService.translate(text, effectiveSpokenLanguage as any, input.outputLanguage as any);
          } catch {
            translationFailed = true;
          }
        }

        cues.push({
          startSec: input.startSec + toSeconds(segment.start),
          endSec: input.startSec + toSeconds(segment.end),
          text: cueText,
        });
      }
    }

    writeChunkVtt(input.jobId, input.chunkIndex, cues);
    return { translationFailed };
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      try {
        fs.unlinkSync(tempAudioPath);
      } catch {}
    }
  }
}

// Only wire up the worker_threads message protocol when this module is
// actually running as a worker (spawned by SubtitleWorkerPool) -- when
// imported directly by tests or other backend code on the main thread,
// isMainThread is true and this block is simply never reached.
if (!isMainThread && parentPort) {
  parentPort.on('message', async (input: ChunkWorkerInput) => {
    try {
      const result = await processChunk(input);
      parentPort!.postMessage({ ok: true, jobId: input.jobId, chunkIndex: input.chunkIndex, ...result });
    } catch (err: any) {
      parentPort!.postMessage({ ok: false, jobId: input.jobId, chunkIndex: input.chunkIndex, error: err?.message || String(err) });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/subtitleChunkWorker.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/subtitleChunkWorker.ts backend/src/services/subtitles/__tests__/subtitleChunkWorker.test.ts
git commit -m "feat(subtitles): add per-chunk worker pipeline (extract, transcribe, detect, translate)"
```

---

### Task 9: SubtitleWorkerPool

**Files:**
- Create: `backend/src/services/subtitles/SubtitleWorkerPool.ts`
- Test: `backend/src/services/subtitles/__tests__/SubtitleWorkerPool.test.ts`

**Interfaces:**
- Consumes: `subtitleJobManager` (Task 7), `getSubtitleWorkerPoolSize` (Task 1), `ChunkWorkerInput`/`ChunkWorkerOutput` types (Task 8).
- Produces: `export class SubtitleWorkerPool { start(): void; stop(): void }`, `export const subtitleWorkerPool: SubtitleWorkerPool` — started once from `backend/src/index.ts` (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/subtitles/__tests__/SubtitleWorkerPool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

class FakeWorker extends EventEmitter {
  terminate = vi.fn();
  postMessage = vi.fn();
}

const createdWorkers: FakeWorker[] = [];
vi.mock('worker_threads', () => ({
  Worker: vi.fn(() => {
    const w = new FakeWorker();
    createdWorkers.push(w);
    return w;
  }),
}));

import { SubtitleJobManager } from '../SubtitleJobManager';
import { SubtitleWorkerPool } from '../SubtitleWorkerPool';

describe('SubtitleWorkerPool', () => {
  beforeEach(() => {
    createdWorkers.length = 0;
  });

  it('spawns one Worker per configured pool size on start()', () => {
    const manager = new SubtitleJobManager();
    const pool = new SubtitleWorkerPool(manager, 2);
    pool.start();
    expect(createdWorkers).toHaveLength(2);
  });

  it('dispatches the next queued chunk to an idle worker as a postMessage', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob({
      targetId: 't1',
      mediaUrl: 'http://x/video.mp4',
      durationSec: 75,
      spokenLanguage: 'en',
      outputLanguage: 'en',
      mode: 'full',
    });

    const pool = new SubtitleWorkerPool(manager, 1);
    pool.start();

    expect(createdWorkers[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, chunkIndex: 0, mediaUrl: 'http://x/video.mp4' })
    );
    expect(manager.getJob(job.id)?.chunks[0].status).toBe('processing');
  });

  it('marks the chunk done and dispatches the next one when a worker reports success', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob({
      targetId: 't2',
      mediaUrl: 'http://x/video.mp4',
      durationSec: 150,
      spokenLanguage: 'en',
      outputLanguage: 'en',
      mode: 'full',
    });

    const pool = new SubtitleWorkerPool(manager, 1);
    pool.start();

    createdWorkers[0].emit('message', { ok: true, jobId: job.id, chunkIndex: 0, translationFailed: false });

    expect(manager.getJob(job.id)?.chunks[0].status).toBe('done');
    expect(createdWorkers[0].postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobId: job.id, chunkIndex: 1 })
    );
  });

  it('marks the chunk failed (for retry) when a worker reports an error', () => {
    const manager = new SubtitleJobManager();
    const job = manager.createJob({
      targetId: 't3',
      mediaUrl: 'http://x/video.mp4',
      durationSec: 75,
      spokenLanguage: 'en',
      outputLanguage: 'en',
      mode: 'full',
    });

    const pool = new SubtitleWorkerPool(manager, 1);
    pool.start();

    createdWorkers[0].emit('message', { ok: false, jobId: job.id, chunkIndex: 0, error: 'boom' });

    expect(manager.getJob(job.id)?.chunks[0].status).toBe('pending');
    expect(manager.getJob(job.id)?.chunks[0].retries).toBe(1);
  });

  it('terminates every worker on stop()', () => {
    const manager = new SubtitleJobManager();
    const pool = new SubtitleWorkerPool(manager, 2);
    pool.start();
    pool.stop();
    expect(createdWorkers[0].terminate).toHaveBeenCalled();
    expect(createdWorkers[1].terminate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/SubtitleWorkerPool.test.ts`
Expected: FAIL with "Cannot find module '../SubtitleWorkerPool'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/services/subtitles/SubtitleWorkerPool.ts
import { Worker } from 'worker_threads';
import path from 'path';
import type { SubtitleJobManager } from './SubtitleJobManager';
import { getSubtitleWorkerPoolSize } from './subtitleConfig';

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

interface WorkerResultMessage {
  ok: boolean;
  jobId: string;
  chunkIndex: number;
  translationFailed?: boolean;
  error?: string;
}

export class SubtitleWorkerPool {
  private slots: WorkerSlot[] = [];

  constructor(
    private readonly jobManager: SubtitleJobManager,
    private readonly poolSize: number = getSubtitleWorkerPoolSize()
  ) {}

  start(): void {
    for (let i = 0; i < this.poolSize; i += 1) {
      const worker = new Worker(path.join(__dirname, 'subtitleChunkWorker.js'));
      const slot: WorkerSlot = { worker, busy: false };
      worker.on('message', (message: WorkerResultMessage) => this.handleResult(slot, message));
      this.slots.push(slot);
    }
    this.dispatchToIdleWorkers();
  }

  stop(): void {
    for (const slot of this.slots) {
      slot.worker.terminate();
    }
    this.slots = [];
  }

  private handleResult(slot: WorkerSlot, message: WorkerResultMessage): void {
    if (message.ok) {
      this.jobManager.markChunkDone(message.jobId, message.chunkIndex, Boolean(message.translationFailed));
    } else {
      this.jobManager.markChunkFailed(message.jobId, message.chunkIndex);
    }
    slot.busy = false;
    this.dispatchToIdleWorkers();
  }

  private dispatchToIdleWorkers(): void {
    for (const slot of this.slots) {
      if (slot.busy) continue;

      const next = this.jobManager.queue.dequeueNext();
      if (!next) return;

      const job = this.jobManager.getJob(next.jobId);
      const chunk = job?.chunks[next.chunkIndex];
      if (!job || !chunk) continue;

      this.jobManager.markChunkProcessing(next.jobId, next.chunkIndex);
      slot.busy = true;
      slot.worker.postMessage({
        mediaUrl: job.mediaUrl,
        jobId: job.id,
        chunkIndex: chunk.index,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        spokenLanguage: job.spokenLanguage,
        outputLanguage: job.outputLanguage,
        mode: job.mode,
      });
    }
  }
}

export const subtitleWorkerPool = new SubtitleWorkerPool(
  (require('./SubtitleJobManager') as typeof import('./SubtitleJobManager')).subtitleJobManager
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/SubtitleWorkerPool.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/SubtitleWorkerPool.ts backend/src/services/subtitles/__tests__/SubtitleWorkerPool.test.ts
git commit -m "feat(subtitles): add worker_threads pool that drains the shared priority queue"
```

---

### Task 10: Wire pool startup, DB migration, and emit SSE from job events

**Files:**
- Create: `backend/src/db/migrations/20261014120000_add_subtitle_jobs.ts`
- Modify: `backend/src/index.ts` (start the pool and wire SSE emission)
- Test: `backend/src/db/migrations/__tests__/20261014120000_add_subtitle_jobs.test.ts`
- Test: `backend/src/services/subtitles/__tests__/subtitleJobSseWiring.test.ts`

**Interfaces:**
- Consumes: `sendSseEvent` from `backend/src/state/sseState.ts`, `subtitleJobManager` (Task 7), `subtitleWorkerPool` (Task 9).
- Produces: `export function wireSubtitleJobEvents(userId: number): void` in a new small file `backend/src/services/subtitles/subtitleSseWiring.ts`, called from the route that creates a job (Task 11) since that is where we know which `userId` owns the job.

- [ ] **Step 1: Write the failing migration test**

```typescript
// backend/src/db/migrations/__tests__/20261014120000_add_subtitle_jobs.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex, { type Knex } from 'knex';
import * as migration from '../20261014120000_add_subtitle_jobs';

describe('20261014120000_add_subtitle_jobs migration', () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await migration.up(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates a subtitle_jobs table with the expected columns', async () => {
    const hasTable = await db.schema.hasTable('subtitle_jobs');
    expect(hasTable).toBe(true);

    for (const column of ['id', 'target_id', 'spoken_language', 'output_language', 'mode', 'status', 'created_at']) {
      expect(await db.schema.hasColumn('subtitle_jobs', column)).toBe(true);
    }
  });

  it('down() drops the table', async () => {
    await migration.down(db);
    expect(await db.schema.hasTable('subtitle_jobs')).toBe(false);
    await migration.up(db); // restore for any later test in this file
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/db/migrations/__tests__/20261014120000_add_subtitle_jobs.test.ts`
Expected: FAIL with "Cannot find module '../20261014120000_add_subtitle_jobs'"

- [ ] **Step 3: Write the migration**

```typescript
// backend/src/db/migrations/20261014120000_add_subtitle_jobs.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('subtitle_jobs');
  if (!hasTable) {
    await knex.schema.createTable('subtitle_jobs', (table) => {
      table.string('id').primary();
      table.string('target_id').notNullable();
      table.string('spoken_language').notNullable();
      table.string('output_language').notNullable();
      table.string('mode').notNullable();
      table.string('status').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['target_id', 'output_language', 'mode']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('subtitle_jobs');
  if (hasTable) {
    await knex.schema.dropTable('subtitle_jobs');
  }
}
```

- [ ] **Step 4: Run migration test to verify it passes**

Run: `cd backend && npx vitest run src/db/migrations/__tests__/20261014120000_add_subtitle_jobs.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing SSE wiring test**

```typescript
// backend/src/services/subtitles/__tests__/subtitleJobSseWiring.test.ts
import { describe, it, expect, vi } from 'vitest';

const sendSseEventMock = vi.fn();
vi.mock('../../../state/sseState', () => ({ sendSseEvent: sendSseEventMock }));

import { SubtitleJobManager } from '../SubtitleJobManager';
import { wireSubtitleJobEvents } from '../subtitleSseWiring';

describe('wireSubtitleJobEvents', () => {
  it('forwards chunk-ready, chunk-failed and job-complete events to the given user over SSE', () => {
    const manager = new SubtitleJobManager();
    wireSubtitleJobEvents(manager, 42);

    manager.emit('chunk-ready', { jobId: 'job1', chunkIndex: 0 });
    manager.emit('chunk-failed', { jobId: 'job1', chunkIndex: 1 });
    manager.emit('job-complete', { jobId: 'job1' });

    expect(sendSseEventMock).toHaveBeenNthCalledWith(1, 42, 'subtitle-chunk-ready', { jobId: 'job1', chunkIndex: 0 });
    expect(sendSseEventMock).toHaveBeenNthCalledWith(2, 42, 'subtitle-chunk-failed', { jobId: 'job1', chunkIndex: 1 });
    expect(sendSseEventMock).toHaveBeenNthCalledWith(3, 42, 'subtitle-job-complete', { jobId: 'job1' });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/subtitleJobSseWiring.test.ts`
Expected: FAIL with "Cannot find module '../subtitleSseWiring'"

- [ ] **Step 7: Write minimal implementation**

```typescript
// backend/src/services/subtitles/subtitleSseWiring.ts
import type { SubtitleJobManager } from './SubtitleJobManager';
import { sendSseEvent } from '../../state/sseState';

export function wireSubtitleJobEvents(manager: SubtitleJobManager, userId: number): void {
  manager.on('chunk-ready', (payload) => sendSseEvent(userId, 'subtitle-chunk-ready', payload));
  manager.on('chunk-failed', (payload) => sendSseEvent(userId, 'subtitle-chunk-failed', payload));
  manager.on('job-complete', (payload) => sendSseEvent(userId, 'subtitle-job-complete', payload));
  manager.on('job-failed', (payload) => sendSseEvent(userId, 'subtitle-job-failed', payload));
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/subtitleJobSseWiring.test.ts`
Expected: PASS (1 test)

- [ ] **Step 9: Start the worker pool at server boot**

Find the block in `backend/src/index.ts` where other singleton services are started at boot (search for where `app.listen` is called, or where other `*.start()`/background loops are kicked off near server startup). Add, near that block:

```typescript
import { subtitleWorkerPool } from './services/subtitles/SubtitleWorkerPool';
```

and, in the startup function right before (or right after) `app.listen(...)`:

```typescript
subtitleWorkerPool.start();
```

- [ ] **Step 10: Run the full backend test suite to confirm nothing else broke**

Run: `cd backend && npm test`
Expected: PASS (all suites, including the new ones)

- [ ] **Step 11: Commit**

```bash
git add backend/src/db/migrations/20261014120000_add_subtitle_jobs.ts backend/src/db/migrations/__tests__/20261014120000_add_subtitle_jobs.test.ts backend/src/services/subtitles/subtitleSseWiring.ts backend/src/services/subtitles/__tests__/subtitleJobSseWiring.test.ts backend/src/index.ts
git commit -m "feat(subtitles): add subtitle_jobs migration, SSE wiring, and start the worker pool at boot"
```

---

### Task 11: Replace the subtitle routes in vod.ts

**Files:**
- Modify: `backend/src/routes/vod.ts:569-607` (replace the three existing subtitle/transcribe routes)
- Delete: `backend/src/services/transcriptionQueue.ts`
- Delete: `backend/src/services/__tests__/transcriptionQueue.test.ts`
- Delete: `backend/src/services/subtitles/ISubtitleProvider.ts`, `WhisperSubtitleProvider.ts`, `EmbeddedTrackSubtitleProvider.ts`, `NoSubtitleAvailableProvider.ts`, `subtitleProviderChain.ts` and their `__tests__` files (fully superseded by `subtitleChunkWorker.ts`; `ProviderChain.ts` itself stays, it is still used by `backend/src/services/thumbnails/`)
- Test: `backend/src/routes/__tests__/vod.subtitles.test.ts`

**Interfaces:**
- Consumes: `subtitleJobManager` (Task 7), `wireSubtitleJobEvents` (Task 10), `concatenateVtt` (Task 5), `db` from `backend/src/db/connection`, `parseDurationToSecs`/duration-probing helpers already imported in `vod.ts`.
- Produces: the five routes listed in the spec's API section, replacing the old three.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/__tests__/vod.subtitles.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.session = { userId: 7 };
    next();
  },
}));

const createJobMock = vi.fn();
const findJobMock = vi.fn();
const getJobMock = vi.fn();
const reprioritizeMock = vi.fn();
const retryChunkMock = vi.fn();
vi.mock('../../services/subtitles/SubtitleJobManager', () => ({
  subtitleJobManager: {
    createJob: createJobMock,
    findJob: findJobMock,
    getJob: getJobMock,
    reprioritize: reprioritizeMock,
    retryChunk: retryChunkMock,
  },
}));

vi.mock('../../services/subtitles/subtitleSseWiring', () => ({ wireSubtitleJobEvents: vi.fn() }));

const concatenateVttMock = vi.fn();
vi.mock('../../services/subtitles/VttStore', () => ({ concatenateVtt: concatenateVttMock }));

import { vodRouter } from '../vod';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', vodRouter);
  return app;
}

describe('subtitle job routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/vod/subtitles/jobs creates a job and returns its id', async () => {
    createJobMock.mockReturnValue({ id: 'job-123', chunks: [{}, {}] });

    const res = await request(buildApp())
      .post('/api/vod/subtitles/jobs')
      .send({ targetId: 't1', mediaUrl: 'http://x/video.mp4', durationSec: 150, spokenLanguage: 'en', outputLanguage: 'pt', mode: 'full' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobId: 'job-123' });
    expect(createJobMock).toHaveBeenCalledWith({
      targetId: 't1',
      mediaUrl: 'http://x/video.mp4',
      durationSec: 150,
      spokenLanguage: 'en',
      outputLanguage: 'pt',
      mode: 'full',
    });
  });

  it('POST /api/vod/subtitles/jobs returns 400 when a required field is missing', async () => {
    const res = await request(buildApp()).post('/api/vod/subtitles/jobs').send({ targetId: 't1' });
    expect(res.status).toBe(400);
  });

  it('POST /api/vod/subtitles/jobs/:jobId/position reprioritizes the job', async () => {
    const res = await request(buildApp()).post('/api/vod/subtitles/jobs/job-123/position').send({ positionSec: 42 });
    expect(res.status).toBe(200);
    expect(reprioritizeMock).toHaveBeenCalledWith('job-123', 42);
  });

  it('POST /api/vod/subtitles/jobs/:jobId/chunks/:chunkIndex/retry retries the chunk', async () => {
    const res = await request(buildApp()).post('/api/vod/subtitles/jobs/job-123/chunks/3/retry');
    expect(res.status).toBe(200);
    expect(retryChunkMock).toHaveBeenCalledWith('job-123', 3);
  });

  it('GET /api/vod/subtitles/jobs/:jobId/vtt returns the concatenated VTT for done chunks', async () => {
    getJobMock.mockReturnValue({
      id: 'job-123',
      chunks: [
        { index: 0, status: 'done' },
        { index: 1, status: 'pending' },
      ],
    });
    concatenateVttMock.mockReturnValue('WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nhi\n\n');

    const res = await request(buildApp()).get('/api/vod/subtitles/jobs/job-123/vtt');

    expect(res.status).toBe(200);
    expect(res.text).toContain('WEBVTT');
    expect(concatenateVttMock).toHaveBeenCalledWith('job-123', [0]);
  });

  it('GET /api/vod/subtitles/jobs/:jobId/vtt returns 404 for an unknown job', async () => {
    getJobMock.mockReturnValue(undefined);
    const res = await request(buildApp()).get('/api/vod/subtitles/jobs/unknown/vtt');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/routes/__tests__/vod.subtitles.test.ts`
Expected: FAIL (routes not implemented yet / old routes still present)

- [ ] **Step 3: Delete the superseded files**

```bash
cd backend
git rm src/services/transcriptionQueue.ts src/services/__tests__/transcriptionQueue.test.ts
git rm src/services/subtitles/ISubtitleProvider.ts src/services/subtitles/WhisperSubtitleProvider.ts src/services/subtitles/EmbeddedTrackSubtitleProvider.ts src/services/subtitles/NoSubtitleAvailableProvider.ts src/services/subtitles/subtitleProviderChain.ts
git rm src/services/subtitles/__tests__/WhisperSubtitleProvider.test.ts src/services/subtitles/__tests__/EmbeddedTrackSubtitleProvider.test.ts src/services/subtitles/__tests__/NoSubtitleAvailableProvider.test.ts
```

- [ ] **Step 4: Replace the routes**

In `backend/src/routes/vod.ts`, remove the `import { transcriptionQueue } from '../services/transcriptionQueue';` line (line 14) and the three routes at lines 569-607, replacing them with:

```typescript
import { subtitleJobManager } from '../services/subtitles/SubtitleJobManager';
import { wireSubtitleJobEvents } from '../services/subtitles/subtitleSseWiring';
import { concatenateVtt } from '../services/subtitles/VttStore';
import { detectLanguage } from '../services/subtitles/languageDetector';

vodRouter.post('/vod/subtitles/detect-language', requireAuth, async (req, res) => {
  const { targetId, mediaUrl } = req.body;
  if (!targetId || !mediaUrl) {
    return res.status(400).json({ error: 'Missing targetId or mediaUrl' });
  }

  const sourceUrl = resolveLocalMediaPath(mediaUrl);
  const { processChunk } = await import('../services/subtitles/subtitleChunkWorker');
  // A short probe chunk is enough for detectLanguage to work from real
  // transcribed text instead of guessing from silence; it is thrown away
  // (not persisted as job id "preview") once the UI reads the result.
  await processChunk({
    mediaUrl: sourceUrl,
    jobId: 'preview',
    chunkIndex: 0,
    startSec: 0,
    endSec: 10,
    spokenLanguage: 'en',
    outputLanguage: 'en',
    mode: 'full',
  });
  const { readChunkVtt } = await import('../services/subtitles/VttStore');
  const cues = readChunkVtt('preview', 0) || [];
  const detected = detectLanguage(cues.map((c) => c.text).join(' '));
  res.json({ detectedLanguage: detected === 'und' ? 'en' : detected });
});

vodRouter.post('/vod/subtitles/jobs', requireAuth, async (req, res) => {
  const { targetId, mediaUrl, durationSec, spokenLanguage, outputLanguage, mode } = req.body;
  if (!targetId || !mediaUrl || !durationSec || !spokenLanguage || !outputLanguage || !mode) {
    return res.status(400).json({ error: 'Missing required field' });
  }

  const sourceUrl = resolveLocalMediaPath(mediaUrl);
  const job = subtitleJobManager.createJob({ targetId, mediaUrl: sourceUrl, durationSec, spokenLanguage, outputLanguage, mode });
  wireSubtitleJobEvents(subtitleJobManager, req.session.userId as number);
  res.json({ jobId: job.id });
});

vodRouter.post('/vod/subtitles/jobs/:jobId/position', requireAuth, (req, res) => {
  const { positionSec } = req.body;
  subtitleJobManager.reprioritize(req.params.jobId, Number(positionSec) || 0);
  res.json({ success: true });
});

vodRouter.post('/vod/subtitles/jobs/:jobId/chunks/:chunkIndex/retry', requireAuth, (req, res) => {
  subtitleJobManager.retryChunk(req.params.jobId, Number(req.params.chunkIndex));
  res.json({ success: true });
});

vodRouter.get('/vod/subtitles/jobs/:jobId/vtt', requireAuth, (req, res) => {
  const job = subtitleJobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const doneChunkIndexes = job.chunks.filter((c) => c.status === 'done').map((c) => c.index);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/vtt');
  res.send(concatenateVtt(job.id, doneChunkIndexes));
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/routes/__tests__/vod.subtitles.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS — confirms removing `transcriptionQueue.ts` and the old subtitle providers did not break any other suite (e.g. check `backend/src/services/subtitles/__tests__/` has no leftover references)

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/vod.ts backend/src/routes/__tests__/vod.subtitles.test.ts
git commit -m "feat(subtitles): replace whole-file transcribe routes with chunked job API"
```

---

### Task 12: Frontend SSE hook

**Files:**
- Create: `frontend/src/hooks/useSse.ts`
- Test: `frontend/src/hooks/__tests__/useSse.test.ts`

**Interfaces:**
- Produces: `export function useSse(eventName: string, onEvent: (data: any) => void): void` — a hook that opens (and reuses, across callers in the same tab) one `EventSource` to `/api/events` and dispatches by event name. Consumed by the rewritten `useTranscriptionController` (Task 13).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/hooks/__tests__/useSse.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSse } from '../useSse';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(event: string, listener: (event: MessageEvent) => void) {
    this.listeners[event] = [...(this.listeners[event] || []), listener];
  }

  removeEventListener(event: string, listener: (event: MessageEvent) => void) {
    this.listeners[event] = (this.listeners[event] || []).filter((l) => l !== listener);
  }

  close() {
    this.closed = true;
  }

  emit(event: string, data: unknown) {
    for (const listener of this.listeners[event] || []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as any).EventSource = FakeEventSource;
});

afterEach(() => {
  delete (globalThis as any).EventSource;
});

describe('useSse', () => {
  it('opens a single EventSource to /api/events and parses JSON payloads for the given event name', () => {
    const onEvent = vi.fn();
    renderHook(() => useSse('subtitle-chunk-ready', onEvent));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/events');

    FakeEventSource.instances[0].emit('subtitle-chunk-ready', { jobId: 'job1', chunkIndex: 0 });
    expect(onEvent).toHaveBeenCalledWith({ jobId: 'job1', chunkIndex: 0 });
  });

  it('reuses the same EventSource across multiple hook instances instead of opening a new connection each time', () => {
    renderHook(() => useSse('subtitle-chunk-ready', vi.fn()));
    renderHook(() => useSse('subtitle-job-complete', vi.fn()));

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('removes its own listener on unmount without closing the shared connection', () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useSse('subtitle-chunk-ready', onEvent));
    unmount();

    FakeEventSource.instances[0].emit('subtitle-chunk-ready', { jobId: 'job1' });
    expect(onEvent).not.toHaveBeenCalled();
    expect(FakeEventSource.instances[0].closed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useSse.test.ts`
Expected: FAIL with "Cannot find module '../useSse'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/hooks/useSse.ts
import { useEffect } from 'react';

let sharedEventSource: EventSource | null = null;
let refCount = 0;

function getSharedEventSource(): EventSource {
  if (!sharedEventSource) {
    sharedEventSource = new EventSource('/api/events');
  }
  return sharedEventSource;
}

export function useSse(eventName: string, onEvent: (data: any) => void): void {
  useEffect(() => {
    const source = getSharedEventSource();
    refCount += 1;

    const listener = (event: MessageEvent) => {
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        onEvent(event.data);
      }
    };

    source.addEventListener(eventName, listener);

    return () => {
      source.removeEventListener(eventName, listener);
      refCount -= 1;
      if (refCount <= 0) {
        sharedEventSource?.close();
        sharedEventSource = null;
        refCount = 0;
      }
    };
  }, [eventName, onEvent]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useSse.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useSse.ts frontend/src/hooks/__tests__/useSse.test.ts
git commit -m "feat(player): add shared useSse hook for subscribing to the global SSE channel"
```

---

### Task 13: Rewrite types and useTranscriptionController

**Files:**
- Modify: `frontend/src/pages/player/types.ts` (add new types, keep `SubtitleTrackOption` as-is)
- Modify: `frontend/src/pages/player/controllers/useTranscriptionController.ts` (full rewrite)
- Test: `frontend/src/pages/player/controllers/__tests__/useTranscriptionController.test.ts` (new; there was no prior test file for this controller)

**Interfaces:**
- Consumes: `useSse` (Task 12), routes from Task 11 (`/api/vod/subtitles/detect-language`, `/api/vod/subtitles/jobs`, `/api/vod/subtitles/jobs/:jobId/position`, `/api/vod/subtitles/jobs/:jobId/chunks/:chunkIndex/retry`, `/api/vod/subtitles/jobs/:jobId/vtt`).
- Produces:
  ```typescript
  export type SubtitleMode = 'full' | 'forced';
  export interface SubtitleJobChunkState { index: number; status: 'pending' | 'processing' | 'done' | 'failed' }
  export interface SubtitleJobState { jobId: string; status: 'processing' | 'completed' | 'failed'; chunks: SubtitleJobChunkState[] }
  ```
  added to `types.ts`, plus from the controller:
  ```typescript
  export interface TranscriptionController {
    readonly subtitleJob: SubtitleJobState | null;
    readonly detectedLanguage: string | null;
    readonly detectLanguageForModal: () => Promise<void>;
    readonly startSubtitleJob: (spokenLanguage: string, outputLanguage: string, mode: SubtitleMode) => Promise<void>;
    readonly retryChunk: (chunkIndex: number) => Promise<void>;
    readonly reportPlaybackPosition: (positionSec: number) => void;
  }
  export function useTranscriptionController(...): TranscriptionController
  ```
  — consumed by `usePlayerController.ts` and the new `SubtitleGenerationModal` (Task 14).

- [ ] **Step 1: Add new types**

In `frontend/src/pages/player/types.ts`, replace the existing `TranscriptionStatus`/`TranscriptionJob` block (lines 43-55) with:

```typescript
export type SubtitleMode = 'full' | 'forced';

export interface SubtitleJobChunkState {
  readonly index: number;
  readonly status: 'pending' | 'processing' | 'done' | 'failed';
}

export interface SubtitleJobState {
  readonly jobId: string;
  readonly status: 'processing' | 'completed' | 'failed';
  readonly chunks: readonly SubtitleJobChunkState[];
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// frontend/src/pages/player/controllers/__tests__/useTranscriptionController.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createRef } from 'react';

const sseListeners: Record<string, (data: any) => void> = {};
vi.mock('../../../../hooks/useSse', () => ({
  useSse: (eventName: string, onEvent: (data: any) => void) => {
    sseListeners[eventName] = onEvent;
  },
}));

global.fetch = vi.fn();

import { useTranscriptionController } from '../useTranscriptionController';

function mockJsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

describe('useTranscriptionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(sseListeners)) delete sseListeners[key];
  });

  it('starts a subtitle job and attaches a <track> element once it completes', async () => {
    const videoRef = createRef<HTMLVideoElement>();
    (videoRef as any).current = document.createElement('video');
    const setSubtitleTracks = vi.fn();

    (global.fetch as any).mockReturnValueOnce(mockJsonResponse({ jobId: 'job-1' }));

    const { result } = renderHook(() =>
      useTranscriptionController('target-1', 'http://x/video.mp4', 150, true, videoRef, setSubtitleTracks)
    );

    await act(async () => {
      await result.current.startSubtitleJob('en', 'pt', 'full');
    });

    expect(result.current.subtitleJob).toEqual({ jobId: 'job-1', status: 'processing', chunks: [] });

    act(() => {
      sseListeners['subtitle-chunk-ready']({ jobId: 'job-1', chunkIndex: 0 });
    });
    expect(result.current.subtitleJob?.chunks).toEqual([{ index: 0, status: 'done' }]);

    const track = videoRef.current!.querySelector('track#custom-subtitle') as HTMLTrackElement;
    expect(track).not.toBeNull();
    expect(track.src).toContain('/api/vod/subtitles/jobs/job-1/vtt');

    act(() => {
      sseListeners['subtitle-job-complete']({ jobId: 'job-1' });
    });
    expect(result.current.subtitleJob?.status).toBe('completed');
  });

  it('reports a chunk-failed event in job state so the UI can offer a retry', async () => {
    const videoRef = createRef<HTMLVideoElement>();
    (videoRef as any).current = document.createElement('video');

    (global.fetch as any).mockReturnValueOnce(mockJsonResponse({ jobId: 'job-2' }));

    const { result } = renderHook(() =>
      useTranscriptionController('target-2', 'http://x/video.mp4', 150, true, videoRef, vi.fn())
    );

    await act(async () => {
      await result.current.startSubtitleJob('en', 'pt', 'full');
    });

    act(() => {
      sseListeners['subtitle-chunk-failed']({ jobId: 'job-2', chunkIndex: 0 });
    });

    expect(result.current.subtitleJob?.chunks).toEqual([{ index: 0, status: 'failed' }]);
  });

  it('calls the retry endpoint for a specific chunk', async () => {
    const videoRef = createRef<HTMLVideoElement>();
    (videoRef as any).current = document.createElement('video');

    (global.fetch as any)
      .mockReturnValueOnce(mockJsonResponse({ jobId: 'job-3' }))
      .mockReturnValueOnce(mockJsonResponse({ success: true }));

    const { result } = renderHook(() =>
      useTranscriptionController('target-3', 'http://x/video.mp4', 150, true, videoRef, vi.fn())
    );

    await act(async () => {
      await result.current.startSubtitleJob('en', 'pt', 'full');
    });

    await act(async () => {
      await result.current.retryChunk(2);
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/vod/subtitles/jobs/job-3/chunks/2/retry',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reports playback position to the backend for re-prioritization', async () => {
    const videoRef = createRef<HTMLVideoElement>();
    (videoRef as any).current = document.createElement('video');

    (global.fetch as any).mockReturnValueOnce(mockJsonResponse({ jobId: 'job-4' }));

    const { result } = renderHook(() =>
      useTranscriptionController('target-4', 'http://x/video.mp4', 150, true, videoRef, vi.fn())
    );

    await act(async () => {
      await result.current.startSubtitleJob('en', 'pt', 'full');
    });

    act(() => {
      result.current.reportPlaybackPosition(99);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        '/api/vod/subtitles/jobs/job-4/position',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ positionSec: 99 }) })
      );
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/player/controllers/__tests__/useTranscriptionController.test.ts`
Expected: FAIL (old controller shape doesn't match)

- [ ] **Step 4: Write minimal implementation**

```typescript
// frontend/src/pages/player/controllers/useTranscriptionController.ts
import { useState, useCallback, type RefObject } from 'react';
import { useSse } from '../../../hooks/useSse';
import type { SubtitleJobState, SubtitleMode, SubtitleTrackOption } from '../types';

export interface TranscriptionController {
  readonly subtitleJob: SubtitleJobState | null;
  readonly detectedLanguage: string | null;
  readonly detectLanguageForModal: () => Promise<void>;
  readonly startSubtitleJob: (spokenLanguage: string, outputLanguage: string, mode: SubtitleMode) => Promise<void>;
  readonly retryChunk: (chunkIndex: number) => Promise<void>;
  readonly reportPlaybackPosition: (positionSec: number) => void;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('viniplay_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useTranscriptionController(
  targetId: string | null,
  mediaUrl: string | undefined,
  durationSec: number | undefined,
  isVod: boolean,
  videoRef: RefObject<HTMLVideoElement | null>,
  setSubtitleTracks: (updater: (prev: readonly SubtitleTrackOption[]) => readonly SubtitleTrackOption[]) => void
): TranscriptionController {
  const [subtitleJob, setSubtitleJob] = useState<SubtitleJobState | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);

  const attachTrack = useCallback((jobId: string) => {
    const video = videoRef.current;
    if (!video) return;

    video.querySelector('track#custom-subtitle')?.remove();

    const track = document.createElement('track');
    track.id = 'custom-subtitle';
    track.kind = 'subtitles';
    track.label = 'Legenda IA';
    track.src = `/api/vod/subtitles/jobs/${jobId}/vtt?t=${Date.now()}`;
    track.default = true;
    video.appendChild(track);

    setSubtitleTracks((prev) => [...prev.filter((t) => t.id !== 'custom-ia'), { id: 'custom-ia', name: 'Legenda IA' }]);
  }, [videoRef, setSubtitleTracks]);

  const reloadTrack = useCallback((jobId: string) => {
    const video = videoRef.current;
    const track = video?.querySelector('track#custom-subtitle') as HTMLTrackElement | undefined;
    if (track) {
      track.src = `/api/vod/subtitles/jobs/${jobId}/vtt?t=${Date.now()}`;
    }
  }, [videoRef]);

  useSse('subtitle-chunk-ready', useCallback((data: { jobId: string; chunkIndex: number }) => {
    setSubtitleJob((prev) => {
      if (!prev || prev.jobId !== data.jobId) return prev;
      const chunks = upsertChunk(prev.chunks, data.chunkIndex, 'done');
      return { ...prev, chunks };
    });
    reloadTrack(data.jobId);
  }, [reloadTrack]));

  useSse('subtitle-chunk-failed', useCallback((data: { jobId: string; chunkIndex: number }) => {
    setSubtitleJob((prev) => {
      if (!prev || prev.jobId !== data.jobId) return prev;
      return { ...prev, chunks: upsertChunk(prev.chunks, data.chunkIndex, 'failed') };
    });
  }, []));

  useSse('subtitle-job-complete', useCallback((data: { jobId: string }) => {
    setSubtitleJob((prev) => (prev && prev.jobId === data.jobId ? { ...prev, status: 'completed' } : prev));
  }, []));

  useSse('subtitle-job-failed', useCallback((data: { jobId: string }) => {
    setSubtitleJob((prev) => (prev && prev.jobId === data.jobId ? { ...prev, status: 'failed' } : prev));
  }, []));

  const detectLanguageForModal = useCallback(async () => {
    if (!targetId || !mediaUrl) return;
    try {
      const res = await fetch('/api/vod/subtitles/detect-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ targetId, mediaUrl }),
      });
      if (!res.ok) return;
      const data: { detectedLanguage: string } = await res.json();
      setDetectedLanguage(data.detectedLanguage);
    } catch (e: unknown) {
      console.warn('[Subtitles] Failed to detect language', e);
    }
  }, [targetId, mediaUrl]);

  const startSubtitleJob = useCallback(async (spokenLanguage: string, outputLanguage: string, mode: SubtitleMode) => {
    if (!targetId || !mediaUrl || !durationSec) return;

    const res = await fetch('/api/vod/subtitles/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ targetId, mediaUrl, durationSec, spokenLanguage, outputLanguage, mode }),
    });
    if (!res.ok) return;

    const data: { jobId: string } = await res.json();
    setSubtitleJob({ jobId: data.jobId, status: 'processing', chunks: [] });
    attachTrack(data.jobId);
  }, [targetId, mediaUrl, durationSec, attachTrack]);

  const retryChunk = useCallback(async (chunkIndex: number) => {
    if (!subtitleJob) return;
    await fetch(`/api/vod/subtitles/jobs/${subtitleJob.jobId}/chunks/${chunkIndex}/retry`, {
      method: 'POST',
      headers: authHeaders(),
    });
  }, [subtitleJob]);

  const reportPlaybackPosition = useCallback((positionSec: number) => {
    if (!subtitleJob) return;
    void fetch(`/api/vod/subtitles/jobs/${subtitleJob.jobId}/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ positionSec }),
    });
  }, [subtitleJob]);

  return { subtitleJob, detectedLanguage, detectLanguageForModal, startSubtitleJob, retryChunk, reportPlaybackPosition };
}

function upsertChunk(
  chunks: readonly { index: number; status: 'pending' | 'processing' | 'done' | 'failed' }[],
  index: number,
  status: 'pending' | 'processing' | 'done' | 'failed'
) {
  const existing = chunks.findIndex((c) => c.index === index);
  if (existing === -1) return [...chunks, { index, status }];
  const copy = [...chunks];
  copy[existing] = { index, status };
  return copy;
}
```

Note: `isVod` is intentionally unused by the new logic itself (callers already gate on it before invoking `startSubtitleJob`); keep the parameter for call-site compatibility with `usePlayerController.ts` and prefix it `_isVod` if the linter flags unused parameters.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/player/controllers/__tests__/useTranscriptionController.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/player/types.ts frontend/src/pages/player/controllers/useTranscriptionController.ts frontend/src/pages/player/controllers/__tests__/useTranscriptionController.test.ts
git commit -m "feat(player): rewrite transcription controller for chunked, SSE-driven subtitle jobs"
```

---

### Task 14: Subtitle generation modal and PlayerPage wiring

**Files:**
- Create: `frontend/src/pages/player/components/SubtitleGenerationModal.tsx`
- Test: `frontend/src/pages/player/components/__tests__/SubtitleGenerationModal.test.tsx`
- Modify: `frontend/src/pages/player/usePlayerController.ts:212-220` (pass `durationSec`, expose modal open state + the new controller methods)
- Modify: `frontend/src/pages/player/PlayerPage.tsx:589-616` (replace the single button with one that opens the modal, render the modal, show per-chunk retry affordance)

**Interfaces:**
- Consumes: `TranscriptionController` from Task 13.
- Produces: `SubtitleGenerationModal` component props `{ isOpen: boolean; detectedLanguage: string | null; onDetectLanguage: () => void; onConfirm: (spokenLanguage: string, outputLanguage: string, mode: SubtitleMode) => void; onClose: () => void }`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/pages/player/components/__tests__/SubtitleGenerationModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubtitleGenerationModal } from '../SubtitleGenerationModal';

describe('SubtitleGenerationModal', () => {
  it('pre-fills the spoken language from the detected language and lets the user confirm', () => {
    const onConfirm = vi.fn();
    render(
      <SubtitleGenerationModal
        isOpen
        detectedLanguage="en"
        onDetectLanguage={vi.fn()}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/idioma falado/i)).toHaveValue('en');

    fireEvent.change(screen.getByLabelText(/legenda em/i), { target: { value: 'pt' } });
    fireEvent.click(screen.getByRole('button', { name: /gerar/i }));

    expect(onConfirm).toHaveBeenCalledWith('en', 'pt', 'full');
  });

  it('submits mode "forced" when the forced-subtitles toggle is checked', () => {
    const onConfirm = vi.fn();
    render(
      <SubtitleGenerationModal
        isOpen
        detectedLanguage="pt"
        onDetectLanguage={vi.fn()}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText(/apenas trechos em outro idioma/i));
    fireEvent.click(screen.getByRole('button', { name: /gerar/i }));

    expect(onConfirm).toHaveBeenCalledWith('pt', 'pt', 'forced');
  });

  it('calls onDetectLanguage once when opened', () => {
    const onDetectLanguage = vi.fn();
    render(
      <SubtitleGenerationModal
        isOpen
        detectedLanguage={null}
        onDetectLanguage={onDetectLanguage}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(onDetectLanguage).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SubtitleGenerationModal isOpen={false} detectedLanguage={null} onDetectLanguage={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/player/components/__tests__/SubtitleGenerationModal.test.tsx`
Expected: FAIL with "Cannot find module '../SubtitleGenerationModal'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/pages/player/components/SubtitleGenerationModal.tsx
import { useEffect, useState } from 'react';
import type { SubtitleMode } from '../types';

const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'zh', label: 'Chinês' },
  { code: 'ru', label: 'Russo' },
];

export interface SubtitleGenerationModalProps {
  readonly isOpen: boolean;
  readonly detectedLanguage: string | null;
  readonly onDetectLanguage: () => void;
  readonly onConfirm: (spokenLanguage: string, outputLanguage: string, mode: SubtitleMode) => void;
  readonly onClose: () => void;
}

export function SubtitleGenerationModal({ isOpen, detectedLanguage, onDetectLanguage, onConfirm, onClose }: SubtitleGenerationModalProps) {
  const [spokenLanguage, setSpokenLanguage] = useState('pt');
  const [outputLanguage, setOutputLanguage] = useState('pt');
  const [forcedOnly, setForcedOnly] = useState(false);

  useEffect(() => {
    if (isOpen) onDetectLanguage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (detectedLanguage) setSpokenLanguage(detectedLanguage);
  }, [detectedLanguage]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 border border-white/15 rounded-2xl p-6 w-96 text-white flex flex-col gap-4">
        <h3 className="text-lg font-bold">Gerar legenda com IA</h3>

        <label className="flex flex-col gap-1 text-sm">
          Idioma falado no vídeo
          <select
            aria-label="Idioma falado no vídeo"
            value={spokenLanguage}
            onChange={(e) => setSpokenLanguage(e.target.value)}
            className="bg-gray-800 rounded px-2 py-1"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Legenda em
          <select
            aria-label="Legenda em"
            value={outputLanguage}
            onChange={(e) => setOutputLanguage(e.target.value)}
            className="bg-gray-800 rounded px-2 py-1"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Apenas trechos em outro idioma"
            checked={forcedOnly}
            onChange={(e) => setForcedOnly(e.target.checked)}
          />
          Legenda apenas em trechos em outro idioma (ex: música em outro idioma num filme dublado)
        </label>

        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-white/10 hover:bg-white/20">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(spokenLanguage, outputLanguage, forcedOnly ? 'forced' : 'full')}
            className="px-3 py-1.5 text-sm font-bold rounded bg-indigo-600 hover:bg-indigo-500"
          >
            Gerar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/player/components/__tests__/SubtitleGenerationModal.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the modal into usePlayerController**

In `frontend/src/pages/player/usePlayerController.ts`, replace the block at lines 212-220 with:

```typescript
  // Transcription controller
  const progressItemId = vodCtrl.getProgressItemId();
  const [isSubtitleModalOpen, setIsSubtitleModalOpen] = useState(false);
  const transcriptionCtrl = useTranscriptionController(
    progressItemId || null,
    selectedChannel?.url,
    shortcutsCtrl.duration,
    Boolean(selectedChannel?.isVod),
    videoRef,
    tracksCtrl.setSubtitleTracks
  );
```

Find the returned `actions`/state object further down (search for `startTranscription: transcriptionCtrl.startTranscription,` at line 466) and replace that line with:

```typescript
      isSubtitleModalOpen,
      openSubtitleModal: () => setIsSubtitleModalOpen(true),
      closeSubtitleModal: () => setIsSubtitleModalOpen(false),
      detectedLanguage: transcriptionCtrl.detectedLanguage,
      detectLanguageForModal: transcriptionCtrl.detectLanguageForModal,
      startSubtitleJob: transcriptionCtrl.startSubtitleJob,
      retryChunk: transcriptionCtrl.retryChunk,
```

and replace every other reference to `transcriptionJob`/`transcriptionCtrl.transcriptionJob` in this file with `transcriptionCtrl.subtitleJob` (search the file for `transcriptionJob` to find them all — there is also a line exposing it as player state, e.g. `readonly transcriptionJob: TranscriptionJob | null;` in the state interface, which becomes `readonly subtitleJob: SubtitleJobState | null;`).

Also add a position-reporting effect right after the controller is created:

```typescript
  useEffect(() => {
    if (!selectedChannel?.isVod || !transcriptionCtrl.subtitleJob) return;
    const interval = setInterval(() => {
      transcriptionCtrl.reportPlaybackPosition(shortcutsCtrl.currentTime);
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedChannel?.isVod, transcriptionCtrl, shortcutsCtrl.currentTime]);
```

- [ ] **Step 6: Replace the button and render the modal in PlayerPage**

In `frontend/src/pages/player/PlayerPage.tsx`, replace the button block at lines 594-615 with:

```tsx
                          <button
                            type="button"
                            onClick={actions.openSubtitleModal}
                            disabled={Boolean(state.subtitleJob && state.subtitleJob.status === 'processing')}
                            className="px-2 py-1 text-[10px] font-bold rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            {state.subtitleJob
                              ? state.subtitleJob.status === 'processing'
                                ? 'Gerando...'
                                : state.subtitleJob.status === 'completed'
                                ? 'IA Concluída'
                                : 'Tentar Novamente'
                              : 'Gerar via IA'}
                          </button>
```

Then, near the end of the component's JSX (alongside other top-level modals rendered in this file), add:

```tsx
      <SubtitleGenerationModal
        isOpen={state.isSubtitleModalOpen}
        detectedLanguage={state.detectedLanguage}
        onDetectLanguage={actions.detectLanguageForModal}
        onConfirm={(spoken, output, mode) => {
          void actions.startSubtitleJob(spoken, output, mode);
          actions.closeSubtitleModal();
        }}
        onClose={actions.closeSubtitleModal}
      />
```

and add the import at the top of the file:

```typescript
import { SubtitleGenerationModal } from './components/SubtitleGenerationModal';
```

- [ ] **Step 7: Run the frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — confirms `PlayerPage.test.tsx` and any other test referencing the old `transcriptionJob`/`startTranscription` shape has been updated consistently; fix any remaining references the search in Step 5 missed.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/player/components/SubtitleGenerationModal.tsx frontend/src/pages/player/components/__tests__/SubtitleGenerationModal.test.tsx frontend/src/pages/player/usePlayerController.ts frontend/src/pages/player/PlayerPage.tsx
git commit -m "feat(player): add subtitle generation modal (language + forced-mode picker)"
```

---

### Task 15: Cast sender relay

**Files:**
- Modify: `frontend/src/components/cast/CastProvider.tsx` (add a custom message namespace and a relay from the global SSE channel while casting)
- Test: `frontend/src/components/cast/__tests__/CastProvider.subtitles.test.tsx`

**Interfaces:**
- Consumes: `useSse` (Task 12).
- Produces: adds `sendSubtitleEvent: (eventName: string, data: unknown) => void` to the `CastContextType` (exported from `useCast()`), used by nothing else in this plan directly — the relay itself listens to SSE internally so no other file needs to call it, but exposing it keeps the namespace constant colocated with the one file that owns the Cast session and makes the behavior independently testable.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/components/cast/__tests__/CastProvider.subtitles.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import React from 'react';

const sseListeners: Record<string, (data: any) => void> = {};
vi.mock('../../../hooks/useSse', () => ({
  useSse: (eventName: string, onEvent: (data: any) => void) => {
    sseListeners[eventName] = onEvent;
  },
}));

vi.mock('../../../api/guide', () => ({ useConfig: () => ({ data: { settings: {} } }) }));
vi.mock('../../../api/cast', () => ({ generateCastToken: vi.fn(), stopCastStreamOnServer: vi.fn() }));
vi.mock('../../../api/vod', () => ({ probeVodDuration: vi.fn() }));

import { CastProvider, useCast } from '../CastProvider';

function wrapper({ children }: { children: React.ReactNode }) {
  return <CastProvider>{children}</CastProvider>;
}

describe('CastProvider subtitle relay', () => {
  beforeEach(() => {
    for (const key of Object.keys(sseListeners)) delete sseListeners[key];
  });

  it('does not throw when a subtitle SSE event arrives with no active Cast session', () => {
    renderHook(() => useCast(), { wrapper });

    expect(() => {
      act(() => {
        sseListeners['subtitle-chunk-ready']?.({ jobId: 'job-1', chunkIndex: 0 });
      });
    }).not.toThrow();
  });
});
```

Note: the scenario of actually relaying a message to a live Cast session is not covered by an automated test here — `CastProvider`'s real session is set deep inside the Cast SDK's own session-listener callback, which is impractical to trigger from a unit test without inventing an internal test-only API that does not match the component's real shape. That relay call site (`session.sendMessage(SUBTITLE_MESSAGE_NAMESPACE, ...)` in Step 3 below) is instead verified by code review and by the manual Cast verification in Task 16, per the project's Cast-compatibility rule in `CLAUDE.md`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/cast/__tests__/CastProvider.subtitles.test.tsx`
Expected: FAIL (no subtitle relay wired up yet; `useSse` import does not exist in `CastProvider.tsx`)

- [ ] **Step 3: Add the relay**

In `frontend/src/components/cast/CastProvider.tsx`, add near the top (after the existing `const APPLICATION_ID = 'CC1AD845';` / `CAST_MEDIA_PORT` constants):

```typescript
const SUBTITLE_MESSAGE_NAMESPACE = 'urn:x-cast:com.viniplay.subtitles';
```

Add the import at the top of the file:

```typescript
import { useSse } from '../../hooks/useSse';
```

Inside the `CastProvider` component body, after `castSessionRef` is declared (near line 79), add:

```typescript
  const sendSubtitleEvent = useCallback((eventName: string, data: Record<string, unknown>) => {
    const session = castSessionRef.current;
    if (!session) return;
    try {
      session.sendMessage(SUBTITLE_MESSAGE_NAMESPACE, { type: eventName, ...data });
    } catch (e) {
      console.warn('[Cast] Failed to relay subtitle event', e);
    }
  }, []);

  useSse('subtitle-chunk-ready', useCallback((data: { jobId: string; chunkIndex: number }) => {
    sendSubtitleEvent('subtitle-chunk-ready', data);
  }, [sendSubtitleEvent]));

  useSse('subtitle-job-complete', useCallback((data: { jobId: string }) => {
    sendSubtitleEvent('subtitle-job-complete', data);
  }, [sendSubtitleEvent]));
```

Add `sendSubtitleEvent` to the object passed to `CastContext.Provider` (find the existing provider value object, which lists `isAvailable`, `isCasting`, etc., and add `sendSubtitleEvent,` alongside them) and to the `CastContextType` interface (add `sendSubtitleEvent: (eventName: string, data: Record<string, unknown>) => void;`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/cast/__tests__/CastProvider.subtitles.test.tsx`
Expected: PASS (1 test — confirms the Review Focus scenario "Cast session disconnects / no active session" does not crash)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cast/CastProvider.tsx frontend/src/components/cast/__tests__/CastProvider.subtitles.test.tsx
git commit -m "feat(cast): relay subtitle job SSE events to the Cast receiver over a custom message channel"
```

---

### Task 16: Cast receiver subtitle track reload

**Files:**
- Modify: `cast-receiver/receiver.js` (listen for the custom namespace, reload the active text track)

**Interfaces:**
- Consumes: messages sent by `sendSubtitleEvent` (Task 15) on namespace `urn:x-cast:com.viniplay.subtitles`.
- Produces: no new exported interface (this is a standalone static receiver app, not covered by the backend/frontend test runners) — verified manually per the Review Focus item and the project's Cast-compatibility rule in `CLAUDE.md`.

- [ ] **Step 1: Add the custom message listener**

In `cast-receiver/receiver.js`, after section "3. Message Interceptors" and before "4. Lifecycle & Player Event Listeners", add:

```javascript
// 3b. Subtitle job relay: the sender forwards subtitle-chunk-ready /
// subtitle-job-complete SSE events it receives from the backend over this
// custom namespace, since the receiver has no direct connection to the
// backend's SSE endpoint itself.
const SUBTITLE_MESSAGE_NAMESPACE = 'urn:x-cast:com.viniplay.subtitles';

context.addCustomMessageListener(SUBTITLE_MESSAGE_NAMESPACE, (customEvent) => {
  const data = customEvent.data || {};
  console.log('[ViniPlay Receiver] Subtitle event received:', data.type);

  if (data.type === 'subtitle-chunk-ready' || data.type === 'subtitle-job-complete') {
    reloadActiveSubtitleTrack();
  }
});

function reloadActiveSubtitleTrack() {
  const mediaStatus = playerManager.getMediaInformation && playerManager.getMediaInformation();
  const tracks = mediaStatus && mediaStatus.tracks ? mediaStatus.tracks : [];
  const subtitleTrack = tracks.find((t) => t.type === cast.framework.messages.TrackType.TEXT);
  if (!subtitleTrack) return;

  // The browser's VTT fetch is cached against the track's current content
  // id/URL; toggling the active track off and back on via editTracksInfo is
  // the documented way to make the receiver's underlying media element
  // re-fetch that URL, which is how the concatenated VTT (now with more
  // cues than last time) gets picked up without a full reload of playback.
  const disableRequest = new cast.framework.messages.EditTracksInfoRequestData();
  disableRequest.activeTrackIds = [];

  const enableRequest = new cast.framework.messages.EditTracksInfoRequestData();
  enableRequest.activeTrackIds = [subtitleTrack.trackId];

  playerManager.editTracksInfo(disableRequest, () => {
    playerManager.editTracksInfo(enableRequest, () => {
      console.log('[ViniPlay Receiver] Subtitle track reloaded.');
    }, (err) => console.error('[ViniPlay Receiver] Failed to re-enable subtitle track:', err));
  }, (err) => console.error('[ViniPlay Receiver] Failed to disable subtitle track:', err));
}
```

- [ ] **Step 2: Manual verification on a real or virtual Cast device**

This file has no automated test harness (it is a static receiver app loaded by actual Cast hardware/the Chrome Cast simulator, not by the backend/frontend Vitest suites). Per the project's Cast-compatibility rule in `CLAUDE.md`, verify manually before considering this task done:

1. Deploy `cast-receiver/` to wherever it is currently hosted for this project (check `cast-receiver/README.md` for the existing deployment step).
2. Cast a VOD item to a real Chromecast (or the Cast "Styled Media Receiver" test tool pointed at the custom receiver's app ID).
3. From the sender, open the subtitle modal and generate a subtitle job for that title.
4. Confirm captions appear on the TV incrementally as chunks complete (not only once the whole job finishes), by watching the receiver's remote debugger console (`chrome://inspect/#devices` on the Chromecast) for the `[ViniPlay Receiver] Subtitle track reloaded.` log line.
5. Record the result (pass/fail + any console errors) in the PR description.

- [ ] **Step 3: Commit**

```bash
git add cast-receiver/receiver.js
git commit -m "feat(cast): reload the receiver's subtitle track as new chunks arrive"
```

---

### Task 17: End-to-end integration test and cleanup pass

**Files:**
- Create: `backend/src/services/subtitles/__tests__/subtitlePipeline.integration.test.ts`
- Modify: `backend/vitest.integration.config.ts` only if it does not already include `src/services/subtitles/**/*.integration.test.ts` (check the existing include pattern first)

**Interfaces:**
- Consumes: `SubtitleJobManager` (Task 7), `SubtitleWorkerPool` (Task 9), with `fluent-ffmpeg`/`whisper-node` mocked (a real integration test would need the `tiny` Whisper model file and a real media fixture, which is out of scope for CI — this test integrates the in-process components with each other, not with the real Whisper binary).

- [ ] **Step 1: Write the integration test**

```typescript
// backend/src/services/subtitles/__tests__/subtitlePipeline.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const ffmpegChain = {
  seekInput: vi.fn().mockReturnThis(),
  duration: vi.fn().mockReturnThis(),
  noVideo: vi.fn().mockReturnThis(),
  audioChannels: vi.fn().mockReturnThis(),
  audioFrequency: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  run: vi.fn(),
};
vi.mock('fluent-ffmpeg', () => ({ default: vi.fn(() => ffmpegChain) }));

const whisperMock = vi.fn();
vi.mock('whisper-node', () => ({ whisper: whisperMock }));

class FakeWorker extends EventEmitter {
  terminate = vi.fn();
  postMessage = vi.fn((input: any) => {
    // Runs the real processChunk logic synchronously in-process, standing in
    // for the separate worker_thread this would run in production -- this
    // test is about SubtitleJobManager + SubtitleWorkerPool wiring, not
    // about worker_threads' own message-passing, which Task 9's unit test
    // already covers with a fully fake Worker.
    import('../subtitleChunkWorker').then(async ({ processChunk }) => {
      try {
        const result = await processChunk(input);
        this.emit('message', { ok: true, jobId: input.jobId, chunkIndex: input.chunkIndex, ...result });
      } catch (err: any) {
        this.emit('message', { ok: false, jobId: input.jobId, chunkIndex: input.chunkIndex, error: err.message });
      }
    });
  });
}
vi.mock('worker_threads', () => ({ Worker: vi.fn(() => new FakeWorker()) }));

import { SubtitleJobManager } from '../SubtitleJobManager';
import { SubtitleWorkerPool } from '../SubtitleWorkerPool';

describe('subtitle pipeline integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') ffmpegChain.run.mockImplementation(() => cb());
      return ffmpegChain;
    });
  });

  it('processes every chunk of a job end to end and marks it completed', async () => {
    whisperMock.mockResolvedValue([{ start: 0, end: 2, speech: 'Hello there' }]);

    const manager = new SubtitleJobManager();
    const pool = new SubtitleWorkerPool(manager, 1);

    const job = manager.createJob({
      targetId: 'movie-int',
      mediaUrl: 'http://example.com/movie.mp4',
      durationSec: 150,
      spokenLanguage: 'en',
      outputLanguage: 'en',
      mode: 'full',
    });

    pool.start();

    await vi.waitFor(() => {
      expect(manager.getJob(job.id)?.status).toBe('completed');
    });

    expect(manager.getJob(job.id)?.chunks.every((c) => c.status === 'done')).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm the integration config picks up this file**

Run: `cd backend && cat vitest.integration.config.ts`
If its `include` pattern does not match `src/services/subtitles/__tests__/*.integration.test.ts` (e.g. it only matches a different suffix or directory), add this path to the pattern, following whatever convention the existing config already uses.

- [ ] **Step 3: Run the integration test**

Run: `cd backend && npm run test:integration`
Expected: PASS

- [ ] **Step 4: Run the full backend and frontend suites one more time**

Run: `cd backend && npm test && cd ../frontend && npm test`
Expected: PASS — final confirmation that the whole-file `TranscriptionQueue` removal (Task 11) and every subsequent change left both suites green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/__tests__/subtitlePipeline.integration.test.ts backend/vitest.integration.config.ts
git commit -m "test(subtitles): add end-to-end integration test covering job creation through completion"
```

# Subtitle/Thumbnail Provider Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `backend/src/services/transcriptionQueue.ts`'s single hard-coded
Whisper call with a generic, ordered `ProviderChain` that tries local Whisper
transcription first, falls back to an embedded subtitle track extracted via
ffmpeg, and finally resolves to "no subtitle available" instead of failing
outright — retrying each provider once on a thrown error before moving to the
next. Add the equivalent for thumbnails (`ThumbnailProvider` chain: ffmpeg
frame-grab first, "no thumbnail available" fallback), a new capability the
backend does not have today, exposed through a new `GET /api/vod/thumbnail/:id`
route.

**Architecture:** `backend/src/services/mediaIntelligence/ProviderChain.ts`
holds one generic, reusable chain class — `ProviderChain<TRequest, TResult>`
— parameterized by a list of `ChainableProvider<TRequest, TResult>` and a
`succeeds(result)` predicate. It is not subtitle- or thumbnail-specific; both
`backend/src/services/subtitles/` and `backend/src/services/thumbnails/`
build their own chain instance from it. This is the same "small interface,
swappable implementations" shape as `IConnectionHub`/`IStreamHistoryRepository`
from Phases 3 and 5.

`backend/src/services/subtitles/WhisperSubtitleProvider.ts` receives the
*exact* existing audio-extraction + whisper-node + VTT-generation logic
moved verbatim out of `transcriptionQueue.ts` (a pure extraction, not a
rewrite — this is the "local AI" leg of the chain).
`backend/src/services/subtitles/EmbeddedTrackSubtitleProvider.ts` is new: it
probes the media with `ffprobe` for an embedded subtitle stream and extracts
it to VTT with ffmpeg if one exists.
`backend/src/services/subtitles/NoSubtitleAvailableProvider.ts` is the
terminal, never-throwing fallback every chain needs so a media file with no
usable subtitle source degrades to "unavailable" instead of an unhandled
rejection. `transcriptionQueue.ts` keeps its existing job-queue/status
machinery (queued → extracting_audio → transcribing → completed/failed) —
only the body of what runs during a job is replaced with a call to the
`ProviderChain`. The frontend's `PlayerPage.tsx`/`useTranscriptionController.ts`
distinguish `'extracting_audio'` from `'transcribing'` in their UI text, so
`SubtitleRequest` carries an optional `onProgress` callback the Whisper
provider uses to report that same two-phase status back up — this is a hard
behavior-preservation requirement, not a new feature.

`backend/src/services/thumbnails/` mirrors the same shape for thumbnails:
`FfmpegFrameGrabThumbnailProvider` (grabs one frame via ffmpeg, already a
project dependency) and `NoThumbnailAvailableProvider`, wired together by
`ThumbnailService`, which also owns a simple on-disk cache (skip
regeneration if the file already exists) under the new `THUMBNAILS_DIR`
(added to `backend/src/config/paths.ts`, following the existing
`DATA_DIR`-relative convention every other data directory in that file
already uses). `backend/src/routes/vod.ts` gets one new route,
`GET /api/vod/thumbnail/:id`, following the exact typed-error convention
(`ValidationError`/`NotFoundError` + `next(error)`) Phase 1 established and
`stream.ts` already demonstrates.

**Tech Stack:** TypeScript, Vitest, fluent-ffmpeg and whisper-node (both
already dependencies — no new packages).

**Spec:** N/A — derived directly from the architecture review in this
conversation ("planejamento para adicionar legendas, criar legendas,
thumbnail... com IA local, retry, fallbacks") and the roadmap's Phase 6
description. See roadmap: `docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`.

**Scope note:** An external subtitle-API provider and a full granular
retry/logging config file are intentionally *not* built in this plan — the
`ProviderChain`'s constructor already accepts an ordered provider list and a
`retriesPerProvider` option, so adding an `ExternalApiSubtitleProvider` later
is a matter of writing one class and inserting it into the array in
`subtitleProviderChain.ts`, with no interface changes. Building it now would
require an API key this project has none configured for, and external-key
handling deserves its own plan. This keeps Phase 6 the same size as prior
phases: the generic foundation plus one full reference chain per concern.

## Global Constraints

- `WhisperSubtitleProvider`'s transcription behavior (model name `"tiny"`,
  `modelPath` via `resolveFromRepoRoot('models/ggml-tiny.bin')`, whisper
  options, VTT generation format, temp-audio cleanup) is preserved verbatim
  from `transcriptionQueue.ts` — a pure code move, not a rewrite.
- `TranscriptionJob.status` must still pass through `'extracting_audio'` and
  then `'transcribing'` for the Whisper path, in that order, before
  `'completed'`/`'failed'` — `frontend/src/pages/player/PlayerPage.tsx:600-606`
  and `frontend/src/pages/player/controllers/useTranscriptionController.ts:126-128`
  branch visible UI text and a loading flag on these two exact string values.
  Breaking this is a visible frontend regression, not just an internal
  refactor detail.
- The three existing subtitle routes (`GET /api/vod/subtitles/:id`,
  `POST /api/vod/transcribe`, `GET /api/vod/transcribe/:id/status`) keep
  their existing request/response JSON shapes unchanged.
- `SUBTITLES_DIR`'s physical location (`backend/data/subtitles`, i.e.
  `path.join(__dirname, '../../data/subtitles')` relative to
  `backend/src/services/`) must not change — existing generated `.vtt` files
  live there. It intentionally does *not* follow the repo-root `DATA_DIR`
  convention `backend/src/config/paths.ts` uses for everything else; that is
  a pre-existing inconsistency, out of scope to fix here.
- `ProviderChain` lives in `backend/src/services/mediaIntelligence/` and has
  no subtitle- or thumbnail-specific knowledge — both chains are built by
  passing it different provider lists and a different `succeeds` predicate.
- The new `GET /api/vod/thumbnail/:id` route uses `ValidationError`/
  `NotFoundError` from `backend/src/errors` plus `next(error)` in a
  try/catch, matching `backend/src/routes/stream.ts`'s established pattern
  — not ad hoc `res.status().json()`.
- No new npm dependencies. English messages/identifiers. No default
  exports. No `tsconfig.json` changes. No database/schema changes.

---

### Task 1: Generic `ProviderChain`

**Files:**
- Create: `backend/src/services/mediaIntelligence/ProviderChain.ts`
- Test: `backend/src/services/mediaIntelligence/__tests__/ProviderChain.test.ts`

**Interfaces:**
- Produces:
  - `interface ChainableProvider<TRequest, TResult> { readonly name: string; attempt(request: TRequest): Promise<TResult>; }`
  - `interface ProviderChainOptions { retriesPerProvider?: number; }`
  - `class ProviderChain<TRequest, TResult> { constructor(providers: ChainableProvider<TRequest, TResult>[], succeeds: (result: TResult) => boolean, options?: ProviderChainOptions, injectedLogger?: ILogger); run(request: TRequest): Promise<TResult>; }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/mediaIntelligence/__tests__/ProviderChain.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { ProviderChain, type ChainableProvider } from '../ProviderChain';
import { NullLogger } from '../../../logging';

interface Req { id: string; }
interface Res { ok: boolean; value?: string; }

function provider(name: string, attempt: ChainableProvider<Req, Res>['attempt']): ChainableProvider<Req, Res> {
  return { name, attempt };
}

const succeeds = (r: Res) => r.ok;

describe('ProviderChain', () => {
  it('returns the first provider result when it succeeds, without calling later providers', async () => {
    const second = vi.fn();
    const chain = new ProviderChain<Req, Res>(
      [provider('first', async () => ({ ok: true, value: 'from-first' })), provider('second', second)],
      succeeds,
      {},
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'from-first' });
    expect(second).not.toHaveBeenCalled();
  });

  it('retries a throwing provider up to retriesPerProvider extra times before giving up on it', async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error('transient failure');
      return { ok: true, value: 'recovered' };
    });
    const chain = new ProviderChain<Req, Res>(
      [provider('flaky', flaky)],
      succeeds,
      { retriesPerProvider: 1 },
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'recovered' });
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('moves to the next provider once a provider exhausts its retries', async () => {
    const alwaysThrows = vi.fn(async () => { throw new Error('permanent failure'); });
    const chain = new ProviderChain<Req, Res>(
      [
        provider('broken', alwaysThrows),
        provider('fallback', async () => ({ ok: true, value: 'from-fallback' })),
      ],
      succeeds,
      { retriesPerProvider: 1 },
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'from-fallback' });
    expect(alwaysThrows).toHaveBeenCalledTimes(2);
  });

  it('moves to the next provider immediately (no retry) when a provider resolves an unsuccessful result', async () => {
    const nothingToOffer = vi.fn(async () => ({ ok: false }));
    const chain = new ProviderChain<Req, Res>(
      [
        provider('empty', nothingToOffer),
        provider('fallback', async () => ({ ok: true, value: 'from-fallback' })),
      ],
      succeeds,
      { retriesPerProvider: 2 },
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: true, value: 'from-fallback' });
    expect(nothingToOffer).toHaveBeenCalledTimes(1);
  });

  it('returns the last unsuccessful result when every provider has nothing to offer', async () => {
    const chain = new ProviderChain<Req, Res>(
      [provider('empty1', async () => ({ ok: false })), provider('empty2', async () => ({ ok: false, value: 'last' }))],
      succeeds,
      {},
      new NullLogger()
    );

    const result = await chain.run({ id: 'x' });

    expect(result).toEqual({ ok: false, value: 'last' });
  });

  it('throws the last error when every provider throws', async () => {
    const chain = new ProviderChain<Req, Res>(
      [
        provider('a', async () => { throw new Error('a failed'); }),
        provider('b', async () => { throw new Error('b failed'); }),
      ],
      succeeds,
      { retriesPerProvider: 0 },
      new NullLogger()
    );

    await expect(chain.run({ id: 'x' })).rejects.toThrow('b failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/mediaIntelligence/__tests__/ProviderChain.test.ts`
Expected: FAIL with a module-not-found error for `../ProviderChain`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/mediaIntelligence/ProviderChain.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/mediaIntelligence/__tests__/ProviderChain.test.ts`
Expected: PASS, all 6 tests green.

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mediaIntelligence
git commit -m "feat(backend): add generic ProviderChain for subtitle/thumbnail fallback logic"
```

---

### Task 2: `WhisperSubtitleProvider` (extracted from `transcriptionQueue.ts`)

**Files:**
- Create: `backend/src/services/subtitles/ISubtitleProvider.ts`
- Create: `backend/src/services/subtitles/subtitlesDir.ts`
- Create: `backend/src/services/subtitles/WhisperSubtitleProvider.ts`
- Test: `backend/src/services/subtitles/__tests__/WhisperSubtitleProvider.test.ts`

**Interfaces:**
- Produces:
  - `interface SubtitleRequest { mediaUrl: string; targetId: string; onProgress?: (phase: 'extracting_audio' | 'transcribing') => void; }`
  - `interface SubtitleResult { available: boolean; vttPath?: string; }`
  - `export const SUBTITLES_DIR: string` (from `subtitlesDir.ts`)
  - `class WhisperSubtitleProvider implements ChainableProvider<SubtitleRequest, SubtitleResult>` (constructor takes `subtitlesDir: string`)
- Consumes: `ChainableProvider` from `../mediaIntelligence/ProviderChain` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/subtitles/__tests__/WhisperSubtitleProvider.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ffmpegChain = {
  noVideo: vi.fn().mockReturnThis(),
  audioChannels: vi.fn().mockReturnThis(),
  audioFrequency: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  run: vi.fn(),
};

vi.mock('fluent-ffmpeg', () => ({
  default: vi.fn(() => ffmpegChain),
}));

const whisperMock = vi.fn();
vi.mock('whisper-node', () => ({ whisper: whisperMock }));

import { WhisperSubtitleProvider } from '../WhisperSubtitleProvider';

describe('WhisperSubtitleProvider', () => {
  let subtitlesDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    subtitlesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-subtitle-test-'));
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') {
        // Simulate ffmpeg finishing synchronously once .run() is called.
        ffmpegChain.run.mockImplementation(() => cb());
      }
      return ffmpegChain;
    });
  });

  it('extracts audio, transcribes, writes a VTT file, and reports both progress phases', async () => {
    whisperMock.mockResolvedValue([{ start: '00:00.000', end: '00:02.000', speech: 'hello world' }]);
    const provider = new WhisperSubtitleProvider(subtitlesDir);
    const phases: string[] = [];

    const result = await provider.attempt({
      mediaUrl: 'http://example.com/video.mp4',
      targetId: 'abc123',
      onProgress: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(['extracting_audio', 'transcribing']);
    expect(result.available).toBe(true);
    expect(result.vttPath).toBe(path.join(subtitlesDir, 'abc123.vtt'));
    const vttContent = fs.readFileSync(result.vttPath!, 'utf8');
    expect(vttContent).toContain('WEBVTT');
    expect(vttContent).toContain('hello world');
  });

  it('cleans up the temp audio file even when transcription throws', async () => {
    whisperMock.mockRejectedValue(new Error('whisper crashed'));
    const provider = new WhisperSubtitleProvider(subtitlesDir);
    const tempAudioPath = path.join(subtitlesDir, 'temp_abc123.wav');
    fs.writeFileSync(tempAudioPath, ''); // simulate ffmpeg having produced the temp file

    await expect(provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' })).rejects.toThrow('whisper crashed');

    expect(fs.existsSync(tempAudioPath)).toBe(false);
  });

  it('throws when whisper-node does not return an array', async () => {
    whisperMock.mockResolvedValue({ not: 'an array' });
    const provider = new WhisperSubtitleProvider(subtitlesDir);

    await expect(provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' })).rejects.toThrow(
      'Whisper did not return an array of transcriptions'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/WhisperSubtitleProvider.test.ts`
Expected: FAIL with a module-not-found error for `../WhisperSubtitleProvider`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/subtitles/ISubtitleProvider.ts`:
```typescript
export interface SubtitleRequest {
  mediaUrl: string;
  targetId: string;
  // Whisper's transcription has two visible phases the frontend distinguishes
  // in its UI text (extracting_audio vs transcribing) -- this optional hook
  // lets a provider report that progress without the generic ProviderChain
  // or the job queue needing to know which provider is running.
  onProgress?: (phase: 'extracting_audio' | 'transcribing') => void;
}

export interface SubtitleResult {
  available: boolean;
  vttPath?: string;
}
```

Create `backend/src/services/subtitles/subtitlesDir.ts`:
```typescript
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
```

Create `backend/src/services/subtitles/WhisperSubtitleProvider.ts` — this is
`transcriptionQueue.ts`'s existing `extractAudio`/`generateVtt`/
`formatVttTime`/whisper-calling logic, moved verbatim (read
`backend/src/services/transcriptionQueue.ts` first to copy it exactly):
```typescript
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { resolveFromRepoRoot } from '../../config/env';
import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { SubtitleRequest, SubtitleResult } from './ISubtitleProvider';

// Disable TS strict checks for whisper-node as it lacks type definitions
const whisperNode = require('whisper-node');

export class WhisperSubtitleProvider implements ChainableProvider<SubtitleRequest, SubtitleResult> {
  public readonly name = 'WhisperSubtitleProvider';

  constructor(private readonly subtitlesDir: string) {}

  async attempt({ mediaUrl, targetId, onProgress }: SubtitleRequest): Promise<SubtitleResult> {
    const tempAudioPath = path.join(this.subtitlesDir, `temp_${targetId}.wav`);
    const vttPath = path.join(this.subtitlesDir, `${targetId}.vtt`);

    try {
      onProgress?.('extracting_audio');
      await this.extractAudio(mediaUrl, tempAudioPath);

      onProgress?.('transcribing');
      const options = {
        modelName: 'tiny',
        modelPath: resolveFromRepoRoot('models/ggml-tiny.bin'),
        whisperOptions: {
          outputInText: false,
          outputInVtt: false,
          word_timestamps: false,
        },
      };

      // whisper-node returns an array of segment objects: [{start, end, speech}]
      const transcript = await whisperNode.whisper(tempAudioPath, options);

      if (!Array.isArray(transcript)) {
        throw new Error('Whisper did not return an array of transcriptions. Result: ' + JSON.stringify(transcript));
      }

      this.generateVtt(transcript, vttPath);
      return { available: true, vttPath };
    } finally {
      if (fs.existsSync(tempAudioPath)) {
        try { fs.unlinkSync(tempAudioPath); } catch {}
      }
    }
  }

  private extractAudio(mediaUrl: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(mediaUrl)
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

  private generateVtt(transcript: any[], outPath: string) {
    let vtt = 'WEBVTT\n\n';
    transcript.forEach((segment, i) => {
      const start = this.formatVttTime(segment.start);
      const end = this.formatVttTime(segment.end);
      vtt += `${i + 1}\n${start} --> ${end}\n${(segment.speech || segment.text || '').trim()}\n\n`;
    });
    fs.writeFileSync(outPath, vtt, 'utf8');
  }

  private formatVttTime(timeString: string | number): string {
    if (typeof timeString === 'string') {
      const parts = timeString.split(':');
      if (parts.length === 2) {
        return `00:${timeString.replace(',', '.')}`;
      }
      return timeString.replace(',', '.');
    }

    const date = new Date(0);
    date.setMilliseconds(Number(timeString) * 1000);
    return date.toISOString().substring(11, 23);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/WhisperSubtitleProvider.test.ts`
Expected: PASS, all 3 tests green.

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/ISubtitleProvider.ts backend/src/services/subtitles/subtitlesDir.ts backend/src/services/subtitles/WhisperSubtitleProvider.ts backend/src/services/subtitles/__tests__/WhisperSubtitleProvider.test.ts
git commit -m "feat(backend): extract WhisperSubtitleProvider from transcriptionQueue.ts"
```

---

### Task 3: `EmbeddedTrackSubtitleProvider`, `NoSubtitleAvailableProvider`, and the subtitle chain

**Files:**
- Create: `backend/src/services/subtitles/EmbeddedTrackSubtitleProvider.ts`
- Create: `backend/src/services/subtitles/NoSubtitleAvailableProvider.ts`
- Create: `backend/src/services/subtitles/subtitleProviderChain.ts`
- Test: `backend/src/services/subtitles/__tests__/EmbeddedTrackSubtitleProvider.test.ts`
- Test: `backend/src/services/subtitles/__tests__/NoSubtitleAvailableProvider.test.ts`

**Interfaces:**
- Consumes: `ChainableProvider`, `ProviderChain` (Task 1); `SubtitleRequest`, `SubtitleResult`, `SUBTITLES_DIR` (Task 2).
- Produces: `export const subtitleProviderChain: ProviderChain<SubtitleRequest, SubtitleResult>` from `subtitleProviderChain.ts`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/subtitles/__tests__/EmbeddedTrackSubtitleProvider.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import path from 'path';

const ffmpegChain = {
  outputOptions: vi.fn().mockReturnThis(),
  format: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  run: vi.fn(),
};

const ffprobeMock = vi.fn();

vi.mock('fluent-ffmpeg', () => {
  const fn = vi.fn(() => ffmpegChain) as unknown as { (): typeof ffmpegChain; ffprobe: typeof ffprobeMock };
  fn.ffprobe = ffprobeMock;
  return { default: fn };
});

import { EmbeddedTrackSubtitleProvider } from '../EmbeddedTrackSubtitleProvider';

describe('EmbeddedTrackSubtitleProvider', () => {
  it('returns unavailable without calling ffmpeg extraction when there is no embedded subtitle stream', async () => {
    ffprobeMock.mockImplementation((_url: string, cb: (err: Error | null, metadata: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] });
    });
    const provider = new EmbeddedTrackSubtitleProvider('/tmp/subtitles');

    const result = await provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' });

    expect(result).toEqual({ available: false });
    expect(ffmpegChain.run).not.toHaveBeenCalled();
  });

  it('extracts the embedded subtitle track to VTT when one exists', async () => {
    ffprobeMock.mockImplementation((_url: string, cb: (err: Error | null, metadata: unknown) => void) => {
      cb(null, { streams: [{ codec_type: 'video' }, { codec_type: 'subtitle' }] });
    });
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') ffmpegChain.run.mockImplementation(() => cb());
      return ffmpegChain;
    });
    const provider = new EmbeddedTrackSubtitleProvider('/tmp/subtitles');

    const result = await provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' });

    expect(result).toEqual({ available: true, vttPath: path.join('/tmp/subtitles', 'abc123.vtt') });
    expect(ffmpegChain.outputOptions).toHaveBeenCalledWith(['-map', '0:s:0']);
  });

  it('rejects when ffprobe itself errors', async () => {
    ffprobeMock.mockImplementation((_url: string, cb: (err: Error | null, metadata: unknown) => void) => {
      cb(new Error('probe failed'), null);
    });
    const provider = new EmbeddedTrackSubtitleProvider('/tmp/subtitles');

    await expect(provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123' })).rejects.toThrow('probe failed');
  });
});
```

Create `backend/src/services/subtitles/__tests__/NoSubtitleAvailableProvider.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { NoSubtitleAvailableProvider } from '../NoSubtitleAvailableProvider';

describe('NoSubtitleAvailableProvider', () => {
  it('always resolves with available: false and never throws', async () => {
    const provider = new NoSubtitleAvailableProvider();

    const result = await provider.attempt({ mediaUrl: 'anything', targetId: 'anything' });

    expect(result).toEqual({ available: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/EmbeddedTrackSubtitleProvider.test.ts src/services/subtitles/__tests__/NoSubtitleAvailableProvider.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/subtitles/EmbeddedTrackSubtitleProvider.ts`:
```typescript
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { SubtitleRequest, SubtitleResult } from './ISubtitleProvider';

export class EmbeddedTrackSubtitleProvider implements ChainableProvider<SubtitleRequest, SubtitleResult> {
  public readonly name = 'EmbeddedTrackSubtitleProvider';

  constructor(private readonly subtitlesDir: string) {}

  async attempt({ mediaUrl, targetId }: SubtitleRequest): Promise<SubtitleResult> {
    const hasEmbeddedTrack = await this.probeForSubtitleStream(mediaUrl);
    if (!hasEmbeddedTrack) {
      return { available: false };
    }

    const vttPath = path.join(this.subtitlesDir, `${targetId}.vtt`);
    await this.extractTrack(mediaUrl, vttPath);
    return { available: true, vttPath };
  }

  private probeForSubtitleStream(mediaUrl: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaUrl, (err, metadata) => {
        if (err) return reject(err);
        const hasSubtitle = (metadata?.streams || []).some((s) => s.codec_type === 'subtitle');
        resolve(hasSubtitle);
      });
    });
  }

  private extractTrack(mediaUrl: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(mediaUrl)
        .outputOptions(['-map', '0:s:0'])
        .format('webvtt')
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }
}
```

Create `backend/src/services/subtitles/NoSubtitleAvailableProvider.ts`:
```typescript
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
```

Create `backend/src/services/subtitles/subtitleProviderChain.ts`:
```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/subtitles/__tests__/EmbeddedTrackSubtitleProvider.test.ts src/services/subtitles/__tests__/NoSubtitleAvailableProvider.test.ts`
Expected: PASS, all 4 tests green.

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subtitles/EmbeddedTrackSubtitleProvider.ts backend/src/services/subtitles/NoSubtitleAvailableProvider.ts backend/src/services/subtitles/subtitleProviderChain.ts backend/src/services/subtitles/__tests__/EmbeddedTrackSubtitleProvider.test.ts backend/src/services/subtitles/__tests__/NoSubtitleAvailableProvider.test.ts
git commit -m "feat(backend): add EmbeddedTrackSubtitleProvider, NoSubtitleAvailableProvider, and wire the subtitle chain"
```

---

### Task 4: Wire `transcriptionQueue.ts` to `subtitleProviderChain`

**Files:**
- Modify: `backend/src/services/transcriptionQueue.ts`
- Test: `backend/src/services/__tests__/transcriptionQueue.test.ts`

**Interfaces:**
- Consumes: `subtitleProviderChain` (Task 3).
- Produces: nothing new — `TranscriptionQueue`'s public surface
  (`getJob`, `getSubtitlePath`, `enqueue`) and `TranscriptionJob`'s shape are
  unchanged; only the private body of `processQueue()` changes.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/transcriptionQueue.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
vi.mock('../subtitles/subtitleProviderChain', () => ({
  subtitleProviderChain: { run: runMock },
}));

import { transcriptionQueue } from '../transcriptionQueue';

describe('TranscriptionQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('goes through extracting_audio then transcribing before completing on success', async () => {
    const statuses: string[] = [];
    runMock.mockImplementation(async ({ onProgress }: { onProgress?: (p: string) => void }) => {
      onProgress?.('extracting_audio');
      statuses.push('extracting_audio');
      onProgress?.('transcribing');
      statuses.push('transcribing');
      return { available: true, vttPath: '/tmp/x.vtt' };
    });

    await transcriptionQueue.enqueue('http://example.com/video.mp4', 'job-1');
    await vi.waitFor(() => expect(transcriptionQueue.getJob('job-1')?.status).toBe('completed'));

    expect(statuses).toEqual(['extracting_audio', 'transcribing']);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: 'http://example.com/video.mp4', targetId: 'job-1' })
    );
  });

  it('marks the job failed when the chain resolves unavailable', async () => {
    runMock.mockResolvedValue({ available: false });

    await transcriptionQueue.enqueue('http://example.com/video.mp4', 'job-2');
    await vi.waitFor(() => expect(transcriptionQueue.getJob('job-2')?.status).toBe('failed'));

    expect(transcriptionQueue.getJob('job-2')?.error).toContain('No subtitle provider could produce a subtitle');
  });

  it('marks the job failed when the chain throws', async () => {
    runMock.mockRejectedValue(new Error('everything is on fire'));

    await transcriptionQueue.enqueue('http://example.com/video.mp4', 'job-3');
    await vi.waitFor(() => expect(transcriptionQueue.getJob('job-3')?.status).toBe('failed'));

    expect(transcriptionQueue.getJob('job-3')?.error).toBe('everything is on fire');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/transcriptionQueue.test.ts`
Expected: FAIL — the current `processQueue()` calls whisper-node directly, not `subtitleProviderChain.run`, so the mock's `runMock` is never called and the assertions time out/fail.

- [ ] **Step 3: Write the implementation**

In `backend/src/services/transcriptionQueue.ts`:

Remove the `whisper-node` require, the `resolveFromRepoRoot` import (no
longer used directly in this file), and the local `SUBTITLES_DIR` constant
plus its `mkdirSync` call (now owned by `./subtitles/subtitlesDir.ts`).
Remove the private helper methods this file no longer needs directly
(`extractAudio`, `generateVtt`, `formatVttTime` — all three moved into
`WhisperSubtitleProvider` in Task 2).

Replace the top of the file with:
```typescript
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { subtitleProviderChain } from './subtitles/subtitleProviderChain';
import { SUBTITLES_DIR } from './subtitles/subtitlesDir';

export interface TranscriptionJob {
  id: string;
  mediaUrl: string;
  targetId: string;
  status: 'queued' | 'extracting_audio' | 'transcribing' | 'completed' | 'failed';
  error?: string;
  progress?: number;
}
```
(`SUBTITLES_DIR` is still used below by `getSubtitlePath`, so the import
stays; `path`/`fs` remain in use for that same method.)

Replace the body of `processQueue()` (from `try {` through the matching
`finally { ... }`) with:
```typescript
    try {
      console.log(`[Transcription] Starting job for ${job.targetId}`);
      job.status = 'extracting_audio';
      this.jobsMap.set(job.targetId, job);

      const result = await subtitleProviderChain.run({
        mediaUrl: job.mediaUrl,
        targetId: job.targetId,
        onProgress: (phase) => {
          job.status = phase;
          this.jobsMap.set(job.targetId, job);
        },
      });

      if (!result.available) {
        throw new Error('No subtitle provider could produce a subtitle for this media.');
      }

      job.status = 'completed';
      console.log(`[Transcription] Completed job for ${job.targetId}`);
    } catch (err: any) {
      console.error(`[Transcription] Failed for ${job.targetId}:`, err);
      job.status = 'failed';
      job.error = err.message || String(err);
    } finally {
      this.jobsMap.set(job.targetId, job);
      this.activeJob = null;
      this.processQueue();
    }
```
(The old `tempAudioPath` variable and its cleanup block are gone from this
method — that cleanup now lives inside `WhisperSubtitleProvider.attempt`'s
own `finally`, from Task 2.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/transcriptionQueue.test.ts`
Expected: PASS, all 3 tests green.

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS — all suites green, including the new subtitle provider
tests from Tasks 1-3.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/transcriptionQueue.ts backend/src/services/__tests__/transcriptionQueue.test.ts
git commit -m "refactor(backend): route transcriptionQueue through subtitleProviderChain"
```

---

### Task 5: Thumbnail providers and `ThumbnailService`

**Files:**
- Modify: `backend/src/config/paths.ts`
- Create: `backend/src/services/thumbnails/IThumbnailProvider.ts`
- Create: `backend/src/services/thumbnails/FfmpegFrameGrabThumbnailProvider.ts`
- Create: `backend/src/services/thumbnails/NoThumbnailAvailableProvider.ts`
- Create: `backend/src/services/thumbnails/ThumbnailService.ts`
- Test: `backend/src/services/thumbnails/__tests__/FfmpegFrameGrabThumbnailProvider.test.ts`
- Test: `backend/src/services/thumbnails/__tests__/ThumbnailService.test.ts`

**Interfaces:**
- Consumes: `ChainableProvider`, `ProviderChain` (Task 1).
- Produces:
  - `interface ThumbnailRequest { mediaUrl: string; targetId: string; outputPath: string; }`
  - `interface ThumbnailResult { available: boolean; thumbnailPath?: string; }`
  - `export const THUMBNAILS_DIR: string` (from `backend/src/config/paths.ts`)
  - `class ThumbnailService { async getOrCreate(mediaUrl: string, targetId: string): Promise<string | null>; }`
  - `export const thumbnailService: ThumbnailService`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/thumbnails/__tests__/FfmpegFrameGrabThumbnailProvider.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import path from 'path';

const screenshotsMock = vi.fn();
const ffmpegChain = {
  on: vi.fn().mockReturnThis(),
  screenshots: screenshotsMock,
};

vi.mock('fluent-ffmpeg', () => ({ default: vi.fn(() => ffmpegChain) }));

import { FfmpegFrameGrabThumbnailProvider } from '../FfmpegFrameGrabThumbnailProvider';

describe('FfmpegFrameGrabThumbnailProvider', () => {
  it('grabs one screenshot into the requested output path and resolves available: true', async () => {
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') screenshotsMock.mockImplementation(() => cb());
      return ffmpegChain;
    });
    const provider = new FfmpegFrameGrabThumbnailProvider();
    const outputPath = path.join('/tmp/thumbs', 'abc123.jpg');

    const result = await provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123', outputPath });

    expect(result).toEqual({ available: true, thumbnailPath: outputPath });
    expect(screenshotsMock).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'abc123.jpg', folder: '/tmp/thumbs' })
    );
  });

  it('rejects when ffmpeg emits an error', async () => {
    ffmpegChain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') screenshotsMock.mockImplementation(() => cb(new Error('frame grab failed')));
      return ffmpegChain;
    });
    const provider = new FfmpegFrameGrabThumbnailProvider();

    await expect(
      provider.attempt({ mediaUrl: 'http://example.com/video.mp4', targetId: 'abc123', outputPath: '/tmp/thumbs/abc123.jpg' })
    ).rejects.toThrow('frame grab failed');
  });
});
```

Create `backend/src/services/thumbnails/__tests__/ThumbnailService.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../../config/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/paths')>();
  return { ...actual, THUMBNAILS_DIR: globalThis.__TEST_THUMBNAILS_DIR__ };
});

describe('ThumbnailService', () => {
  let thumbnailsDir: string;

  beforeEach(async () => {
    thumbnailsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-service-test-'));
    (globalThis as any).__TEST_THUMBNAILS_DIR__ = thumbnailsDir;
    vi.resetModules();
  });

  it('returns the cached path without invoking the provider chain when the file already exists', async () => {
    const cachedPath = path.join(thumbnailsDir, 'abc123.jpg');
    fs.writeFileSync(cachedPath, 'fake-jpeg-bytes');
    const { ThumbnailService } = await import('../ThumbnailService');
    const service = new ThumbnailService();

    const result = await service.getOrCreate('http://example.com/video.mp4', 'abc123');

    expect(result).toBe(cachedPath);
  });

  it('returns null when no provider can produce a thumbnail', async () => {
    vi.doMock('../FfmpegFrameGrabThumbnailProvider', () => ({
      FfmpegFrameGrabThumbnailProvider: class {
        name = 'FfmpegFrameGrabThumbnailProvider';
        async attempt() { throw new Error('ffmpeg not available in test'); },
      },
    }));
    const { ThumbnailService } = await import('../ThumbnailService');
    const service = new ThumbnailService();

    const result = await service.getOrCreate('http://example.com/video.mp4', 'missing-media');

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/thumbnails/__tests__/FfmpegFrameGrabThumbnailProvider.test.ts src/services/thumbnails/__tests__/ThumbnailService.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Write the implementation**

In `backend/src/config/paths.ts`, add `THUMBNAILS_DIR` next to the other
`DATA_DIR`-relative constants and include it in the `mkdirSync` loop:
```typescript
export const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
export const THUMBNAILS_DIR = path.join(DATA_DIR, 'thumbnails');

for (const dir of [DATA_DIR, SOURCES_DIR, RAW_CACHE_DIR, LOGS_DIR, DOWNLOADS_DIR, THUMBNAILS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
```
(Add the `THUMBNAILS_DIR` export line right after the existing
`DOWNLOADS_DIR` line, and add `THUMBNAILS_DIR` to the existing loop's array
— do not create a second loop.)

Create `backend/src/services/thumbnails/IThumbnailProvider.ts`:
```typescript
export interface ThumbnailRequest {
  mediaUrl: string;
  targetId: string;
  outputPath: string;
}

export interface ThumbnailResult {
  available: boolean;
  thumbnailPath?: string;
}
```

Create `backend/src/services/thumbnails/FfmpegFrameGrabThumbnailProvider.ts`:
```typescript
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { ThumbnailRequest, ThumbnailResult } from './IThumbnailProvider';

const FRAME_GRAB_TIMESTAMP_SECONDS = 10;

export class FfmpegFrameGrabThumbnailProvider implements ChainableProvider<ThumbnailRequest, ThumbnailResult> {
  public readonly name = 'FfmpegFrameGrabThumbnailProvider';

  async attempt({ mediaUrl, outputPath }: ThumbnailRequest): Promise<ThumbnailResult> {
    await this.grabFrame(mediaUrl, outputPath);
    return { available: true, thumbnailPath: outputPath };
  }

  private grabFrame(mediaUrl: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(mediaUrl)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .screenshots({
          timestamps: [FRAME_GRAB_TIMESTAMP_SECONDS],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
        });
    });
  }
}
```

Create `backend/src/services/thumbnails/NoThumbnailAvailableProvider.ts`:
```typescript
import type { ChainableProvider } from '../mediaIntelligence/ProviderChain';
import type { ThumbnailRequest, ThumbnailResult } from './IThumbnailProvider';

export class NoThumbnailAvailableProvider implements ChainableProvider<ThumbnailRequest, ThumbnailResult> {
  public readonly name = 'NoThumbnailAvailableProvider';

  async attempt(_request: ThumbnailRequest): Promise<ThumbnailResult> {
    return { available: false };
  }
}
```

Create `backend/src/services/thumbnails/ThumbnailService.ts`:
```typescript
import fs from 'fs';
import path from 'path';
import { ProviderChain } from '../mediaIntelligence/ProviderChain';
import { FfmpegFrameGrabThumbnailProvider } from './FfmpegFrameGrabThumbnailProvider';
import { NoThumbnailAvailableProvider } from './NoThumbnailAvailableProvider';
import { THUMBNAILS_DIR } from '../../config/paths';
import type { ThumbnailRequest, ThumbnailResult } from './IThumbnailProvider';

const thumbnailProviderChain = new ProviderChain<ThumbnailRequest, ThumbnailResult>(
  [new FfmpegFrameGrabThumbnailProvider(), new NoThumbnailAvailableProvider()],
  (result) => result.available
);

export class ThumbnailService {
  async getOrCreate(mediaUrl: string, targetId: string): Promise<string | null> {
    const outputPath = path.join(THUMBNAILS_DIR, `${targetId}.jpg`);
    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    const result = await thumbnailProviderChain.run({ mediaUrl, targetId, outputPath });
    return result.available && result.thumbnailPath ? result.thumbnailPath : null;
  }
}

export const thumbnailService = new ThumbnailService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/thumbnails/__tests__/FfmpegFrameGrabThumbnailProvider.test.ts src/services/thumbnails/__tests__/ThumbnailService.test.ts`
Expected: PASS, all 4 tests green.

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/paths.ts backend/src/services/thumbnails
git commit -m "feat(backend): add ThumbnailProvider chain and ThumbnailService"
```

---

### Task 6: `GET /api/vod/thumbnail/:id` route

**Files:**
- Modify: `backend/src/routes/vod.ts`
- Test: `backend/src/routes/__tests__/vod.thumbnail.test.ts`

**Interfaces:**
- Consumes: `thumbnailService` (Task 5); `ValidationError`, `NotFoundError` from `backend/src/errors`.
- Produces: nothing new to other modules — this is the outermost, route-level
  layer.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/vod.thumbnail.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1 };
    next();
  },
}));

const getOrCreateMock = vi.fn();
vi.mock('../../services/thumbnails/ThumbnailService', () => ({
  thumbnailService: { getOrCreate: getOrCreateMock },
}));

import { vodRouter } from '../vod';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', vodRouter);
  app.use(errorHandler);
  return app;
}

describe('GET /api/vod/thumbnail/:id', () => {
  it('returns 400 with the standard error shape when mediaUrl is missing', async () => {
    const res = await request(buildApp()).get('/api/vod/thumbnail/abc123');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'mediaUrl query parameter is required' } });
  });

  it('returns 404 with the standard error shape when no thumbnail is available', async () => {
    getOrCreateMock.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/vod/thumbnail/abc123').query({ mediaUrl: 'http://example.com/video.mp4' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Thumbnail not available for this media' } });
  });

  it('calls thumbnailService.getOrCreate with the resolved media URL and target id', async () => {
    getOrCreateMock.mockResolvedValue(null);
    await request(buildApp()).get('/api/vod/thumbnail/abc123').query({ mediaUrl: 'http://example.com/video.mp4' });
    expect(getOrCreateMock).toHaveBeenCalledWith('http://example.com/video.mp4', 'abc123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/routes/__tests__/vod.thumbnail.test.ts`
Expected: FAIL — the route does not exist yet, so all three requests 404 via
Express's default handler rather than the assertions above.

- [ ] **Step 3: Write the implementation**

In `backend/src/routes/vod.ts`, add to the imports near the top:
```typescript
import { thumbnailService } from '../services/thumbnails/ThumbnailService';
import { ValidationError, NotFoundError } from '../errors';
```

Locate the existing local-media-path-resolving block inside the
`/vod/transcribe` handler (the `if (sourceUrl.includes('/api/local-media/stream')) { ... }`
block). Extract it into a standalone function placed near the top of the
file, next to `buildProviderMap`:
```typescript
function resolveLocalMediaPath(mediaUrl: string): string {
  let sourceUrl = mediaUrl;
  if (sourceUrl.includes('/api/local-media/stream')) {
    try {
      const parsed = new URL(sourceUrl, 'http://localhost');
      const mediaId = parsed.searchParams.get('id');
      const fileParam = parsed.searchParams.get('file');
      const localIndex = getLocalMediaIndex();
      let resolvedFile: string | null = null;
      if (mediaId) {
        resolvedFile = localIndex.movies.find((m) => m.id === mediaId)?.filePath ||
          localIndex.episodes.find((e) => e.id === mediaId)?.filePath || null;
      } else if (fileParam) {
        resolvedFile = path.resolve(fileParam);
      }
      if (resolvedFile && fs.existsSync(resolvedFile)) {
        sourceUrl = resolvedFile;
      }
    } catch (e) {
      console.warn('[VOD_LOCAL_MEDIA] Could not resolve local media path:', e);
    }
  }
  return sourceUrl;
}
```
Then replace the `/vod/transcribe` handler's inline block with a call to it
— change:
```typescript
  let sourceUrl = mediaUrl;
  if (sourceUrl.includes('/api/local-media/stream')) {
    try {
      const parsed = new URL(sourceUrl, 'http://localhost');
      const mediaId = parsed.searchParams.get('id');
      const fileParam = parsed.searchParams.get('file');
      const localIndex = getLocalMediaIndex();
      let resolvedFile: string | null = null;
      if (mediaId) {
        resolvedFile = localIndex.movies.find((m) => m.id === mediaId)?.filePath ||
          localIndex.episodes.find((e) => e.id === mediaId)?.filePath || null;
      } else if (fileParam) {
        resolvedFile = path.resolve(fileParam);
      }
      if (resolvedFile && fs.existsSync(resolvedFile)) {
        sourceUrl = resolvedFile;
      }
    } catch (e) {
      console.warn('[VOD_TRANSCRIBE] Could not resolve local media path:', e);
    }
  }
```
to:
```typescript
  const sourceUrl = resolveLocalMediaPath(mediaUrl);
```
(This is a pure extraction with identical behavior — the only observable
difference is the log tag changing from `[VOD_TRANSCRIBE]` to
`[VOD_LOCAL_MEDIA]` in the shared helper, since it's no longer specific to
the transcribe route. Confirm `sourceUrl` was previously declared with `let`
only because it was reassigned inside the block; since `resolveLocalMediaPath`
now returns the final value directly, `const` is correct here.)

Add the new route after the existing `/vod/transcribe/:id/status` route:
```typescript
vodRouter.get('/vod/thumbnail/:id', requireAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const mediaUrl = req.query.mediaUrl as string | undefined;
    if (!mediaUrl) {
      throw new ValidationError('mediaUrl query parameter is required');
    }

    const sourceUrl = resolveLocalMediaPath(mediaUrl);
    const thumbnailPath = await thumbnailService.getOrCreate(sourceUrl, targetId);

    if (!thumbnailPath) {
      throw new NotFoundError('Thumbnail not available for this media');
    }

    res.sendFile(thumbnailPath);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/routes/__tests__/vod.thumbnail.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS — all suites green, including the existing `/vod/transcribe`
coverage this task's `resolveLocalMediaPath` extraction touches indirectly
(there is no dedicated pre-existing test file for that route today, so
confirm via `npm run typecheck` plus a manual read of the diff that the
extracted function's behavior is identical to the inline block it replaced).

- [ ] **Step 6: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/vod.ts backend/src/routes/__tests__/vod.thumbnail.test.ts
git commit -m "feat(backend): add GET /api/vod/thumbnail/:id route backed by ThumbnailService"
```

---

## Post-plan note for later phases

Two extension points this plan deliberately left open, both requiring no
interface changes to pick up later: (1) an `ExternalApiSubtitleProvider`
(e.g. OpenSubtitles or a hosted Whisper API) slots into
`subtitleProviderChain.ts`'s provider array between
`WhisperSubtitleProvider` and `EmbeddedTrackSubtitleProvider`, or wherever
priority makes sense, once an API key strategy exists; (2) a granular
per-provider config file (which providers are enabled, retry counts, model
size) is a natural fit for the config-file-driven approach mentioned in the
original architecture review, layered on top of `ProviderChainOptions`
without changing `ProviderChain` itself. Neither blocks Phase 7/8.

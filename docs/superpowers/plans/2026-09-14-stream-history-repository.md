# HTTP Fetch Extraction + Stream History Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Close the latent circular dependency Phase 4 left between
`backend/src/services/sources.ts` and `backend/src/services/sourceStrategies/`
by extracting `fetchUrlContent`/`SendStatus` into a standalone
`httpFetch.ts` module, reverting the dynamic-import workaround back to a
normal static import. (2) Demonstrate the repository pattern — the first
concrete piece of Phase 5's "route → service/repository extraction" —
by extracting `backend/src/routes/stream.ts`'s scattered `stream_history`
table access into an `IStreamHistoryRepository`, and migrating that one
route file to use it.

**Scope note:** Full Phase 5 (splitting `stream.ts`/`proxy.ts`/`sources.ts`/
`vod.ts` route handlers into thin controllers over dedicated services) is
too large for one plan — each of those files has its own distinct
responsibilities and would need its own plan, the same way this whole
roadmap treats one architectural concern per plan. This plan does the
httpFetch cleanup Phase 4 left behind (small, well-defined, blocks nothing
else) and establishes the repository pattern on the smallest clean surface
available (`stream_history` access in `stream.ts`) as the template later
plans should copy for `proxy.ts`, `sources.ts`'s routes, and `vod.ts`.

**Architecture:** `backend/src/services/httpFetch.ts` becomes the single
owner of `fetchUrlContent` and the `SendStatus` type; `sources.ts`
re-exports both (so `routes/sources.ts`'s existing import keeps working
unchanged) and imports from `httpFetch.ts` itself instead of defining them.
All three playlist strategies (`M3uFileStrategy`, `M3uUrlStrategy`,
`XtreamCodesStrategy`) and `PlaylistSourceStrategy` import `SendStatus`
(and, for two of them, `fetchUrlContent`) from `httpFetch.ts` directly,
never from `sources.ts` — this fully severs the cycle, so `sources.ts`
goes back to statically importing `selectPlaylistStrategy` from
`./sourceStrategies`.

`backend/src/repositories/` holds `IStreamHistoryRepository` (interface),
`KnexStreamHistoryRepository` (the real implementation, wrapping the
existing `db('stream_history')`/`insertAndGetId` calls verbatim), and a
barrel exporting a `streamHistoryRepository` singleton — same shape as
`backend/src/services/remote/`'s `IRemoteSessionHub`/`MemoryRemoteSessionHub`
pair. `stream.ts` imports the singleton and stops importing `db`/
`insertAndGetId` directly; its two local helper functions
(`updateStreamHistoryEnd`, `updateStreamHistoryEndUnconditional`) are
deleted, their logic now living in the repository.

**Tech Stack:** TypeScript, Vitest, Knex (existing dependency, unchanged).

**Spec:** N/A — derived directly from the architecture review in this
conversation and the roadmap's post-Phase-4 note. See roadmap:
`docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`
Phase 5.

## Global Constraints

- `fetchUrlContent`'s behavior (redirect-following, 60s timeout,
  `asBuffer` support, 150MB safety limit, all log messages) is preserved
  verbatim — this is a pure file move for that function, not a rewrite.
- `IStreamHistoryRepository`'s method surface:
  `create(input: CreateStreamHistoryInput): Promise<number>`,
  `endPlaying(historyId: number, startTime: string): Promise<void>`,
  `endUnconditional(historyId: number, startTime: string): Promise<void>`,
  `getStartTime(historyId: number, userId: number): Promise<string | undefined>`.
  Every method preserves the exact existing SQL semantics (`endPlaying`
  only updates a row still `status: 'playing'`; `endUnconditional` only
  updates a row with `end_time` still null; the same `duration_seconds`
  computation; the same column names).
- `routes/sources.ts`'s existing `import { fetchUrlContent, processAndMergeSources } from '../services/sources';` must keep compiling unchanged — `sources.ts` re-exports `fetchUrlContent`/`SendStatus`.
- Error/log messages and code identifiers stay in English.
- No default exports.
- No changes to `backend/tsconfig.json` compiler options.
- No changes to the `stream_history` table schema or any migration.

---

### Task 1: Extract `httpFetch.ts`, break the Phase 4 circular dependency

**Files:**
- Create: `backend/src/services/httpFetch.ts`
- Test: `backend/src/services/__tests__/httpFetch.test.ts`
- Modify: `backend/src/services/sources.ts`
- Modify: `backend/src/services/sourceStrategies/PlaylistSourceStrategy.ts`
- Modify: `backend/src/services/sourceStrategies/M3uFileStrategy.ts`
- Modify: `backend/src/services/sourceStrategies/M3uUrlStrategy.ts`
- Modify: `backend/src/services/sourceStrategies/XtreamCodesStrategy.ts`

**Interfaces:**
- Produces: `fetchUrlContent` (same signature as today) and
  `type SendStatus = (message: string, type?: string) => void;`, both
  exported from `backend/src/services/httpFetch.ts`.
- Consumes (unchanged elsewhere): nothing new for callers — `routes/sources.ts`
  keeps importing `fetchUrlContent` from `../services/sources` via the
  re-export.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/httpFetch.test.ts` — this moves the
existing behavioral coverage for `fetchUrlContent` to its new home (there
is no pre-existing test for it today, so this is new coverage, not a
relocation of an old test file):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { EventEmitter } from 'events';
import { fetchUrlContent } from '../httpFetch';

function buildFakeResponse(statusCode: number, chunks: string[], headers: Record<string, string> = {}) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: () => void };
  res.statusCode = statusCode;
  res.headers = headers;
  res.destroy = () => {};
  process.nextTick(() => {
    for (const chunk of chunks) res.emit('data', Buffer.from(chunk));
    res.emit('end');
  });
  return res;
}

describe('fetchUrlContent', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(http, 'get');
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it('resolves with the concatenated response body as a string on HTTP 200', async () => {
    getSpy.mockImplementation((_url, _opts, callback) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      (cb as (res: unknown) => void)(buildFakeResponse(200, ['hello ', 'world']));
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => {};
      return req as never;
    });

    const content = await fetchUrlContent('http://example.com/file.txt');

    expect(content).toBe('hello world');
  });

  it('rejects when the response status code is not 200', async () => {
    getSpy.mockImplementation((_url, _opts, callback) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      (cb as (res: unknown) => void)(buildFakeResponse(404, []));
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => {};
      return req as never;
    });

    await expect(fetchUrlContent('http://example.com/missing.txt')).rejects.toThrow('Status Code 404');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/httpFetch.test.ts`
Expected: FAIL with a module-not-found error for `../httpFetch`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/httpFetch.ts` — this is the exact current
body of `fetchUrlContent` and the `SendStatus` type from
`backend/src/services/sources.ts` (read that file first to copy it
verbatim, including its explanatory comment):
```typescript
import http from 'http';
import https from 'https';

export type SendStatus = (message: string, type?: string) => void;

// Ports fetchUrlContent from server.js:1174-1222 verbatim: follows redirects
// recursively, supports a 60s timeout, and can return either text or a raw
// Buffer (asBuffer -- used for binary sources like compressed EPG files).
export function fetchUrlContent(
  url: string,
  options: http.RequestOptions = {},
  asBuffer = false,
  maxBytes = 150 * 1024 * 1024 // 150 MB safety limit
): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const TIMEOUT_DURATION = 60000;
    console.log(`[FETCH] Attempting to fetch URL content: ${url} (Timeout: ${TIMEOUT_DURATION / 1000}s)`);

    let isDone = false;
    const finish = (err?: Error, data?: string | Buffer) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(hardTimer);
      if (err) reject(err);
      else resolve(data!);
    };

    const hardTimer = setTimeout(() => {
      try { request.destroy(); } catch {}
      const timeoutError = new Error(`Request to ${url} exceeded hard timeout of ${TIMEOUT_DURATION / 1000} seconds.`);
      console.error(`[FETCH] ${timeoutError.message}`);
      finish(timeoutError);
    }, TIMEOUT_DURATION);

    const request = protocol.get(url, { timeout: TIMEOUT_DURATION, ...options }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[FETCH] Redirecting to: ${res.headers.location}`);
        try { request.destroy(); } catch {}
        clearTimeout(hardTimer);
        return fetchUrlContent(new URL(res.headers.location, url).href, options, asBuffer, maxBytes).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        console.error(`[FETCH] Failed to fetch ${url}: Status Code ${res.statusCode}`);
        try { request.destroy(); res.destroy(); } catch {}
        return finish(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
      }

      let totalBytes = 0;

      if (asBuffer) {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            try { request.destroy(); res.destroy(); } catch {}
            return finish(new Error(`Response from ${url} exceeded maximum size limit of ${Math.round(maxBytes / 1024 / 1024)}MB.`));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          console.log(`[FETCH] Successfully fetched content as buffer from: ${url} (${totalBytes} bytes)`);
          finish(undefined, Buffer.concat(chunks));
        });
      } else {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            try { request.destroy(); res.destroy(); } catch {}
            return finish(new Error(`Response from ${url} exceeded maximum size limit of ${Math.round(maxBytes / 1024 / 1024)}MB.`));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          console.log(`[FETCH] Successfully fetched content from: ${url} (${totalBytes} bytes)`);
          finish(undefined, Buffer.concat(chunks).toString('utf-8'));
        });
      }
    });

    request.on('timeout', () => {
      try { request.destroy(); } catch {}
      const timeoutError = new Error(`Request to ${url} socket idle timed out after ${TIMEOUT_DURATION / 1000} seconds.`);
      console.error(`[FETCH] ${timeoutError.message}`);
      finish(timeoutError);
    });

    request.on('error', (err) => {
      console.error(`[FETCH] Network error fetching ${url}: ${err.message}`);
      finish(err);
    });
  });
}
```

In `backend/src/services/sources.ts`:

Find the `fetchUrlContent` function and the `SendStatus` type definition
(the function starts with the `// Ports fetchUrlContent...` comment, ends
at its closing `}`; `SendStatus` is defined further down as
`export type SendStatus = (message: string, type?: string) => void;`).
Delete both from this file. Delete the now-unused `import http from 'http';`
and `import https from 'https';` lines if nothing else in this file uses
`http`/`https` directly (check first — `path`, `fs`, `zlib`, `xmlJS` are
used elsewhere in the file and must stay).

Add near the top, with the other local imports:
```typescript
import { fetchUrlContent, type SendStatus } from './httpFetch';
```

Add a re-export right after that import (so `routes/sources.ts`'s
`import { fetchUrlContent, processAndMergeSources } from '../services/sources';`
keeps compiling unchanged):
```typescript
export { fetchUrlContent } from './httpFetch';
export type { SendStatus } from './httpFetch';
```

Find the dynamic-import workaround inside `processAndMergeSources` (the
comment block starting `// This MUST stay a dynamic import...` and the
line `const { selectPlaylistStrategy } = await import('./sourceStrategies');`).
Now that `fetchUrlContent`/`SendStatus` no longer live in `sources.ts`,
the circular dependency this workaround existed for is gone — replace it
with a normal static import. Delete the comment block and the dynamic
import line, then add a static import at the top of the file with the
other local imports:
```typescript
import { selectPlaylistStrategy } from './sourceStrategies';
```
And change the call site back to:
```typescript
const content = await selectPlaylistStrategy(source.type).fetchContent(source, settings, sendStatus);
```
(same line, just without the `const { selectPlaylistStrategy } =` destructure and `await import(...)` — the strategy call itself is unchanged).

In `backend/src/services/sourceStrategies/PlaylistSourceStrategy.ts`, find:
```typescript
import type { SendStatus } from '../sources';
```
Replace with:
```typescript
import type { SendStatus } from '../httpFetch';
```

In `backend/src/services/sourceStrategies/M3uFileStrategy.ts`, find:
```typescript
import type { SendStatus } from '../sources';
```
Replace with:
```typescript
import type { SendStatus } from '../httpFetch';
```

In `backend/src/services/sourceStrategies/M3uUrlStrategy.ts`, find:
```typescript
import { fetchUrlContent } from '../sources';
import type { SendStatus } from '../sources';
```
Replace with:
```typescript
import { fetchUrlContent } from '../httpFetch';
import type { SendStatus } from '../httpFetch';
```

In `backend/src/services/sourceStrategies/XtreamCodesStrategy.ts`, find the
same two lines and make the same replacement.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/httpFetch.test.ts`
Expected: PASS, both tests green.

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all suites green, including
`M3uUrlStrategy.test.ts`/`XtreamCodesStrategy.test.ts` (these are the two
files whose mocking setup the Phase 4 circular dependency threatened —
confirm in your report that they still pass now that they no longer
import anything from `sources.ts` at all).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/httpFetch.ts backend/src/services/__tests__/httpFetch.test.ts backend/src/services/sources.ts backend/src/services/sourceStrategies/PlaylistSourceStrategy.ts backend/src/services/sourceStrategies/M3uFileStrategy.ts backend/src/services/sourceStrategies/M3uUrlStrategy.ts backend/src/services/sourceStrategies/XtreamCodesStrategy.ts
git commit -m "refactor(backend): extract httpFetch.ts, break sources.ts/sourceStrategies circular dependency"
```

---

### Task 2: `IStreamHistoryRepository` and `KnexStreamHistoryRepository`

**Files:**
- Create: `backend/src/repositories/IStreamHistoryRepository.ts`
- Create: `backend/src/repositories/KnexStreamHistoryRepository.ts`
- Create: `backend/src/repositories/index.ts`
- Test: `backend/src/repositories/__tests__/KnexStreamHistoryRepository.test.ts`

**Interfaces:**
- Produces:
  - `interface CreateStreamHistoryInput { userId: number; username: string; channelId: string | null; channelName: string; startTime: string; status: string; clientIp: string; channelLogo: string | null; streamProfileName: string; }`
  - `interface IStreamHistoryRepository { create(input: CreateStreamHistoryInput): Promise<number>; endPlaying(historyId: number, startTime: string): Promise<void>; endUnconditional(historyId: number, startTime: string): Promise<void>; getStartTime(historyId: number, userId: number): Promise<string | undefined>; }`
  - `class KnexStreamHistoryRepository implements IStreamHistoryRepository`
  - `export const streamHistoryRepository: IStreamHistoryRepository` (singleton, from `backend/src/repositories/index.ts`)

- [ ] **Step 1: Write the failing test**

Create `backend/src/repositories/__tests__/KnexStreamHistoryRepository.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/connection';
import { insertAndGetId } from '../../db/helpers';
import { KnexStreamHistoryRepository } from '../KnexStreamHistoryRepository';

vi.mock('../../db/connection', () => ({ db: vi.fn() }));
vi.mock('../../db/helpers', () => ({ insertAndGetId: vi.fn() }));

describe('KnexStreamHistoryRepository', () => {
  let repo: KnexStreamHistoryRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new KnexStreamHistoryRepository();
  });

  it('create() delegates to insertAndGetId with snake_case columns', async () => {
    vi.mocked(insertAndGetId).mockResolvedValue(42);

    const id = await repo.create({
      userId: 1,
      username: 'alice',
      channelId: 'ch1',
      channelName: 'Channel 1',
      startTime: '2026-01-01T00:00:00.000Z',
      status: 'playing',
      clientIp: '127.0.0.1',
      channelLogo: null,
      streamProfileName: 'Default',
    });

    expect(id).toBe(42);
    expect(insertAndGetId).toHaveBeenCalledWith('stream_history', {
      user_id: 1,
      username: 'alice',
      channel_id: 'ch1',
      channel_name: 'Channel 1',
      start_time: '2026-01-01T00:00:00.000Z',
      status: 'playing',
      client_ip: '127.0.0.1',
      channel_logo: null,
      stream_profile_name: 'Default',
    });
  });

  it('endPlaying() updates the row filtered by id and status "playing"', async () => {
    const update = vi.fn().mockResolvedValue(1);
    const where = vi.fn().mockReturnValue({ update });
    vi.mocked(db).mockReturnValue({ where } as never);

    await repo.endPlaying(42, '2026-01-01T00:00:00.000Z');

    expect(db).toHaveBeenCalledWith('stream_history');
    expect(where).toHaveBeenCalledWith({ id: 42, status: 'playing' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
  });

  it('endUnconditional() updates the row filtered by id and a null end_time', async () => {
    const update = vi.fn().mockResolvedValue(1);
    const whereNull = vi.fn().mockReturnValue({ update });
    const where = vi.fn().mockReturnValue({ whereNull });
    vi.mocked(db).mockReturnValue({ where } as never);

    await repo.endUnconditional(42, '2026-01-01T00:00:00.000Z');

    expect(where).toHaveBeenCalledWith({ id: 42 });
    expect(whereNull).toHaveBeenCalledWith('end_time');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
  });

  it('getStartTime() returns start_time when a matching row exists', async () => {
    const first = vi.fn().mockResolvedValue({ start_time: '2026-01-01T00:00:00.000Z' });
    const where = vi.fn().mockReturnValue({ first });
    const select = vi.fn().mockReturnValue({ where });
    vi.mocked(db).mockReturnValue({ select } as never);

    const startTime = await repo.getStartTime(42, 1);

    expect(startTime).toBe('2026-01-01T00:00:00.000Z');
    expect(select).toHaveBeenCalledWith('start_time');
    expect(where).toHaveBeenCalledWith({ id: 42, user_id: 1 });
  });

  it('getStartTime() returns undefined when no row matches', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ first });
    const select = vi.fn().mockReturnValue({ where });
    vi.mocked(db).mockReturnValue({ select } as never);

    const startTime = await repo.getStartTime(999, 1);

    expect(startTime).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/repositories/__tests__/KnexStreamHistoryRepository.test.ts`
Expected: FAIL with a module-not-found error for `../KnexStreamHistoryRepository`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/repositories/IStreamHistoryRepository.ts`:
```typescript
export interface CreateStreamHistoryInput {
  userId: number;
  username: string;
  channelId: string | null;
  channelName: string;
  startTime: string;
  status: string;
  clientIp: string;
  channelLogo: string | null;
  streamProfileName: string;
}

export interface IStreamHistoryRepository {
  create(input: CreateStreamHistoryInput): Promise<number>;
  endPlaying(historyId: number, startTime: string): Promise<void>;
  endUnconditional(historyId: number, startTime: string): Promise<void>;
  getStartTime(historyId: number, userId: number): Promise<string | undefined>;
}
```

Create `backend/src/repositories/KnexStreamHistoryRepository.ts`:
```typescript
import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';
import type { CreateStreamHistoryInput, IStreamHistoryRepository } from './IStreamHistoryRepository';

export class KnexStreamHistoryRepository implements IStreamHistoryRepository {
  async create(input: CreateStreamHistoryInput): Promise<number> {
    return insertAndGetId('stream_history', {
      user_id: input.userId,
      username: input.username,
      channel_id: input.channelId,
      channel_name: input.channelName,
      start_time: input.startTime,
      status: input.status,
      client_ip: input.clientIp,
      channel_logo: input.channelLogo,
      stream_profile_name: input.streamProfileName,
    });
  }

  async endPlaying(historyId: number, startTime: string): Promise<void> {
    const endTime = new Date().toISOString();
    const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
    await db('stream_history')
      .where({ id: historyId, status: 'playing' })
      .update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
  }

  async endUnconditional(historyId: number, startTime: string): Promise<void> {
    const endTime = new Date().toISOString();
    const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
    await db('stream_history')
      .where({ id: historyId })
      .whereNull('end_time')
      .update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
  }

  async getStartTime(historyId: number, userId: number): Promise<string | undefined> {
    const row = await db('stream_history').select('start_time').where({ id: historyId, user_id: userId }).first();
    return row?.start_time;
  }
}
```

Create `backend/src/repositories/index.ts`:
```typescript
import { KnexStreamHistoryRepository } from './KnexStreamHistoryRepository';
import type { IStreamHistoryRepository } from './IStreamHistoryRepository';

export const streamHistoryRepository: IStreamHistoryRepository = new KnexStreamHistoryRepository();

export type { IStreamHistoryRepository, CreateStreamHistoryInput } from './IStreamHistoryRepository';
export { KnexStreamHistoryRepository } from './KnexStreamHistoryRepository';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/repositories/__tests__/KnexStreamHistoryRepository.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories
git commit -m "feat(backend): add IStreamHistoryRepository and KnexStreamHistoryRepository"
```

---

### Task 3: Migrate `stream.ts` to use `streamHistoryRepository`

**Files:**
- Modify: `backend/src/routes/stream.ts`
- Test: `backend/src/routes/__tests__/stream.cast-token.test.ts` (verify unaffected — this task doesn't add a new route-level test file; the repository's own behavior is already covered by Task 2's unit tests, and `stream.ts`'s other routes have no existing test coverage to extend safely without a larger effort — flag any gap you notice as a concern, don't add scope here)

**Interfaces:**
- Consumes: `streamHistoryRepository` from `../repositories` (Task 2).
- Produces: nothing new — `stream.ts`'s exported `streamRouter` is
  unchanged; only its internal `stream_history` access is redirected
  through the repository.

- [ ] **Step 1: Read the current file and confirm the 4 call sites**

Read `backend/src/routes/stream.ts` in full. Confirm these 4 places touch
`stream_history` directly (line numbers may have shifted slightly since
this plan was written — locate by content, not line number):
1. The local `updateStreamHistoryEnd(historyId, startTime)` helper function
   near the top of the file (wraps a conditional `status: 'playing'` update).
2. `insertAndGetId('stream_history', {...})` inside the `/stream` GET
   handler (after spawning ffmpeg).
3. `insertAndGetId('stream_history', {...})` inside
   `/api/activity/start-redirect`.
4. The `db('stream_history').select('start_time').where(...).first()` call
   plus the local `updateStreamHistoryEndUnconditional(historyId, startTime)`
   helper function, both inside `/api/activity/stop-redirect`.

There is no failing-test step for this task in the TDD sense — this is a
pure refactor of already-tested behavior (Task 2 unit-tests the
repository's SQL semantics; this task only changes what calls it). Verify
correctness via the full test suite staying green (Step 3) and via
`npm run typecheck` (Step 4), not via a new test.

- [ ] **Step 2: Write the implementation**

In `backend/src/routes/stream.ts`, remove these two imports:
```typescript
import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';
```
Add:
```typescript
import { streamHistoryRepository } from '../repositories';
```

Delete the local helper function:
```typescript
async function updateStreamHistoryEnd(historyId: number, startTime: string): Promise<void> {
  const endTime = new Date().toISOString();
  const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
  await db('stream_history').where({ id: historyId, status: 'playing' }).update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
}
```
Replace every call site that used it:
```typescript
await updateStreamHistoryEnd(info.historyId, info.startTime).catch((e) => console.error('[STREAM] Error updating history on exit:', e));
```
becomes
```typescript
await streamHistoryRepository.endPlaying(info.historyId, info.startTime).catch((e) => console.error('[STREAM] Error updating history on exit:', e));
```
and
```typescript
await updateStreamHistoryEnd(activeStreamInfo.historyId, activeStreamInfo.startTime);
```
becomes
```typescript
await streamHistoryRepository.endPlaying(activeStreamInfo.historyId, activeStreamInfo.startTime);
```

Replace both `insertAndGetId('stream_history', {...})` call sites. The
`/stream` handler's call:
```typescript
const historyId = await insertAndGetId('stream_history', {
  user_id: userId, username, channel_id: channelId, channel_name: channelName,
  start_time: startTime, status: 'playing', client_ip: clientIp, channel_logo: channelLogo, stream_profile_name: streamProfileName,
});
```
becomes
```typescript
const historyId = await streamHistoryRepository.create({
  userId, username, channelId, channelName,
  startTime, status: 'playing', clientIp, channelLogo, streamProfileName,
});
```
The `/api/activity/start-redirect` handler's call:
```typescript
const historyId = await insertAndGetId('stream_history', {
  user_id: userId, username, channel_id: channelId, channel_name: channelName,
  start_time: startTime, status: 'playing', client_ip: clientIp, channel_logo: channelLogo, stream_profile_name: 'Redirect',
});
```
becomes
```typescript
const historyId = await streamHistoryRepository.create({
  userId, username, channelId: channelId || null, channelName: channelName || '',
  startTime, status: 'playing', clientIp, channelLogo: channelLogo || null, streamProfileName: 'Redirect',
});
```
(Note: the original inserted `channel_id`/`channel_name`/`channel_logo`
directly from the possibly-`undefined` destructured request-body fields;
`CreateStreamHistoryInput`'s types are `string | null` for `channelId`/
`channelLogo` and `string` for `channelName`, matching the `|| null`/`|| ''`
fallbacks already used two lines below in the original for
`activeRedirectStreams.set(...)` — apply the same fallbacks here for type
correctness, this is a null-safety clarification, not a behavior change,
since Knex would have inserted `undefined` as `NULL` either way for the
nullable columns.)

In `/api/activity/stop-redirect`, replace:
```typescript
const row = await db('stream_history').select('start_time').where({ id: historyId, user_id: req.session.userId }).first();
if (!row) {
  return res.status(200).json({ success: true, message: 'Stream stopped, history record not found.' });
}
await updateStreamHistoryEndUnconditional(historyId, row.start_time);
```
with:
```typescript
const startTime = await streamHistoryRepository.getStartTime(historyId, req.session.userId as number);
if (startTime === undefined) {
  return res.status(200).json({ success: true, message: 'Stream stopped, history record not found.' });
}
await streamHistoryRepository.endUnconditional(historyId, startTime);
```

Delete the local helper function it replaced:
```typescript
async function updateStreamHistoryEndUnconditional(historyId: number, startTime: string): Promise<void> {
  const endTime = new Date().toISOString();
  const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
  await db('stream_history').where({ id: historyId }).whereNull('end_time').update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
}
```

- [ ] **Step 3: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS — all suites green, including
`stream.cast-token.test.ts` (unaffected by this task's changes, since it
only exercises the `/api/cast/generate-token` handler, which this task
doesn't touch).

- [ ] **Step 4: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors. This is the main correctness signal for this task —
it confirms every call site's argument shapes match
`IStreamHistoryRepository`'s methods, and that `db`/`insertAndGetId` are
no longer referenced anywhere in `stream.ts` (if either import becomes
unused-but-still-present, TypeScript won't flag it by default in this
project since `noUnusedLocals` isn't enabled — grep for `db(` and
`insertAndGetId` in the file yourself to confirm zero remaining
references, and report the grep output).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/stream.ts
git commit -m "refactor(backend): migrate stream.ts to streamHistoryRepository"
```

---

## Post-plan note for later phases

This plan's Task 2-3 pair is the template for the rest of Phase 5: pick
one bounded data-access concern in a route file, define an
`I<Noun>Repository` interface for it, implement it against Knex, migrate
the route to the singleton, delete the inline helper functions the route
used to carry. Future plans should apply this same shape to
`proxy.ts` (no DB access today — nothing to extract there yet), `sources.ts`'s
routes (settings/source CRUD), and `vod.ts` (VOD metadata queries) —
each as its own plan, not attempted together. `backend/src/repositories/`
is the stable home for every repository that follows.

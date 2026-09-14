# Connection Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a generic, async, Redis-ready `IConnectionHub<T>` store
interface (extending the same DI seam `IRemoteSessionHub` already
established for remote-control sessions), with an `InMemoryConnectionHub<T>`
implementation, and migrate the cast-token store (`activeCastTokens`) to use
it end-to-end as the reference pattern.

**Architecture:** `backend/src/services/connectionHub/` holds
`IConnectionHub<T>` (async get/set-with-TTL/delete/has/size/clear) and
`InMemoryConnectionHub<T>` (Map-backed, lazy per-key expiry, periodic sweep
— same idiom as `MemoryRemoteSessionHub`'s cleanup timer). `activeCastTokens`
in `backend/src/state/streamState.ts` is retyped from a raw
`Map<string, CastTokenData>` to `IConnectionHub<CastTokenData>`, backed by
`InMemoryConnectionHub` today and swappable for a Redis-backed
implementation later without touching any consumer. The two call sites that
read/write it (`backend/src/middleware/allowLocalOrAuth.ts`,
`backend/src/routes/stream.ts`'s `/api/cast/generate-token` handler) become
async and use the hub's built-in TTL instead of a hand-rolled
`setTimeout(() => ..., 6h)` cleanup.

`activeStreamProcesses`/`activeRedirectStreams` (hold a live
`ChildProcessWithoutNullStreams`) and `sseClients` (holds a live Express
`Response`) are explicitly **out of scope** for this plan — neither holds
serializable data, so wrapping them in `IConnectionHub<T>` today would be
cosmetic (no real backend could ever replace the in-memory one without a
larger redesign that splits "metadata" from "the live handle"). That split
is Phase 5's concern when the stream/SSE routes are extracted into
services, not this plan's.

**Tech Stack:** TypeScript, Vitest. No new runtime dependency — the hub is
in-memory only in this plan; a Redis-backed `IConnectionHub` implementation
is future work once an actual Redis dependency is introduced.

**Spec:** N/A — derived directly from the architecture review in this
conversation. See roadmap: `docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`
Phase 3.

## Global Constraints

- `IConnectionHub<T>`'s method surface: `get(key: string): Promise<T | undefined>`,
  `set(key: string, value: T, ttlMs?: number): Promise<void>`,
  `delete(key: string): Promise<void>`, `has(key: string): Promise<boolean>`,
  `size(): Promise<number>`, `clear(): Promise<void>`. Every method is
  `Promise`-returning even though the in-memory implementation resolves
  synchronously — this is what makes a future Redis-backed implementation
  a drop-in replacement with no consumer changes.
- `InMemoryConnectionHub`'s periodic sweep timer must call `.unref()` on
  itself so it never keeps the Node process alive on its own (a real
  service concern; also avoids leaking an open handle in tests that forget
  to call `destroy()`).
- Error/log messages and code identifiers stay in English.
- No default exports.
- No changes to `backend/tsconfig.json` compiler options.
- Follow the existing `backend/src/services/remote/` structure convention
  (`I<Name>.ts` for the interface, `<Impl><Name>.ts` for an implementation)
  for the new `backend/src/services/connectionHub/` directory.

---

### Task 1: `IConnectionHub<T>` interface and `InMemoryConnectionHub<T>` implementation

**Files:**
- Create: `backend/src/services/connectionHub/IConnectionHub.ts`
- Create: `backend/src/services/connectionHub/InMemoryConnectionHub.ts`
- Create: `backend/src/services/connectionHub/index.ts`
- Test: `backend/src/services/connectionHub/__tests__/InMemoryConnectionHub.test.ts`

**Interfaces:**
- Produces:
  - `interface IConnectionHub<T> { get(key: string): Promise<T | undefined>; set(key: string, value: T, ttlMs?: number): Promise<void>; delete(key: string): Promise<void>; has(key: string): Promise<boolean>; size(): Promise<number>; clear(): Promise<void>; }`
  - `class InMemoryConnectionHub<T> implements IConnectionHub<T> { constructor(sweepIntervalMs?: number); destroy(): void; }`
    — `destroy()` stops the sweep timer and clears all entries; call it in
    test teardown and, for a long-lived process singleton, never (the
    process owns it for its lifetime).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/connectionHub/__tests__/InMemoryConnectionHub.test.ts`:
```typescript
import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryConnectionHub } from '../InMemoryConnectionHub';

describe('InMemoryConnectionHub', () => {
  let hub: InMemoryConnectionHub<{ value: string }>;

  afterEach(() => {
    hub?.destroy();
    vi.useRealTimers();
  });

  it('stores and retrieves a value by key', async () => {
    hub = new InMemoryConnectionHub(0); // 0 disables the periodic sweep for this test
    await hub.set('a', { value: 'hello' });
    await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });
  });

  it('returns undefined for a missing key', async () => {
    hub = new InMemoryConnectionHub(0);
    await expect(hub.get('missing')).resolves.toBeUndefined();
  });

  it('deletes a key', async () => {
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: 'hello' });
    await hub.delete('a');
    await expect(hub.get('a')).resolves.toBeUndefined();
  });

  it('has() reflects presence and absence', async () => {
    hub = new InMemoryConnectionHub(0);
    await expect(hub.has('a')).resolves.toBe(false);
    await hub.set('a', { value: 'hello' });
    await expect(hub.has('a')).resolves.toBe(true);
  });

  it('size() counts stored entries', async () => {
    hub = new InMemoryConnectionHub(0);
    await expect(hub.size()).resolves.toBe(0);
    await hub.set('a', { value: '1' });
    await hub.set('b', { value: '2' });
    await expect(hub.size()).resolves.toBe(2);
  });

  it('clear() empties the store', async () => {
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: '1' });
    await hub.clear();
    await expect(hub.size()).resolves.toBe(0);
  });

  it('expires a value after its TTL elapses (lazy expiry on get)', async () => {
    vi.useFakeTimers();
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: 'hello' }, 1000);
    await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });

    vi.advanceTimersByTime(1001);

    await expect(hub.get('a')).resolves.toBeUndefined();
  });

  it('a value with no ttlMs never expires', async () => {
    vi.useFakeTimers();
    hub = new InMemoryConnectionHub(0);
    await hub.set('a', { value: 'hello' });

    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000); // 1 year

    await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });
  });

  it('destroy() can be called more than once without throwing', () => {
    hub = new InMemoryConnectionHub(0);
    expect(() => {
      hub.destroy();
      hub.destroy();
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/connectionHub/__tests__/InMemoryConnectionHub.test.ts`
Expected: FAIL with a module-not-found error for `../InMemoryConnectionHub`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/connectionHub/IConnectionHub.ts`:
```typescript
export interface IConnectionHub<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  size(): Promise<number>;
  clear(): Promise<void>;
}
```

Create `backend/src/services/connectionHub/InMemoryConnectionHub.ts`:
```typescript
import type { IConnectionHub } from './IConnectionHub';

interface Entry<T> {
  value: T;
  expiresAt: number | null;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export class InMemoryConnectionHub<T> implements IConnectionHub<T> {
  private entries = new Map<string, Entry<T>>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(sweepIntervalMs: number = DEFAULT_SWEEP_INTERVAL_MS) {
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweepExpired(), sweepIntervalMs);
      this.sweepTimer.unref();
    }
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.entries.clear();
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
    this.entries.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async size(): Promise<number> {
    return this.entries.size;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  private isExpired(entry: Entry<T>): boolean {
    return entry.expiresAt !== null && entry.expiresAt < Date.now();
  }

  private sweepExpired(): void {
    for (const [key, entry] of this.entries.entries()) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
      }
    }
  }
}
```

Create `backend/src/services/connectionHub/index.ts`:
```typescript
export type { IConnectionHub } from './IConnectionHub';
export { InMemoryConnectionHub } from './InMemoryConnectionHub';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/connectionHub/__tests__/InMemoryConnectionHub.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/connectionHub
git commit -m "feat(backend): add IConnectionHub interface and InMemoryConnectionHub implementation"
```

---

### Task 2: Retype `activeCastTokens` as `IConnectionHub<CastTokenData>`

**Files:**
- Modify: `backend/src/state/streamState.ts`
- Test: `backend/src/state/__tests__/streamState.test.ts`

**Interfaces:**
- Consumes: `IConnectionHub`, `InMemoryConnectionHub` from
  `../services/connectionHub` (Task 1).
- Produces: `export const activeCastTokens: IConnectionHub<CastTokenData>`
  — same exported name, now backed by `InMemoryConnectionHub` instead of a
  raw `Map`. `CastTokenData`'s existing shape
  (`{ userId, streamUrl, expiresAt, createdAt }`) is unchanged.

`activeStreamProcesses` and `activeRedirectStreams` in this same file are
**not** touched by this task (see the plan's Architecture section for why).

- [ ] **Step 1: Write the failing test**

Create `backend/src/state/__tests__/streamState.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { activeCastTokens } from '../streamState';

describe('activeCastTokens', () => {
  afterEach(async () => {
    await activeCastTokens.clear();
  });

  it('conforms to the IConnectionHub async interface', async () => {
    await activeCastTokens.set('token-1', { userId: 1, streamUrl: 'http://example.com/a.ts', expiresAt: Date.now() + 1000, createdAt: Date.now() });
    await expect(activeCastTokens.get('token-1')).resolves.toMatchObject({ userId: 1, streamUrl: 'http://example.com/a.ts' });
    await expect(activeCastTokens.has('token-1')).resolves.toBe(true);
    await activeCastTokens.delete('token-1');
    await expect(activeCastTokens.get('token-1')).resolves.toBeUndefined();
  });

  it('supports the hub TTL feature for automatic cast-token expiry', async () => {
    await activeCastTokens.set('token-2', { userId: 1, streamUrl: 'http://example.com/a.ts', expiresAt: Date.now() + 1000, createdAt: Date.now() }, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(activeCastTokens.get('token-2')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/state/__tests__/streamState.test.ts`
Expected: FAIL — `activeCastTokens` is still a raw `Map`, so `.get()`/`.has()`
don't return Promises and `.set()` doesn't accept a third `ttlMs` argument
(TypeScript compile error surfaces this before the test even runs; run
`cd backend && npm run typecheck` alongside the test and note both outputs).

- [ ] **Step 3: Write the implementation**

In `backend/src/state/streamState.ts`, add the import near the top:
```typescript
import { InMemoryConnectionHub } from '../services/connectionHub';
import type { IConnectionHub } from '../services/connectionHub';
```

Find:
```typescript
export const activeStreamProcesses = new Map<string, ActiveStreamInfo>();
export const activeRedirectStreams = new Map<string, ActiveRedirectStreamInfo>();
export const activeCastTokens = new Map<string, CastTokenData>();
```

Replace with:
```typescript
export const activeStreamProcesses = new Map<string, ActiveStreamInfo>();
export const activeRedirectStreams = new Map<string, ActiveRedirectStreamInfo>();
export const activeCastTokens: IConnectionHub<CastTokenData> = new InMemoryConnectionHub<CastTokenData>();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/state/__tests__/streamState.test.ts`
Expected: PASS, both tests green.

Run: `cd backend && npm run typecheck`
Expected: this will now surface every call site that still uses the old
synchronous `Map` API on `activeCastTokens` — Tasks 3 and 4 fix those. It
is expected and fine for typecheck to show errors in
`backend/src/middleware/allowLocalOrAuth.ts` and `backend/src/routes/stream.ts`
at this point; do not fix them in this task. Note the exact error list in
your report so Tasks 3-4 can be dispatched with confidence nothing else
broke.

- [ ] **Step 5: Commit**

```bash
git add backend/src/state/streamState.ts backend/src/state/__tests__/streamState.test.ts
git commit -m "refactor(backend): back activeCastTokens with IConnectionHub"
```

---

### Task 3: Migrate `allowLocalOrAuth.ts` to the async `CastTokenStore`

**Files:**
- Modify: `backend/src/middleware/allowLocalOrAuth.ts`
- Test: `backend/src/middleware/__tests__/allowLocalOrAuth.test.ts`

**Interfaces:**
- Consumes: nothing new directly — `CastTokenStore`'s method signatures
  become `Promise`-returning so that `IConnectionHub<CastTokenData>`
  (Task 2) satisfies it structurally (extra fields/methods on
  `CastTokenData`/`IConnectionHub` don't break assignability).
- Produces: `export function allowLocalOrAuth(castTokens: CastTokenStore = emptyCastTokenStore)`
  — same exported name and default, `CastTokenStore`'s `get`/`delete` are
  now `async`, and the returned Express middleware is now an `async`
  function so it can `await` them.

This task starts from the typecheck errors Task 2 surfaced. Read the full
current file first — its local `CastTokenStore` interface is intentionally
narrower than `IConnectionHub<CastTokenData>` (only `get`/`delete`, and a
smaller value shape), which is correct and should stay narrow; only make
the two methods async.

- [ ] **Step 1: Write the failing test**

Create `backend/src/middleware/__tests__/allowLocalOrAuth.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { allowLocalOrAuth, type CastTokenStore } from '../allowLocalOrAuth';

function buildApp(castTokens?: CastTokenStore) {
  const app = express();
  app.use(allowLocalOrAuth(castTokens));
  app.get('/protected', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('allowLocalOrAuth', () => {
  it('allows the request through when the cast token resolves to valid data', async () => {
    const store: CastTokenStore = {
      get: vi.fn(async (token: string) => (token === 'good-token' ? { userId: 42, expiresAt: Date.now() + 60_000 } : undefined)),
      delete: vi.fn(async () => {}),
    };

    const res = await request(buildApp(store)).get('/protected?castToken=good-token');

    expect(res.status).toBe(200);
    expect(store.get).toHaveBeenCalledWith('good-token');
  });

  it('rejects with 401 when the cast token is unknown', async () => {
    const store: CastTokenStore = {
      get: vi.fn(async () => undefined),
      delete: vi.fn(async () => {}),
    };

    const res = await request(buildApp(store)).get('/protected?castToken=bad-token');

    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid cast token');
  });

  it('rejects with 401 and deletes the token when it has expired', async () => {
    const store: CastTokenStore = {
      get: vi.fn(async () => ({ userId: 1, expiresAt: Date.now() - 1000 })),
      delete: vi.fn(async () => {}),
    };

    const res = await request(buildApp(store)).get('/protected?castToken=expired-token');

    expect(res.status).toBe(401);
    expect(res.text).toContain('Expired cast token');
    expect(store.delete).toHaveBeenCalledWith('expired-token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/middleware/__tests__/allowLocalOrAuth.test.ts`
Expected: FAIL — with the current synchronous `CastTokenStore` type, a
`vi.fn(async () => ...)` mock is not assignable (TypeScript compile error)
or, if TS allows it loosely, the middleware calls `castTokens.get(token)`
without `await`, so `tokenData` is a `Promise` object (always truthy) and
none of the response-status assertions match the real logic — either way
the test fails.

- [ ] **Step 3: Write the implementation**

In `backend/src/middleware/allowLocalOrAuth.ts`, find:
```typescript
export interface CastTokenStore {
  get(token: string): { userId: number; username?: string; expiresAt: number } | undefined;
  delete(token: string): void;
}

const emptyCastTokenStore: CastTokenStore = {
  get: () => undefined,
  delete: () => {},
};

export function allowLocalOrAuth(castTokens: CastTokenStore = emptyCastTokenStore) {
  return (req: Request, res: Response, next: NextFunction) => {
```

Replace with:
```typescript
export interface CastTokenStore {
  get(token: string): Promise<{ userId: number; username?: string; expiresAt: number } | undefined>;
  delete(token: string): Promise<void>;
}

const emptyCastTokenStore: CastTokenStore = {
  get: async () => undefined,
  delete: async () => {},
};

export function allowLocalOrAuth(castTokens: CastTokenStore = emptyCastTokenStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
```

Find:
```typescript
    const castToken = req.query.castToken as string | undefined;
    if (castToken) {
      const tokenData = castTokens.get(castToken);
      if (!tokenData) {
        setCorsHeaders();
        console.warn(`[STREAM_AUTH] Invalid cast token: ${castToken.substring(0, 8)}...`);
        return res.status(401).send('Invalid cast token');
      }
      if (tokenData.expiresAt < Date.now()) {
        setCorsHeaders();
        console.warn(`[STREAM_AUTH] Expired cast token: ${castToken.substring(0, 8)}...`);
        castTokens.delete(castToken);
        return res.status(401).send('Expired cast token');
      }
```

Replace with:
```typescript
    const castToken = req.query.castToken as string | undefined;
    if (castToken) {
      const tokenData = await castTokens.get(castToken);
      if (!tokenData) {
        setCorsHeaders();
        console.warn(`[STREAM_AUTH] Invalid cast token: ${castToken.substring(0, 8)}...`);
        return res.status(401).send('Invalid cast token');
      }
      if (tokenData.expiresAt < Date.now()) {
        setCorsHeaders();
        console.warn(`[STREAM_AUTH] Expired cast token: ${castToken.substring(0, 8)}...`);
        await castTokens.delete(castToken);
        return res.status(401).send('Expired cast token');
      }
```

The rest of the function (local-IP allowlist branch, final 401) has no
`castTokens` calls and needs no change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/middleware/__tests__/allowLocalOrAuth.test.ts`
Expected: PASS, all 3 tests green.

Run: `cd backend && npm run typecheck`
Expected: the errors on this file from Task 2's typecheck run are gone;
`backend/src/routes/stream.ts` errors (if any) remain until Task 4.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/allowLocalOrAuth.ts backend/src/middleware/__tests__/allowLocalOrAuth.test.ts
git commit -m "refactor(backend): make allowLocalOrAuth's CastTokenStore async"
```

---

### Task 4: Migrate `stream.ts`'s cast-token generation to the hub's built-in TTL

**Files:**
- Modify: `backend/src/routes/stream.ts`
- Modify: `backend/src/routes/__tests__/stream.cast-token.test.ts`

**Interfaces:**
- Consumes: `activeCastTokens: IConnectionHub<CastTokenData>` from
  `../state/streamState` (Task 2).
- Produces: nothing new — this is the last call site that still used the
  old synchronous `Map` API and the manual `setTimeout` cleanup.

This task also resolves a previously-deferred minor finding from the
Error Handling Foundation plan's final review: the existing
`stream.cast-token.test.ts`'s success-case test registered a real 6-hour
`setTimeout` via the old manual cleanup code. Removing that cleanup in
favor of the hub's built-in TTL eliminates the timer entirely — no test
changes are needed to fix it, it disappears as a side effect of this
task's production-code change.

- [ ] **Step 1: Write the failing test**

Add this test case to the existing `describe('POST /api/cast/generate-token', ...)`
block in `backend/src/routes/__tests__/stream.cast-token.test.ts` (keep the
two existing tests unchanged):
```typescript
  it('stores the token in activeCastTokens with a 6-hour TTL, no manual cleanup timer', async () => {
    const { activeCastTokens } = await import('../../state/streamState');
    const res = await request(buildApp())
      .post('/api/cast/generate-token')
      .send({ streamUrl: 'http://example.com/stream.ts' });

    expect(res.status).toBe(200);
    const stored = await activeCastTokens.get(res.body.token);
    expect(stored).toMatchObject({ userId: 1, streamUrl: 'http://example.com/stream.ts' });
  });
```
Add the import at the top of the file if a static import of `activeCastTokens`
is cleaner given the file's existing import style — either a dynamic
`await import(...)` inside the test (shown above) or a static
`import { activeCastTokens } from '../../state/streamState';` at the top
works; prefer whichever matches this file's existing conventions once you
read it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/routes/__tests__/stream.cast-token.test.ts`
Expected: FAIL — the current handler still calls the old synchronous
`activeCastTokens.set(token, {...})` (two-argument form, no TTL), which
TypeScript now rejects per Task 2's retyping (or, if it somehow still
compiles loosely, the test's `await activeCastTokens.get(...)` won't match
because the handler's `.set()` call bypasses the hub's `Promise`-based API
entirely). Run `cd backend && npm run typecheck` alongside and note the
exact compile error in your report.

- [ ] **Step 3: Write the implementation**

In `backend/src/routes/stream.ts`, find:
```typescript
streamRouter.post('/api/cast/generate-token', requireAuth, (req, res, next) => {
  try {
    const { streamUrl } = req.body as { streamUrl?: string };
    const userId = req.session.userId as number;
    if (!streamUrl) {
      throw new ValidationError('streamUrl is required');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
    activeCastTokens.set(token, { userId, streamUrl, expiresAt, createdAt: Date.now() });

    setTimeout(() => {
      activeCastTokens.delete(token);
      console.log(`[CAST_TOKEN] Token expired and removed: ${token.substring(0, 8)}...`);
    }, 6 * 60 * 60 * 1000);

    console.log(`[CAST_TOKEN] Generated token for user ${userId}, expires in 6 hours`);
    res.json({ token });
  } catch (error) {
    next(error);
  }
});
```

Replace with:
```typescript
streamRouter.post('/api/cast/generate-token', requireAuth, async (req, res, next) => {
  try {
    const { streamUrl } = req.body as { streamUrl?: string };
    const userId = req.session.userId as number;
    if (!streamUrl) {
      throw new ValidationError('streamUrl is required');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const ttlMs = 6 * 60 * 60 * 1000;
    await activeCastTokens.set(token, { userId, streamUrl, expiresAt: Date.now() + ttlMs, createdAt: Date.now() }, ttlMs);

    console.log(`[CAST_TOKEN] Generated token for user ${userId}, expires in 6 hours`);
    res.json({ token });
  } catch (error) {
    next(error);
  }
});
```

Note what changed: the handler is now `async`, the manual `setTimeout`
cleanup is gone (the hub's own TTL — passed as the third argument to
`set()` — handles expiry), and the console log message is unchanged so
existing log-based tooling/greps for `[CAST_TOKEN]` keep working.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/routes/__tests__/stream.cast-token.test.ts`
Expected: PASS, all 3 tests green (the 2 pre-existing ones plus the new one).

Run: `cd backend && npm run typecheck`
Expected: clean — no errors anywhere in the backend now that all 3 call
sites (`streamState.ts`, `allowLocalOrAuth.ts`, `stream.ts`) use the async
`IConnectionHub` API consistently.

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all suites green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/stream.ts backend/src/routes/__tests__/stream.cast-token.test.ts
git commit -m "refactor(backend): generate cast tokens through activeCastTokens' hub TTL"
```

---

## Post-plan note for later phases

This plan deliberately migrated only `activeCastTokens` — the one piece of
state in `streamState.ts`/`sseState.ts` that is plain, serializable data
with natural TTL semantics. `activeStreamProcesses`, `activeRedirectStreams`,
and `sseClients` all hold live runtime handles (a `ChildProcess`, an Express
`Response`) that cannot be swapped for a remote store as-is. When Phase 5
extracts the stream/SSE routes into services, the right move for those is
usually to split them into two things behind one API: an `IConnectionHub`-
backed *metadata* record (what a Redis-backed dashboard/admin view would
need — user, channel, start time, reference count) plus a purely local,
in-process map from the same key to the live handle that metadata
describes. That split is out of scope here; this plan only proves the
primitive and its one clean use case.

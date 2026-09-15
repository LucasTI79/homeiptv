# Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the DB-portability already built into `backend/src/db/knexfile.ts`
(`DB_CLIENT` = `better-sqlite3` | `pg` | `mysql2`) actually works against a
real Postgres, using testcontainers rather than trusting it by inspection.
Extract the existing `InMemoryConnectionHub` unit test into a reusable
`IConnectionHub<T>` contract suite so a future Redis implementation gets
correctness coverage for free. Close the route-level test gap Phase 5's
final review flagged in `backend/src/routes/stream.ts`.

**Architecture:** `backend/src/db/__tests__/migrations.postgres.integration.test.ts`
starts a real `postgres:16-alpine` container via `testcontainers`, runs the
project's actual `knex migrate:latest` CLI command against it (the same
command a real deployment runs — not a hand-rolled in-process migration
runner, so this test exercises the real path), then asserts the resulting
schema has every table/column the migrations define. This is deliberately
**not** part of the default `npm test` run: it needs Docker and takes
seconds to start a container, so it lives behind a separate
`npm run test:integration` script and its own `vitest.integration.config.ts`,
excluded from the default config's `include`.

`backend/src/services/connectionHub/__tests__/connectionHubContract.ts`
holds one exported function, `runConnectionHubContract(name, createHub)`,
containing the implementation-agnostic behavioral assertions
(`get`/`set`/`delete`/`has`/`size`/`clear`) every `IConnectionHub<T>` must
satisfy. `InMemoryConnectionHub.test.ts` calls it instead of duplicating
those assertions inline, and keeps its own TTL/`destroy()` tests (neither
is part of the `IConnectionHub` interface itself, so they don't belong in
the shared contract). A future Redis-backed implementation calls the same
function with its own factory and inherits the same correctness bar.

`backend/src/routes/__tests__/stream.activity.test.ts` adds supertest
coverage for `POST /api/stream/stop`, `POST /api/activity/start-redirect`,
and `POST /api/activity/stop-redirect` — the three `stream.ts` routes that
only touch `streamHistoryRepository` and in-memory `Map` state, no child
process spawning. The `/stream` GET/HEAD handlers (which spawn a real
`ffmpeg` process) are explicitly out of scope: testing them needs a
process-spawning mock layer that's a plan of its own, not a task bolted
onto this one.

**Tech Stack:** TypeScript, Vitest, testcontainers (new devDependency),
Docker (must be running on the machine executing the integration test).

**Spec:** N/A — derived from the roadmap's Phase 7 description. See
roadmap: `docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`.

**Scope note:** The roadmap's Phase 7 line also mentions MySQL parity and a
contract suite "that runs against both `MemoryRemoteSessionHub` and
`IConnectionHub` implementations." MySQL parity is deferred — Postgres is
the higher-value target (it's the natural production upgrade path from
SQLite for this project) and the testcontainers pattern this plan
establishes is copy-paste for a MySQL variant later. `IRemoteSessionHub`
and `IConnectionHub` are different interfaces with only one implementation
each today; a single contract suite can't meaningfully span two unrelated
interfaces, so this plan builds the reusable contract for `IConnectionHub`
(the one explicitly designed as a "swap in Redis later" seam) and leaves
`IRemoteSessionHub`'s own contract extraction as follow-up work using the
identical pattern once/if a second implementation exists to justify it.

## Global Constraints

- `testcontainers` is a new devDependency — the one exception to prior
  phases' "no new deps" rule, since real container-backed DB parity testing
  is the explicit point of this phase.
- The testcontainers integration test must NOT be part of the default
  `npm test` run (it needs Docker and is slow) — it runs only via
  `npm run test:integration`, gated behind its own vitest config.
- The migration parity test drives the actual `knex migrate:latest` CLI
  command (the same one `npm run migrate` uses), not a hand-rolled
  in-process migration runner — this is what makes it a genuine proof that
  Postgres works, not just that the migration files parse.
- `runConnectionHubContract`'s assertions must only exercise
  `IConnectionHub<T>`'s actual interface surface (`get`/`set`/`delete`/
  `has`/`size`/`clear`) — no TTL or `destroy()` behavior, since those aren't
  part of the interface and a future implementation (e.g. Redis, where TTL
  is native to the store) may implement them completely differently.
- English messages/identifiers. No default exports. No `tsconfig.json`
  changes. No changes to existing migration files or the `stream_history`/
  other table schemas.

---

### Task 1: Postgres migration parity test via testcontainers

**Files:**
- Modify: `backend/package.json` (add `testcontainers` devDependency, add `test:integration` script)
- Create: `backend/vitest.integration.config.ts`
- Modify: `backend/vitest.config.ts` (exclude `*.integration.test.ts` from the default run)
- Create: `backend/src/db/__tests__/migrations.postgres.integration.test.ts`

**Interfaces:**
- Produces: nothing consumed by other tasks — this is a standalone test file.
- Consumes: the project's own `src/db/migrations/*.ts` files and `npm run migrate`'s underlying `knex migrate:latest --knexfile src/db/knexfile.ts` command, run as a child process.

- [x] **Step 1: Add the `testcontainers` devDependency**

Run: `cd backend && npm install --save-dev testcontainers@^10.13.0`
Expected: `backend/package.json`'s `devDependencies` gains `"testcontainers": "^10.13.0"` (or whatever exact version npm resolves — record the actual installed version in your report), and the root `package-lock.json` updates (this is an npm workspaces monorepo with a single root lockfile — do not create a separate `backend/package-lock.json`).

- [x] **Step 2: Split the vitest config so the integration test is opt-in**

Modify `backend/vitest.config.ts` to exclude integration tests from the default run:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/**/*.integration.test.ts'],
  },
});
```

Create `backend/vitest.integration.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
```

In `backend/package.json`'s `scripts`, add next to `"test:watch"`:
```json
"test:integration": "vitest run --config vitest.integration.config.ts",
```

- [x] **Step 3: Write the integration test**

Create `backend/src/db/__tests__/migrations.postgres.integration.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import knexFactory, { type Knex } from 'knex';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);
// This file lives at backend/src/db/__tests__/ -- three levels up is backend/,
// which is where package.json and the knexfile's relative path resolve from.
const BACKEND_ROOT = path.join(__dirname, '../../..');

describe('Postgres migration parity (testcontainers)', () => {
  let container: StartedTestContainer;
  let knex: Knex;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'viniplay_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    const connectionString = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/viniplay_test`;

    // Run the actual migrate command a real Postgres deployment would run --
    // not a hand-rolled in-process migration runner -- so this test proves
    // the real path works, not just that the migration files parse.
    await execFileAsync('npx', ['knex', 'migrate:latest', '--knexfile', 'src/db/knexfile.ts'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DB_CLIENT: 'pg', DB_CONNECTION: connectionString },
    });

    knex = knexFactory({ client: 'pg', connection: connectionString });
  }, 120000);

  afterAll(async () => {
    await knex?.destroy();
    await container?.stop();
  });

  it('creates every table the initial schema migration defines', async () => {
    const expectedTables = [
      'users', 'user_settings', 'multiview_layouts', 'notifications',
      'push_subscriptions', 'notification_deliveries', 'dvr_jobs',
      'dvr_recordings', 'movies', 'series', 'episodes', 'vod_categories',
      'provider_movie_relations', 'provider_series_relations',
      'provider_episode_relations', 'stream_history',
    ];

    for (const table of expectedTables) {
      await expect(knex.schema.hasTable(table)).resolves.toBe(true);
    }
  });

  it('applies the duration_secs migration to movies and episodes', async () => {
    await expect(knex.schema.hasColumn('movies', 'duration_secs')).resolves.toBe(true);
    await expect(knex.schema.hasColumn('episodes', 'duration_secs')).resolves.toBe(true);
  });

  it('records both migrations as applied in knex_migrations', async () => {
    const rows = await knex<{ name: string }>('knex_migrations').select('name');
    const names = rows.map((r) => r.name);

    expect(names).toContain('20260901120000_initial_schema.ts');
    expect(names).toContain('20260913120000_add_duration_secs.ts');
  });
});
```

- [x] **Step 4: Run it**

Run: `cd backend && npm run test:integration`
Expected: PASS, all 3 tests green. This requires Docker to be running and
able to pull `postgres:16-alpine` — if Docker isn't available in your
environment, note that explicitly in your report rather than silently
skipping verification; do not mark this task DONE without having actually
seen it pass at least once.

Run: `cd backend && npm test`
Expected: PASS, same file count as before this task (confirms the
integration test is correctly excluded from the default run — grep the
output or count test files to verify `migrations.postgres.integration.test.ts`
is NOT among them).

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add backend/package.json ../package-lock.json backend/vitest.config.ts backend/vitest.integration.config.ts backend/src/db/__tests__/migrations.postgres.integration.test.ts
git commit -m "test(backend): add testcontainers Postgres migration parity test"
```
(Adjust the `package-lock.json` path in the `git add` if your `pwd` differs
— it's the repo root's lockfile, one level up from `backend/`.)

---

### Task 2: Reusable `IConnectionHub` contract test

**Files:**
- Create: `backend/src/services/connectionHub/__tests__/connectionHubContract.ts`
- Modify: `backend/src/services/connectionHub/__tests__/InMemoryConnectionHub.test.ts`

**Interfaces:**
- Produces: `export function runConnectionHubContract(implementationName: string, createHub: () => IConnectionHub<{ value: string }>): void`
- Consumes: `IConnectionHub<T>` from `../IConnectionHub` (Phase 3, unchanged).

- [x] **Step 1: Write the contract module**

Create `backend/src/services/connectionHub/__tests__/connectionHubContract.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { IConnectionHub } from '../IConnectionHub';

// Shared behavioral contract every IConnectionHub<T> implementation must
// satisfy, regardless of backing store (in-memory today, Redis or another
// store later). Call this from an implementation's own test file with a
// factory that returns a fresh instance per test. Deliberately excludes
// TTL and any implementation-specific lifecycle methods (e.g. destroy()) --
// those aren't part of IConnectionHub<T> itself, so a future backing store
// may implement them completely differently.
export function runConnectionHubContract(
  implementationName: string,
  createHub: () => IConnectionHub<{ value: string }>
): void {
  describe(`${implementationName} (IConnectionHub contract)`, () => {
    it('stores and retrieves a value by key', async () => {
      const hub = createHub();
      await hub.set('a', { value: 'hello' });
      await expect(hub.get('a')).resolves.toEqual({ value: 'hello' });
    });

    it('returns undefined for a missing key', async () => {
      const hub = createHub();
      await expect(hub.get('missing')).resolves.toBeUndefined();
    });

    it('deletes a key', async () => {
      const hub = createHub();
      await hub.set('a', { value: 'hello' });
      await hub.delete('a');
      await expect(hub.get('a')).resolves.toBeUndefined();
    });

    it('deleting a key that was never set does not throw', async () => {
      const hub = createHub();
      await expect(hub.delete('missing')).resolves.toBeUndefined();
    });

    it('has() reflects presence and absence', async () => {
      const hub = createHub();
      await expect(hub.has('a')).resolves.toBe(false);
      await hub.set('a', { value: 'hello' });
      await expect(hub.has('a')).resolves.toBe(true);
    });

    it('size() counts stored entries', async () => {
      const hub = createHub();
      await expect(hub.size()).resolves.toBe(0);
      await hub.set('a', { value: '1' });
      await hub.set('b', { value: '2' });
      await expect(hub.size()).resolves.toBe(2);
    });

    it('setting the same key twice overwrites the value without changing size', async () => {
      const hub = createHub();
      await hub.set('a', { value: '1' });
      await hub.set('a', { value: '2' });
      await expect(hub.get('a')).resolves.toEqual({ value: '2' });
      await expect(hub.size()).resolves.toBe(1);
    });

    it('clear() empties the store', async () => {
      const hub = createHub();
      await hub.set('a', { value: '1' });
      await hub.set('b', { value: '2' });
      await hub.clear();
      await expect(hub.size()).resolves.toBe(0);
      await expect(hub.has('a')).resolves.toBe(false);
    });
  });
}
```

- [x] **Step 2: Wire `InMemoryConnectionHub.test.ts` to use it**

Read `backend/src/services/connectionHub/__tests__/InMemoryConnectionHub.test.ts`
first. Replace its first six `it(...)` blocks (`'stores and retrieves...'`
through `'clear() empties the store'`) with a single call to the shared
contract, keeping the `describe`, the `hub` variable, the `afterEach`, and
every test from `'expires a value after its TTL elapses...'` onward
unchanged:
```typescript
import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryConnectionHub } from '../InMemoryConnectionHub';
import { runConnectionHubContract } from './connectionHubContract';

describe('InMemoryConnectionHub', () => {
  let hub: InMemoryConnectionHub<{ value: string }>;

  afterEach(() => {
    hub?.destroy();
    vi.useRealTimers();
  });

  runConnectionHubContract('InMemoryConnectionHub', () => {
    hub = new InMemoryConnectionHub(0); // 0 disables the periodic sweep for these tests
    return hub;
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

- [x] **Step 3: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/connectionHub`
Expected: PASS — the contract's 8 tests plus the 3 TTL/destroy tests, all
green (11 total, up from the original file's 9, since the contract adds 2
new assertions: "deleting a missing key" and "overwriting a key").

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [x] **Step 4: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS — no regressions elsewhere.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/connectionHub
git commit -m "test(backend): extract reusable IConnectionHub contract test"
```

---

### Task 3: Supertest coverage for `stream.ts`'s stop/redirect routes

**Files:**
- Create: `backend/src/routes/__tests__/stream.activity.test.ts`

**Interfaces:**
- Consumes: `streamHistoryRepository` (mocked), `activeStreamProcesses`,
  `activeRedirectStreams` from `backend/src/state/streamState.ts` (real,
  directly manipulated by the test), `streamRouter` from
  `backend/src/routes/stream.ts` (real, unmocked).
- Produces: nothing new — this is test-only, closing the coverage gap
  Phase 5's final review flagged.

- [x] **Step 1: Write the tests**

Create `backend/src/routes/__tests__/stream.activity.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1, username: 'alice' };
    next();
  },
}));

const createMock = vi.fn();
const endPlayingMock = vi.fn();
const endUnconditionalMock = vi.fn();
const getStartTimeMock = vi.fn();
vi.mock('../../repositories', () => ({
  streamHistoryRepository: {
    create: createMock,
    endPlaying: endPlayingMock,
    endUnconditional: endUnconditionalMock,
    getStartTime: getStartTimeMock,
  },
}));

import { streamRouter } from '../stream';
import { activeStreamProcesses, activeRedirectStreams } from '../../state/streamState';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(streamRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /api/stream/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeStreamProcesses.clear();
  });

  it('returns 400 when url is missing', async () => {
    const res = await request(buildApp()).post('/api/stream/stop').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Stream URL is required to stop the stream.' });
  });

  it('returns success with a no-op message when no active stream matches', async () => {
    const res = await request(buildApp()).post('/api/stream/stop').send({ url: 'http://example.com/x.ts', profileId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'No active stream to stop.' });
  });

  it('keeps the stream alive without killing the process when references > 1', async () => {
    const kill = vi.fn();
    activeStreamProcesses.set('1::http://example.com/x.ts::p1', {
      process: { kill } as any, references: 2, lastAccess: Date.now(), userId: 1, username: 'alice',
      channelId: null, channelName: 'X', channelLogo: null, streamProfileName: 'p1',
      startTime: '2026-01-01T00:00:00.000Z', historyId: 42, clientIp: '127.0.0.1',
      streamKey: '1::http://example.com/x.ts::p1', isTranscoded: true,
    });

    const res = await request(buildApp()).post('/api/stream/stop').send({ url: 'http://example.com/x.ts', profileId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Stream kept alive for other active clients.' });
    expect(kill).not.toHaveBeenCalled();
  });

  it('kills the process, ends history, and removes the entry when it is the last reference', async () => {
    const kill = vi.fn();
    endPlayingMock.mockResolvedValue(undefined);
    activeStreamProcesses.set('1::http://example.com/x.ts::p1', {
      process: { kill } as any, references: 1, lastAccess: Date.now(), userId: 1, username: 'alice',
      channelId: null, channelName: 'X', channelLogo: null, streamProfileName: 'p1',
      startTime: '2026-01-01T00:00:00.000Z', historyId: 42, clientIp: '127.0.0.1',
      streamKey: '1::http://example.com/x.ts::p1', isTranscoded: true,
    });

    const res = await request(buildApp()).post('/api/stream/stop').send({ url: 'http://example.com/x.ts', profileId: 'p1' });

    expect(res.status).toBe(200);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(endPlayingMock).toHaveBeenCalledWith(42, '2026-01-01T00:00:00.000Z');
    expect(activeStreamProcesses.has('1::http://example.com/x.ts::p1')).toBe(false);
  });
});

describe('POST /api/activity/start-redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeRedirectStreams.clear();
  });

  it('creates a history row, tracks the redirect stream, and returns the historyId', async () => {
    createMock.mockResolvedValue(99);

    const res = await request(buildApp())
      .post('/api/activity/start-redirect')
      .send({ streamUrl: 'http://example.com/x.ts', channelId: 'ch1', channelName: 'Channel 1', channelLogo: 'logo.png' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, historyId: 99 });
    expect(createMock).toHaveBeenCalledWith({
      userId: 1, username: 'alice', channelId: 'ch1', channelName: 'Channel 1',
      startTime: expect.any(String), status: 'playing', clientIp: expect.any(String),
      channelLogo: 'logo.png', streamProfileName: 'Redirect',
    });
    expect(activeRedirectStreams.has('1::99')).toBe(true);
  });

  it('falls back to null for missing optional fields on the history row', async () => {
    createMock.mockResolvedValue(100);

    await request(buildApp()).post('/api/activity/start-redirect').send({ streamUrl: 'http://example.com/x.ts' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: null, channelName: null, channelLogo: null })
    );
  });

  it('returns 500 with the ad hoc error shape when the repository throws', async () => {
    createMock.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp()).post('/api/activity/start-redirect').send({ streamUrl: 'http://example.com/x.ts' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Could not log stream start.' });
  });
});

describe('POST /api/activity/stop-redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeRedirectStreams.clear();
  });

  it('returns 400 when historyId is missing', async () => {
    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'History ID is required.' });
  });

  it('returns success without calling endUnconditional when no history record is found', async () => {
    getStartTimeMock.mockResolvedValue(undefined);

    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({ historyId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Stream stopped, history record not found.' });
    expect(endUnconditionalMock).not.toHaveBeenCalled();
  });

  it('ends the history row and removes the tracked redirect stream when found', async () => {
    getStartTimeMock.mockResolvedValue('2026-01-01T00:00:00.000Z');
    activeRedirectStreams.set('1::42', { streamKey: '1::42' } as any);

    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({ historyId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(endUnconditionalMock).toHaveBeenCalledWith(42, '2026-01-01T00:00:00.000Z');
    expect(activeRedirectStreams.has('1::42')).toBe(false);
  });

  it('returns 500 with the ad hoc error shape when the repository throws', async () => {
    getStartTimeMock.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp()).post('/api/activity/stop-redirect').send({ historyId: 42 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Could not log stream end.' });
  });
});
```

- [x] **Step 2: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/routes/__tests__/stream.activity.test.ts`
Expected: PASS, all 11 tests green.

- [x] **Step 3: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS — all suites green, including
`stream.cast-token.test.ts` (unaffected, different route handler).

- [x] **Step 4: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add backend/src/routes/__tests__/stream.activity.test.ts
git commit -m "test(backend): add supertest coverage for stream.ts's stop/redirect routes"
```

---

## Post-plan note for later phases

Two follow-ups this plan explicitly deferred: (1) a MySQL variant of Task
1's testcontainers test, copying the same pattern with a `mysql:8` image
and `DB_CLIENT=mysql2`; (2) a route-level test for `/stream` GET (needs a
`child_process.spawn` mock layer this plan didn't build, since ffmpeg
process lifecycle testing is its own scoped problem, not a Task 3 add-on).
Neither blocks Phase 8.

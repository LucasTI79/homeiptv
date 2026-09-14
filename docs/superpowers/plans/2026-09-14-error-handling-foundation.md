# Error Handling Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc `res.status(x).send(string)` / `console.error` error
handling with typed error classes and one central Express error-handling
middleware that emits a consistent JSON error shape.

**Architecture:** A small `AppError` base class hierarchy in
`backend/src/errors/`, thrown from route handlers and services. A single
Express error-handling middleware (4-arg signature) registered last in
`backend/src/index.ts` catches everything, maps known `AppError` subclasses
to their status code, and falls back to 500 for unknown errors — never
leaking stack traces to the client. Existing routes are migrated
incrementally in this plan's later tasks; new routes going forward
(Phases 3-6) throw these errors natively.

**Tech Stack:** TypeScript, Express 4, Vitest (test runner already
configured via `backend/vitest.config.ts`, but no `test` npm script exists
yet — Task 1 adds it), Supertest (new dev dependency, added in Task 1).

**Spec:** N/A — derived directly from the architecture review in this
conversation (no separate design doc). See roadmap:
`docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md` Phase 1.

## Global Constraints

- Error messages and all code identifiers stay in English (matches existing
  codebase convention — see `backend/src/config/env.ts` log messages).
- JSON error response shape is fixed for every phase going forward:
  `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
  `code` is a stable machine-readable slug (e.g. `NOT_FOUND`,
  `VALIDATION_ERROR`), not the HTTP status text.
- Never send a raw `Error.stack` or internal exception message to the HTTP
  client for unrecognized (non-`AppError`) errors — log it server-side via
  `console.error`, respond with a generic `INTERNAL_ERROR` message instead.
- No changes to `backend/tsconfig.json` compiler options.
- All new files use the existing import style (`import { X } from '../y'`,
  no default exports for these modules — matches `IRemoteSessionHub.ts`).

---

### Task 1: Test tooling setup (vitest script + supertest)

**Files:**
- Modify: `backend/package.json`
- Test: none (tooling-only task, verified by running an existing test)

**Interfaces:**
- Produces: `npm test` script in `backend/package.json` runs
  `vitest run`; `supertest` and `@types/supertest` available as devDependencies
  for Task 5's route-level test.

- [ ] **Step 1: Add the `test` script and supertest devDependency**

Edit `backend/package.json`: add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```
Add to `"devDependencies"`:
```json
"supertest": "^7.0.0",
"@types/supertest": "^6.0.2"
```

- [ ] **Step 2: Install and verify existing tests still pass**

Run: `cd backend && npm install && npm test`
Expected: PASS — the 3 existing suites (`vodUtils.test.ts`,
`localMediaScanner.test.ts`, `MemoryRemoteSessionHub.test.ts`) all pass.
This confirms the script wiring works before any new code is added.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(backend): add vitest test script and supertest devDependency"
```

---

### Task 2: `AppError` base class and subclasses

**Files:**
- Create: `backend/src/errors/AppError.ts`
- Create: `backend/src/errors/index.ts`
- Test: `backend/src/errors/__tests__/AppError.test.ts`

**Interfaces:**
- Produces:
  - `class AppError extends Error { readonly statusCode: number; readonly code: string; readonly details?: unknown; constructor(message: string, statusCode: number, code: string, details?: unknown) }`
  - `class NotFoundError extends AppError` — statusCode 404, code `NOT_FOUND`
  - `class ValidationError extends AppError` — statusCode 400, code `VALIDATION_ERROR`
  - `class UnauthorizedError extends AppError` — statusCode 401, code `UNAUTHORIZED`
  - `class ForbiddenError extends AppError` — statusCode 403, code `FORBIDDEN`
  - `class ConflictError extends AppError` — statusCode 409, code `CONFLICT`
  - `class UpstreamError extends AppError` — statusCode 502, code `UPSTREAM_ERROR`
    (for IPTV/XC/media-server failures — used heavily in Phase 5)
  - `function isAppError(err: unknown): err is AppError`
- All subclasses take `(message: string, details?: unknown)` in their
  constructor and call `super(message, <fixed statusCode>, <fixed code>, details)`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/errors/__tests__/AppError.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, ValidationError, UpstreamError, isAppError } from '../index';

describe('AppError', () => {
  it('sets message, statusCode, code, and details', () => {
    const err = new AppError('Something broke', 500, 'INTERNAL_ERROR', { foo: 'bar' });
    expect(err.message).toBe('Something broke');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the error name for stack traces', () => {
    const err = new AppError('x', 500, 'INTERNAL_ERROR');
    expect(err.name).toBe('AppError');
  });
});

describe('NotFoundError', () => {
  it('defaults to 404 / NOT_FOUND', () => {
    const err = new NotFoundError('Channel not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Channel not found');
    expect(err.name).toBe('NotFoundError');
  });
});

describe('ValidationError', () => {
  it('defaults to 400 / VALIDATION_ERROR and carries details', () => {
    const err = new ValidationError('Missing url parameter', { field: 'url' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ field: 'url' });
  });
});

describe('UpstreamError', () => {
  it('defaults to 502 / UPSTREAM_ERROR', () => {
    const err = new UpstreamError('XC server timed out');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('UPSTREAM_ERROR');
  });
});

describe('isAppError', () => {
  it('returns true for AppError and subclasses', () => {
    expect(isAppError(new AppError('x', 500, 'INTERNAL_ERROR'))).toBe(true);
    expect(isAppError(new NotFoundError('x'))).toBe(true);
  });

  it('returns false for plain Error and non-errors', () => {
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('x')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/errors/__tests__/AppError.test.ts`
Expected: FAIL with a module-not-found error for `../index`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/errors/AppError.ts`:
```typescript
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 502, 'UPSTREAM_ERROR', details);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
```

Create `backend/src/errors/index.ts`:
```typescript
export {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  UpstreamError,
  isAppError,
} from './AppError';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/errors/__tests__/AppError.test.ts`
Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/errors
git commit -m "feat(backend): add typed AppError hierarchy"
```

---

### Task 3: Central Express error-handling middleware

**Files:**
- Create: `backend/src/middleware/errorHandler.ts`
- Test: `backend/src/middleware/__tests__/errorHandler.test.ts`

**Interfaces:**
- Consumes: `AppError`, `isAppError` from `../errors` (Task 2).
- Produces:
  - `function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void`
    — an Express 4-arg error middleware. Registered last, after all routers.
  - `function notFoundHandler(req: Request, res: Response): void` — a
    catch-all for unmatched routes under `/api`, responding with the same
    JSON error shape (`NOT_FOUND`). Registered right before the SPA fallback
    for `/api/*` paths only (the existing `app.get('*', ...)` SPA fallback in
    `index.ts` must keep serving `index.html` for non-API paths, so this only
    applies to `/api`).
  - Response body shape for both: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/middleware/__tests__/errorHandler.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler, notFoundHandler } from '../errorHandler';
import { NotFoundError, ValidationError } from '../../errors';

function buildApp() {
  const app = express();
  app.get('/known-error', (_req, _res, next) => next(new NotFoundError('Channel not found')));
  app.get('/validation-error', (_req, _res, next) =>
    next(new ValidationError('Missing url parameter', { field: 'url' }))
  );
  app.get('/unknown-error', () => {
    throw new Error('boom - raw internal detail that must not leak');
  });
  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('maps a NotFoundError to a 404 with the standard shape', async () => {
    const res = await request(buildApp()).get('/known-error');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Channel not found' } });
  });

  it('includes details when the AppError carries them', async () => {
    const res = await request(buildApp()).get('/validation-error');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Missing url parameter', details: { field: 'url' } },
    });
  });

  it('maps an unrecognized Error to a generic 500 without leaking its message', async () => {
    const res = await request(buildApp()).get('/unknown-error');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    expect(JSON.stringify(res.body)).not.toContain('raw internal detail');
  });
});

describe('notFoundHandler', () => {
  it('returns a standard 404 for unmatched /api routes', async () => {
    const res = await request(buildApp()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/middleware/__tests__/errorHandler.test.ts`
Expected: FAIL with module-not-found for `../errorHandler`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/middleware/errorHandler.ts`:
```typescript
import type { Request, Response, NextFunction } from 'express';
import { isAppError } from '../errors';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorResponseBody = { error: { code: 'NOT_FOUND', message: 'Route not found.' } };
  res.status(404).json(body);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4 params to recognize this as error middleware
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (isAppError(err)) {
    const body: ErrorResponseBody = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) {
      body.error.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  console.error('[ERROR_HANDLER] Unhandled error:', err instanceof Error ? err.stack || err.message : err);
  const body: ErrorResponseBody = { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
  res.status(500).json(body);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/middleware/__tests__/errorHandler.test.ts`
Expected: PASS, all 4 assertions green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/errorHandler.ts backend/src/middleware/__tests__/errorHandler.test.ts
git commit -m "feat(backend): add central error-handling middleware"
```

---

### Task 4: Wire the middleware into `index.ts`

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `errorHandler`, `notFoundHandler` from `./middleware/errorHandler` (Task 3).

- [ ] **Step 1: Add the import**

In `backend/src/index.ts`, add near the other middleware imports (after the
`import { requireAuth } from './middleware/auth';` line):
```typescript
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
```

- [ ] **Step 2: Register `notFoundHandler` for unmatched `/api` routes and `errorHandler` last**

Find this block near the end of `backend/src/index.ts`:
```typescript
app.use('/api/remote', createRemoteRouter(remoteHub));

// server.js:5241-5247 -- SPA fallback, must be registered last.
app.get('*', (req, res) => {
```

Change it to:
```typescript
app.use('/api/remote', createRemoteRouter(remoteHub));

// Any /api/* path not matched by a router above is an unknown API route --
// respond with the standard JSON error shape instead of falling through to
// the SPA fallback (which would serve index.html for a bad API call).
app.use('/api', notFoundHandler);

// server.js:5241-5247 -- SPA fallback, must be registered last.
app.get('*', (req, res) => {
```

Then find the end of the file:
```typescript
server.listen(env.port, () => {
  console.log(`[viniplay-backend] listening on port ${env.port} (db client: ${env.dbClient})`);
});
```

Change it to register the error handler right before `server.listen`
(it must come after every route/middleware, including the SPA fallback,
per Express error-middleware ordering rules):
```typescript
app.use(errorHandler);

server.listen(env.port, () => {
  console.log(`[viniplay-backend] listening on port ${env.port} (db client: ${env.dbClient})`);
});
```

- [ ] **Step 3: Verify the app still boots and typechecks**

Run: `cd backend && npm run typecheck`
Expected: no new errors.

Run: `cd backend && npm run dev` (start it, then Ctrl+C once you see the
`listening on port` log line — this is a manual boot smoke check, not an
automated test, since `index.ts` has no test harness yet).
Expected: log line `[viniplay-backend] listening on port 8999 (db client: better-sqlite3)`
(or your configured `PORT`/`DB_CLIENT`) with no uncaught exceptions.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): wire central error handler and API 404 handler into app"
```

---

### Task 5: Migrate one real route to typed errors as the reference pattern

**Files:**
- Modify: `backend/src/routes/stream.ts:196-219` (the `/api/cast/generate-token` handler)
- Test: `backend/src/routes/__tests__/stream.cast-token.test.ts`

**Interfaces:**
- Consumes: `ValidationError` from `../errors` (Task 2).
- Produces: nothing new — this task exists to give later phases (3, 4, 5)
  one concrete, tested example of "route throws `AppError`, middleware
  handles it" to copy instead of reinventing the pattern per phase.

This task deliberately migrates the smallest, lowest-risk handler in the
codebase (`generate-token`, 24 lines, no streaming/process state) rather
than touching `stream`/`media-proxy` — those are in scope for Phase 5's
full service extraction, not this foundation phase.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/stream.cast-token.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';

// requireAuth and session state aren't the concern of this test -- stub a
// minimal session so the route handler under test runs unauthenticated-free.
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req.session as any) = { userId: 1 };
    next();
  },
}));

import { streamRouter } from '../stream';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(streamRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /api/cast/generate-token', () => {
  it('returns 400 with the standard error shape when streamUrl is missing', async () => {
    const res = await request(buildApp()).post('/api/cast/generate-token').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'streamUrl is required' } });
  });

  it('returns a token when streamUrl is provided', async () => {
    const res = await request(buildApp())
      .post('/api/cast/generate-token')
      .send({ streamUrl: 'http://example.com/stream.ts' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails on the missing-streamUrl case**

Run: `cd backend && npx vitest run src/routes/__tests__/stream.cast-token.test.ts`
Expected: FAIL on the first test — current handler responds
`{ error: 'streamUrl is required' }` (flat string, not the standard shape)
with a try/catch around the whole handler; the second test may already pass.

- [ ] **Step 3: Migrate the handler to throw `ValidationError` and let the middleware format the response**

In `backend/src/routes/stream.ts`, add the import at the top with the other
imports:
```typescript
import { ValidationError } from '../errors';
```

Replace the existing handler (`stream.ts:196-219`):
```typescript
streamRouter.post('/api/cast/generate-token', requireAuth, (req, res) => {
  try {
    const { streamUrl } = req.body as { streamUrl?: string };
    const userId = req.session.userId as number;
    if (!streamUrl) {
      return res.status(400).json({ error: 'streamUrl is required' });
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
    console.error('[CAST_TOKEN] Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate cast token' });
  }
});
```

with:
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

Note: the raw `try/catch { next(error) }` wrapper is still needed here
because this is a synchronous Express 4 handler (Express 4 does not
auto-forward synchronous throws inside a callback the way Express 5 does).
Phase 5's async service methods will use `.catch(next)` on their promises
instead — same principle, different mechanics.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/routes/__tests__/stream.cast-token.test.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all suites (existing 3 + the 3 new ones from this plan)
green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/stream.ts backend/src/routes/__tests__/stream.cast-token.test.ts
git commit -m "refactor(backend): migrate cast-token route to typed ValidationError"
```

---

## Post-plan note for Phase 5

Task 5 above is the pattern every route touched in Phase 5 (`stream.ts`,
`proxy.ts`, `sources.ts`, `vod.ts`) should follow: throw the narrowest
`AppError` subclass that fits (`NotFoundError` for missing profile/channel/
user-agent lookups, `UpstreamError` for IPTV/XC server failures,
`ValidationError` for bad input), and forward async errors with
`.catch(next)` rather than duplicating `try/catch` blocks everywhere.

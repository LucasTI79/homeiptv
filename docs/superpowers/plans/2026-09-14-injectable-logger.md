# Injectable Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an `ILogger` interface with a Winston-backed implementation
that can be constructor/parameter-injected, so services stop calling the
global `console.*` (routed through Winston via a monkey-patch) and instead
take a logger they can swap for a test double or a namespaced child logger.

**Architecture:** `backend/src/logging/` holds the interface (`ILogger`),
two implementations (`WinstonLogger` wrapping a real `winston.Logger`,
`NullLogger` as a no-op test double), and a `createLogger()` factory.
`backend/src/services/logSystem.ts` is refactored to build its existing
Winston setup (console + daily-rotate-file transports, settings-driven
rotation config) through that factory and export a shared `logger: ILogger`
singleton, instead of only exporting the raw `winston.Logger`. The
`console.*` monkey-patch in `logSystem.ts` is deliberately **kept** — it is
the safety net for every call site not yet migrated to the injected logger,
and removing it now would silently drop log output from dozens of
un-migrated files. One service (`backend/src/services/vapid.ts`) is migrated
to take an injected `ILogger` as the reference pattern, the same role
Phase 1's Task 5 played for typed errors.

**Tech Stack:** TypeScript, Winston (already a dependency, see
`backend/src/services/logSystem.ts`), Vitest.

**Spec:** N/A — derived directly from the architecture review in this
conversation. See roadmap: `docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`
Phase 2.

## Global Constraints

- Error messages, log messages, and all code identifiers stay in English.
- The `console.log`/`console.error`/`console.warn` monkey-patch in
  `backend/src/services/logSystem.ts`'s `initializeLogSystem()` is NOT
  removed by this plan. Full removal is a future cleanup task once every
  call site has migrated to an injected `ILogger` (tracked as a roadmap
  follow-up, not part of Phase 2's scope) — this plan only adds the
  injectable primitive and proves the pattern on one module.
- `ILogger`'s method surface is `info`, `warn`, `error`, `debug`, each
  `(message: string, meta?: Record<string, unknown>) => void`, plus
  `child(bindings: Record<string, unknown>): ILogger` for namespacing
  (e.g. `logger.child({ module: 'VAPID' })`).
- No changes to `backend/tsconfig.json` compiler options.
- No changes to the on-disk log format or rotation behavior configured in
  `backend/src/services/logSystem.ts` (daily rotate file, settings-driven
  `maxFiles`/`maxFileSizeBytes` from `getSettings().logs`) — this plan
  wraps the existing Winston configuration, it does not change it.
- All new files use the existing import style (named exports only, no
  default exports).

---

### Task 1: `ILogger` interface and `NullLogger` no-op implementation

**Files:**
- Create: `backend/src/logging/ILogger.ts`
- Create: `backend/src/logging/NullLogger.ts`
- Create: `backend/src/logging/index.ts`
- Test: `backend/src/logging/__tests__/NullLogger.test.ts`

**Interfaces:**
- Produces:
  - `interface ILogger { info(message: string, meta?: Record<string, unknown>): void; warn(message: string, meta?: Record<string, unknown>): void; error(message: string, meta?: Record<string, unknown>): void; debug(message: string, meta?: Record<string, unknown>): void; child(bindings: Record<string, unknown>): ILogger; }`
  - `class NullLogger implements ILogger` — every method is a no-op;
    `child()` returns a new `NullLogger`. Used as a safe default for tests
    that inject a logger but don't care about its output.

- [ ] **Step 1: Write the failing test**

Create `backend/src/logging/__tests__/NullLogger.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { NullLogger } from '../NullLogger';
import type { ILogger } from '../ILogger';

describe('NullLogger', () => {
  it('implements every ILogger method as a no-op without throwing', () => {
    const logger: ILogger = new NullLogger();
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.warn('test', { a: 1 })).not.toThrow();
    expect(() => logger.error('test', { err: new Error('x') })).not.toThrow();
    expect(() => logger.debug('test')).not.toThrow();
  });

  it('child() returns another ILogger-compatible NullLogger', () => {
    const logger: ILogger = new NullLogger();
    const child = logger.child({ module: 'TEST' });
    expect(child).toBeInstanceOf(NullLogger);
    expect(() => child.info('nested')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/logging/__tests__/NullLogger.test.ts`
Expected: FAIL with a module-not-found error for `../NullLogger` and `../ILogger`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/logging/ILogger.ts`:
```typescript
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): ILogger;
}
```

Create `backend/src/logging/NullLogger.ts`:
```typescript
import type { ILogger } from './ILogger';

export class NullLogger implements ILogger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
  child(): ILogger {
    return new NullLogger();
  }
}
```

Create `backend/src/logging/index.ts`:
```typescript
export type { ILogger } from './ILogger';
export { NullLogger } from './NullLogger';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/logging/__tests__/NullLogger.test.ts`
Expected: PASS, both assertions green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/logging/ILogger.ts backend/src/logging/NullLogger.ts backend/src/logging/index.ts backend/src/logging/__tests__/NullLogger.test.ts
git commit -m "feat(backend): add ILogger interface and NullLogger no-op implementation"
```

---

### Task 2: `WinstonLogger` implementation

**Files:**
- Create: `backend/src/logging/WinstonLogger.ts`
- Modify: `backend/src/logging/index.ts`
- Test: `backend/src/logging/__tests__/WinstonLogger.test.ts`

**Interfaces:**
- Consumes: `ILogger` from `./ILogger` (Task 1).
- Produces:
  - `class WinstonLogger implements ILogger { constructor(winstonInstance: winston.Logger) }`
    — delegates `info`/`warn`/`error`/`debug` to the wrapped
    `winston.Logger`'s same-named methods, passing `meta` through as
    Winston's second argument. `child(bindings)` returns a new
    `WinstonLogger` wrapping `winstonInstance.child(bindings)` (Winston's
    native child-logger support, which merges `bindings` into every log
    call's metadata).

- [ ] **Step 1: Write the failing test**

Create `backend/src/logging/__tests__/WinstonLogger.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { WinstonLogger } from '../WinstonLogger';

function buildFakeWinstonLogger() {
  const calls: Array<{ level: string; message: string; meta?: unknown }> = [];
  const fake = {
    info: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'info', message, meta })),
    warn: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'warn', message, meta })),
    error: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'error', message, meta })),
    debug: vi.fn((message: string, meta?: unknown) => calls.push({ level: 'debug', message, meta })),
    child: vi.fn((bindings: unknown) => ({ ...fake, _childBindings: bindings })),
  };
  return { fake, calls };
}

describe('WinstonLogger', () => {
  it('delegates info/warn/error/debug to the wrapped winston instance', () => {
    const { fake, calls } = buildFakeWinstonLogger();
    const logger = new WinstonLogger(fake as never);

    logger.info('hello', { a: 1 });
    logger.warn('careful');
    logger.error('boom', { err: 'detail' });
    logger.debug('trace');

    expect(fake.info).toHaveBeenCalledWith('hello', { a: 1 });
    expect(fake.warn).toHaveBeenCalledWith('careful', undefined);
    expect(fake.error).toHaveBeenCalledWith('boom', { err: 'detail' });
    expect(fake.debug).toHaveBeenCalledWith('trace', undefined);
    expect(calls).toHaveLength(4);
  });

  it('child() wraps winston.child() bindings in a new WinstonLogger', () => {
    const { fake } = buildFakeWinstonLogger();
    const logger = new WinstonLogger(fake as never);

    const child = logger.child({ module: 'VAPID' });
    child.info('scoped message');

    expect(fake.child).toHaveBeenCalledWith({ module: 'VAPID' });
    expect(child).toBeInstanceOf(WinstonLogger);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/logging/__tests__/WinstonLogger.test.ts`
Expected: FAIL with a module-not-found error for `../WinstonLogger`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/logging/WinstonLogger.ts`:
```typescript
import type winston from 'winston';
import type { ILogger } from './ILogger';

export class WinstonLogger implements ILogger {
  constructor(private readonly winstonInstance: winston.Logger) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.warn(message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.error(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.winstonInstance.debug(message, meta);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new WinstonLogger(this.winstonInstance.child(bindings));
  }
}
```

Update `backend/src/logging/index.ts` to also export it:
```typescript
export type { ILogger } from './ILogger';
export { NullLogger } from './NullLogger';
export { WinstonLogger } from './WinstonLogger';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/logging/__tests__/WinstonLogger.test.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/logging/WinstonLogger.ts backend/src/logging/index.ts backend/src/logging/__tests__/WinstonLogger.test.ts
git commit -m "feat(backend): add WinstonLogger ILogger implementation"
```

---

### Task 3: Refactor `logSystem.ts` to expose a shared `ILogger` singleton

**Files:**
- Modify: `backend/src/services/logSystem.ts`
- Test: `backend/src/services/__tests__/logSystem.test.ts`

**Interfaces:**
- Consumes: `WinstonLogger` from `../logging` (Task 2).
- Produces:
  - `export const logger: ILogger` — a `WinstonLogger` wrapping the exact
    same `winston.createLogger(...)` instance and transports the file
    already configures today (console + daily-rotate-file). This replaces
    the file's current `export const logger = winston.createLogger(...)`
    (which was a raw `winston.Logger`, not an `ILogger`) — same variable
    name, new type, so every existing `import { logger } from '../services/logSystem'`
    call site keeps compiling (Winston's own `.info`/`.warn`/`.error`
    methods and `WinstonLogger`'s methods have compatible call signatures
    for the common case of `logger.info('message')` /
    `logger.info('message', meta)`).
  - `initializeLogSystem()`, `refreshLogSettings()`, `resetLogStream()` —
    unchanged behavior (still configure rotation from `getSettings().logs`,
    still monkey-patch `console.log`/`console.error`/`console.warn` to
    route through the underlying Winston instance — this monkey-patch is
    intentionally retained, see Global Constraints).

This task changes the type of an existing exported `logger` from
`winston.Logger` to `ILogger`. Before editing, grep the codebase for every
`import { logger }` from this file's path and confirm each call site only
uses `.info(...)`/`.warn(...)`/`.error(...)`/`.debug(...)` with a string
first argument (which `ILogger` supports) — if any call site uses a
Winston-specific method `ILogger` doesn't expose (e.g. `.log(level, msg)`,
`.add(transport)`), that call site needs `winston.createLogger(...)`'s raw
instance instead, and this task's implementer should report that as a
concern rather than silently changing the call site's behavior.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/logSystem.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { logger } from '../logSystem';
import type { ILogger } from '../../logging';

describe('logSystem', () => {
  it('exports a logger conforming to the ILogger interface', () => {
    const typedLogger: ILogger = logger;
    expect(typeof typedLogger.info).toBe('function');
    expect(typeof typedLogger.warn).toBe('function');
    expect(typeof typedLogger.error).toBe('function');
    expect(typeof typedLogger.debug).toBe('function');
    expect(typeof typedLogger.child).toBe('function');
  });

  it('child() returns a distinct ILogger that does not throw when used', () => {
    const child = logger.child({ module: 'TEST_LOGSYSTEM' });
    expect(() => child.info('child logger message')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/logSystem.test.ts`
Expected: FAIL — before this task's change, `logger` is a raw
`winston.Logger` reference. `winston.Logger` does have its own native
`.child()` method, so the runtime assertions might not fail — the real
signal is TypeScript: `const typedLogger: ILogger = logger;` should still
compile today only by structural luck (Winston's methods happen to be
compatible), so also run `cd backend && npm run typecheck` alongside the
test and note its output in your report; after Task 3's change, `logger`
is explicitly declared `ILogger`-typed via `WinstonLogger`, removing any
doubt.

- [ ] **Step 3: Write the implementation**

In `backend/src/services/logSystem.ts`, add the import near the other
imports:
```typescript
import { WinstonLogger } from '../logging';
import type { ILogger } from '../logging';
```

Find:
```typescript
export const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(LOGS_DIR, 'viniplay-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: false,
      maxSize: '5m', // Overridden dynamically if needed
      maxFiles: '7d', // Overridden dynamically
      level: 'info',
    }),
  ],
});
```

Replace with:
```typescript
const winstonInstance = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(LOGS_DIR, 'viniplay-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: false,
      maxSize: '5m', // Overridden dynamically if needed
      maxFiles: '7d', // Overridden dynamically
      level: 'info',
    }),
  ],
});

export const logger: ILogger = new WinstonLogger(winstonInstance);
```

Every later reference to `logger` inside this same file (in
`refreshLogSettings()`, which does
`logger.transports.find((t: any) => t.name === 'dailyRotateFile')`) reads
Winston-specific `.transports` — `ILogger` does not expose `.transports`.
Update `refreshLogSettings()` to use `winstonInstance.transports` (the raw
instance, still in scope in this module) instead of `logger.transports`:

Find:
```typescript
export function refreshLogSettings(): void {
  try {
    const settings = getSettings();
    if (settings.logs) {
      cachedLogSettings = settings.logs;
      // Re-configure transports based on DB settings if necessary
      const fileTransport = logger.transports.find(
        (t: any) => t.name === 'dailyRotateFile'
      ) as any;
```

Replace with:
```typescript
export function refreshLogSettings(): void {
  try {
    const settings = getSettings();
    if (settings.logs) {
      cachedLogSettings = settings.logs;
      // Re-configure transports based on DB settings if necessary
      const fileTransport = winstonInstance.transports.find(
        (t: any) => t.name === 'dailyRotateFile'
      ) as any;
```

Also check `initializeLogSystem()`'s console monkey-patch, which currently
calls `logger.info(...)`/`logger.error(...)`/`logger.warn(...)` — these
still work unchanged since `ILogger` exposes the same method names with
compatible signatures, so no change needed there. Read the full file after
editing to confirm no other reference to `logger.<winston-only-property>`
remains (e.g. `logger.transports`, `logger.add`, `logger.level =`) —
report any you find as a concern rather than guessing how to handle them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/logSystem.test.ts`
Expected: PASS, both assertions green.

Run: `cd backend && npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all suites green (the existing suites plus this plan's
new ones).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/logSystem.ts backend/src/services/__tests__/logSystem.test.ts
git commit -m "refactor(backend): expose logSystem's logger as an ILogger-typed singleton"
```

---

### Task 4: Migrate `vapid.ts` to accept an injected `ILogger`

**Files:**
- Modify: `backend/src/services/vapid.ts`
- Test: `backend/src/services/__tests__/vapid.test.ts`

**Interfaces:**
- Consumes: `ILogger` from `../logging` (Task 1), `logger` from
  `./logSystem` (Task 3) as the default.
- Produces: `export function initializeVapid(injectedLogger: ILogger = logger): void`
  — same exported name, now takes an optional logger parameter defaulting
  to the shared singleton, so the existing call site in `backend/src/index.ts`
  (`initializeVapid();`) keeps compiling and behaving identically. This is
  the reference pattern later phases copy: default-parameter injection,
  not a constructor, since this module exports a bare function rather than
  a class.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/vapid.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ILogger } from '../../logging';

vi.mock('fs');
vi.mock('web-push', () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: 'pub-123', privateKey: 'priv-456' })),
    setVapidDetails: vi.fn(),
  },
}));

function buildSpyLogger(): { logger: ILogger; calls: Array<{ level: string; message: string }> } {
  const calls: Array<{ level: string; message: string }> = [];
  const logger: ILogger = {
    info: (message) => { calls.push({ level: 'info', message }); },
    warn: (message) => { calls.push({ level: 'warn', message }); },
    error: (message) => { calls.push({ level: 'error', message }); },
    debug: (message) => { calls.push({ level: 'debug', message }); },
    child: () => buildSpyLogger().logger,
  };
  return { logger, calls };
}

describe('initializeVapid', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs via the injected logger when generating new keys', async () => {
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const { initializeVapid } = await import('../vapid');
    const { logger, calls } = buildSpyLogger();

    initializeVapid(logger);

    expect(calls.some((c) => c.level === 'info' && c.message.includes('Generating new keys'))).toBe(true);
    expect(calls.some((c) => c.level === 'info' && c.message.includes('New VAPID keys generated'))).toBe(true);
  });

  it('logs via the injected logger when loading existing keys', async () => {
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ publicKey: 'existing-pub', privateKey: 'existing-priv' }));

    const { initializeVapid } = await import('../vapid');
    const { logger, calls } = buildSpyLogger();

    initializeVapid(logger);

    expect(calls.some((c) => c.level === 'info' && c.message.includes('Loading existing VAPID keys'))).toBe(true);
  });

  it('logs an error via the injected logger when key generation throws', async () => {
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockImplementation(() => { throw new Error('disk failure'); });

    const { initializeVapid } = await import('../vapid');
    const { logger, calls } = buildSpyLogger();

    initializeVapid(logger);

    expect(calls.some((c) => c.level === 'error' && c.message.includes('Could not load or generate VAPID keys'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/vapid.test.ts`
Expected: FAIL — `initializeVapid` does not accept a logger argument yet,
so none of the spy's `calls` entries are populated (the real `console.log`
fires instead, invisible to the test's assertions).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `backend/src/services/vapid.ts`:
```typescript
import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import { DATA_DIR } from '../config/paths';
import { logger as defaultLogger } from './logSystem';
import type { ILogger } from '../logging';

// Ports the VAPID key bootstrap from server.js:108-125.
const VAPID_KEYS_PATH = path.join(DATA_DIR, 'vapid.json');

export let vapidKeys: { publicKey: string; privateKey: string } = { publicKey: '', privateKey: '' };

export function initializeVapid(injectedLogger: ILogger = defaultLogger): void {
  try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
      injectedLogger.info('[Push] Loading existing VAPID keys...');
      vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
    } else {
      injectedLogger.info('[Push] VAPID keys not found. Generating new keys...');
      vapidKeys = webpush.generateVAPIDKeys();
      fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
      injectedLogger.info('[Push] New VAPID keys generated and saved.');
    }
    const vapidContactEmail = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com';
    injectedLogger.info(`[Push] Setting VAPID contact to: ${vapidContactEmail}`);
    webpush.setVapidDetails(vapidContactEmail, vapidKeys.publicKey, vapidKeys.privateKey);
  } catch (error) {
    injectedLogger.error('[Push] FATAL: Could not load or generate VAPID keys.', { error });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/vapid.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Confirm the existing call site still compiles**

`backend/src/index.ts` calls `initializeVapid();` with no arguments — the
new default parameter means this keeps compiling and behaving identically
(it now resolves to the shared `logger` from `logSystem.ts`, same as
`console.log` was routed there before via the monkey-patch).

Run: `cd backend && npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Run the full backend test suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/vapid.ts backend/src/services/__tests__/vapid.test.ts
git commit -m "refactor(backend): migrate vapid service to injected ILogger"
```

---

## Post-plan note for later phases

Task 4 above is the pattern every future module migration should follow:
add an `injectedLogger: ILogger = logger` (or `= defaultLogger` when
importing `logger` directly would create a naming collision) parameter —
or, for a class, take an `ILogger` constructor argument with the same
default — rather than removing `console.*` calls in place. The
`console.*` monkey-patch stays live in `logSystem.ts` until a dedicated
future cleanup task audits every remaining call site (tracked in the
roadmap, not scheduled yet); until then, un-migrated modules keep working
exactly as they do today.

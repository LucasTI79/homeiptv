# Playlist Source Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `if/else` branching on `source.type` inside
`backend/src/services/sources.ts`'s `fetchM3uSourceContent` with a Strategy
Pattern (`PlaylistSourceStrategy`), so adding a new playlist source type
(a Stalker portal, a different XC-like API, etc.) in the future means
writing one new class and registering it — not editing a function that
already mixes file I/O, HTTP fetch, and XC-specific JSON parsing in one
branch.

**Architecture:** `backend/src/services/sourceStrategies/` holds one
interface (`PlaylistSourceStrategy`) and three implementations —
`M3uFileStrategy`, `M3uUrlStrategy`, `XtreamCodesStrategy` — each a
verbatim extraction of one existing branch of `fetchM3uSourceContent`
(same behavior, same log messages, same cache-file naming), plus a small
registry (`selectPlaylistStrategy(type)`) that resolves a `source.type` to
its strategy instance. `sources.ts`'s `processAndMergeSources` calls the
registry instead of the old function, which is deleted.

The new strategy files import `fetchUrlContent` and the `SendStatus` type
from `../sources` (the same file that will import the registry back) —
this is an intentional, safe circular import: every use of
`fetchUrlContent` happens inside an `async` method body, never at module
load time, so Node/ESM resolves both directions of the cycle without
issue (the same pattern already works for winston's own circular internal
requires). Do not "fix" this by moving `fetchUrlContent` elsewhere — that
is out of scope for this plan and would touch call sites (`routes/sources.ts`)
this plan doesn't otherwise need to touch.

> **Correction (post-implementation):** the reasoning above was wrong for
> one direction of this cycle. `sources.ts` statically importing
> `selectPlaylistStrategy` DOES close the cycle at module-load time,
> because the registry (`sourceStrategies/index.ts`) constructs all 3
> strategy instances eagerly at module evaluation — deferred *use* of
> `fetchUrlContent` is not the same as deferred *binding* of the modules
> that reference it. This broke `M3uUrlStrategy.test.ts`/
> `XtreamCodesStrategy.test.ts`'s mocking setup in practice (Task 5). The
> fix landed was a call-time dynamic `import()` in `sources.ts` (see the
> comment at its call site). The claim that fixing this "would touch call
> sites" was also overstated: `fetchUrlContent` has exactly one
> non-strategy importer (`backend/src/routes/sources.ts`). **Phase 5
> should make extracting `fetchUrlContent`/`SendStatus` into a standalone
> module (e.g. `backend/src/services/httpFetch.ts`) its first step**, then
> revert the dynamic import back to static.

**Tech Stack:** TypeScript, Vitest.

**Spec:** N/A — derived directly from the architecture review in this
conversation. See roadmap: `docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`
Phase 4.

## Global Constraints

- `PlaylistSourceStrategy`'s method surface: `fetchContent(source: M3uSource, settings: Settings, sendStatus: SendStatus): Promise<string>` — one method, matching what `fetchM3uSourceContent` already returns (raw M3U text, or XC-server-derived M3U-formatted text) for all three source types today.
- Every extracted strategy preserves the exact existing log messages passed to `sendStatus(...)` and `console.log`/`console.error` — this plan is a structural extraction, not a behavior change. Any message text change is a bug, not an improvement, for this plan.
- Every extracted strategy preserves the exact existing error-throwing behavior (same error messages, same `source.status`/`source.statusMessage` mutations) so `processAndMergeSources`'s existing `try/catch` around each source keeps working unchanged.
- Error/log messages and code identifiers stay in English.
- No default exports.
- No changes to `backend/tsconfig.json` compiler options.
- No changes to `shared/types/settings.ts`'s `M3uSource` interface.

---

### Task 1: `PlaylistSourceStrategy` interface and `M3uFileStrategy`

**Files:**
- Create: `backend/src/services/sourceStrategies/PlaylistSourceStrategy.ts`
- Create: `backend/src/services/sourceStrategies/M3uFileStrategy.ts`
- Test: `backend/src/services/sourceStrategies/__tests__/M3uFileStrategy.test.ts`

**Interfaces:**
- Produces:
  - `interface PlaylistSourceStrategy { fetchContent(source: M3uSource, settings: Settings, sendStatus: SendStatus): Promise<string>; }`
  - `class M3uFileStrategy implements PlaylistSourceStrategy` — reads a
    local file from `SOURCES_DIR`, throwing (and setting `source.status`/
    `source.statusMessage`) if the file is missing. Verbatim port of
    `fetchM3uSourceContent`'s `source.type === 'file'` branch
    (`backend/src/services/sources.ts:209-218` as of this plan's writing).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/sourceStrategies/__tests__/M3uFileStrategy.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import { M3uFileStrategy } from '../M3uFileStrategy';

vi.mock('fs');

function buildSource(overrides: Partial<M3uSource> = {}): M3uSource {
  return {
    id: 'src-1',
    name: 'Test File Source',
    type: 'file',
    isActive: true,
    path: 'my-playlist.m3u',
    ...overrides,
  };
}

describe('M3uFileStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the file content when the source file exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');

    const strategy = new M3uFileStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, {} as Settings, sendStatus);

    expect(content).toBe('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');
  });

  it('throws and marks the source as errored when the file is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const strategy = new M3uFileStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    await expect(strategy.fetchContent(source, {} as Settings, sendStatus)).rejects.toThrow('File not found.');

    expect(source.status).toBe('Error');
    expect(source.statusMessage).toBe('File not found.');
    expect(sendStatus).toHaveBeenCalledWith(expect.stringContaining('File not found for source "Test File Source"'), 'error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/M3uFileStrategy.test.ts`
Expected: FAIL with a module-not-found error for `../M3uFileStrategy`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/sourceStrategies/PlaylistSourceStrategy.ts`:
```typescript
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { SendStatus } from '../sources';

export interface PlaylistSourceStrategy {
  fetchContent(source: M3uSource, settings: Settings, sendStatus: SendStatus): Promise<string>;
}
```

Create `backend/src/services/sourceStrategies/M3uFileStrategy.ts`:
```typescript
import fs from 'fs';
import path from 'path';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import type { SendStatus } from '../sources';
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/M3uFileStrategy.test.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sourceStrategies/PlaylistSourceStrategy.ts backend/src/services/sourceStrategies/M3uFileStrategy.ts backend/src/services/sourceStrategies/__tests__/M3uFileStrategy.test.ts
git commit -m "feat(backend): add PlaylistSourceStrategy interface and M3uFileStrategy"
```

---

### Task 2: `M3uUrlStrategy`

**Files:**
- Create: `backend/src/services/sourceStrategies/M3uUrlStrategy.ts`
- Test: `backend/src/services/sourceStrategies/__tests__/M3uUrlStrategy.test.ts`

**Interfaces:**
- Consumes: `PlaylistSourceStrategy` from `./PlaylistSourceStrategy` (Task 1),
  `fetchUrlContent` and `SendStatus` from `../sources` (existing exports —
  see the plan's Architecture section on why this circular import is safe).
- Produces: `class M3uUrlStrategy implements PlaylistSourceStrategy` —
  fetches playlist content over HTTP via `fetchUrlContent`, caches the raw
  response to `RAW_CACHE_DIR/raw_<sourceId>.m3u_cache`, sets
  `source.cachedRawPath` on success (or deletes it on a cache-write
  failure, matching current behavior). Verbatim port of
  `fetchM3uSourceContent`'s `source.type === 'url'` branch
  (`backend/src/services/sources.ts:220-233`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/sourceStrategies/__tests__/M3uUrlStrategy.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import type { M3uSource, Settings } from '@homeiptv/shared-types';

vi.mock('fs');
vi.mock('../../sources', async () => {
  const actual = await vi.importActual<typeof import('../../sources')>('../../sources');
  return {
    ...actual,
    fetchUrlContent: vi.fn(),
  };
});

import { fetchUrlContent } from '../../sources';
import { M3uUrlStrategy } from '../M3uUrlStrategy';

function buildSource(overrides: Partial<M3uSource> = {}): M3uSource {
  return {
    id: 'src-2',
    name: 'Test URL Source',
    type: 'url',
    isActive: true,
    path: 'http://example.com/playlist.m3u',
    ...overrides,
  };
}

describe('M3uUrlStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches content over HTTP and caches it', async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const strategy = new M3uUrlStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, {} as Settings, sendStatus);

    expect(content).toBe('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/1.ts\n');
    expect(fetchUrlContent).toHaveBeenCalledWith('http://example.com/playlist.m3u');
    expect(source.cachedRawPath).toContain('raw_src-2.m3u_cache');
  });

  it('clears cachedRawPath when writing the cache file fails, but still returns the content', async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue('#EXTM3U\n');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('disk full');
    });

    const strategy = new M3uUrlStrategy();
    const source = buildSource({ cachedRawPath: '/old/stale/path' });
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, {} as Settings, sendStatus);

    expect(content).toBe('#EXTM3U\n');
    expect(source.cachedRawPath).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/M3uUrlStrategy.test.ts`
Expected: FAIL with a module-not-found error for `../M3uUrlStrategy`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/sourceStrategies/M3uUrlStrategy.ts`:
```typescript
import fs from 'fs';
import path from 'path';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import { fetchUrlContent } from '../sources';
import type { SendStatus } from '../sources';
import { RAW_CACHE_DIR } from '../../config/paths';

export class M3uUrlStrategy implements PlaylistSourceStrategy {
  async fetchContent(source: M3uSource, _settings: Settings, sendStatus: SendStatus): Promise<string> {
    sendStatus(' -> Fetching content from URL...', 'info');
    const content = (await fetchUrlContent(source.path)) as string;
    try {
      const cacheFilePath = path.join(RAW_CACHE_DIR, `raw_${source.id}.m3u_cache`);
      fs.writeFileSync(cacheFilePath, content);
      source.cachedRawPath = cacheFilePath;
    } catch (cacheWriteError) {
      console.error(`[PROCESS_CACHE] Failed to write raw cache for source "${source.name}" (URL):`, (cacheWriteError as Error).message);
      delete source.cachedRawPath;
    }
    sendStatus(' -> Successfully fetched M3U content.', 'info');
    return content;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/M3uUrlStrategy.test.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sourceStrategies/M3uUrlStrategy.ts backend/src/services/sourceStrategies/__tests__/M3uUrlStrategy.test.ts
git commit -m "feat(backend): add M3uUrlStrategy"
```

---

### Task 3: `XtreamCodesStrategy`

**Files:**
- Create: `backend/src/services/sourceStrategies/XtreamCodesStrategy.ts`
- Test: `backend/src/services/sourceStrategies/__tests__/XtreamCodesStrategy.test.ts`

**Interfaces:**
- Consumes: `PlaylistSourceStrategy` from `./PlaylistSourceStrategy` (Task 1),
  `fetchUrlContent` and `SendStatus` from `../sources`.
- Produces: `class XtreamCodesStrategy implements PlaylistSourceStrategy` —
  parses `source.xc_data` (JSON: `{server, username, password}`), fetches
  live categories + live streams from the XC `player_api.php` endpoint in
  parallel, builds an M3U-formatted string from the results, caches it the
  same way `M3uUrlStrategy` does. Verbatim port of
  `fetchM3uSourceContent`'s XC branch
  (`backend/src/services/sources.ts:235-300`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/sourceStrategies/__tests__/XtreamCodesStrategy.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import type { M3uSource, Settings } from '@homeiptv/shared-types';

vi.mock('fs');
vi.mock('../../sources', async () => {
  const actual = await vi.importActual<typeof import('../../sources')>('../../sources');
  return {
    ...actual,
    fetchUrlContent: vi.fn(),
  };
});

import { fetchUrlContent } from '../../sources';
import { XtreamCodesStrategy } from '../XtreamCodesStrategy';

function buildSource(overrides: Partial<M3uSource> = {}): M3uSource {
  return {
    id: 'src-3',
    name: 'Test XC Source',
    type: 'xc',
    isActive: true,
    path: '',
    xc_data: JSON.stringify({ server: 'http://xc.example.com', username: 'user1', password: 'pass1' }),
    ...overrides,
  };
}

function buildSettings(): Settings {
  return { userAgents: [], activeUserAgentId: '' } as unknown as Settings;
}

describe('XtreamCodesStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  it('builds an M3U string from live categories and streams', async () => {
    vi.mocked(fetchUrlContent)
      .mockResolvedValueOnce(JSON.stringify([{ category_id: '1', category_name: 'News' }]))
      .mockResolvedValueOnce(JSON.stringify([
        { stream_type: 'live', stream_id: 101, name: 'Channel A', stream_icon: 'http://x/a.png', category_id: '1', epg_channel_id: 'chA' },
        { stream_type: 'vod', stream_id: 202, name: 'Not a live stream' },
      ]));

    const strategy = new XtreamCodesStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, buildSettings(), sendStatus);

    expect(content).toContain('tvg-id="chA"');
    expect(content).toContain('tvg-name="Channel A"');
    expect(content).toContain('group-title="News"');
    expect(content).toContain('http://xc.example.com/live/user1/pass1/101.ts');
    expect(content).not.toContain('Not a live stream');
    expect(sendStatus).toHaveBeenCalledWith(expect.stringContaining('Added 1 live streams'), 'info');
  });

  it('throws when xc_data is missing', async () => {
    const strategy = new XtreamCodesStrategy();
    const source = buildSource({ xc_data: undefined });
    const sendStatus = vi.fn();

    await expect(strategy.fetchContent(source, buildSettings(), sendStatus)).rejects.toThrow('XC source is missing credential data');
  });

  it('warns and returns empty-ish content when the live-streams fetch fails, without throwing', async () => {
    vi.mocked(fetchUrlContent).mockRejectedValue(new Error('XC server unreachable'));

    const strategy = new XtreamCodesStrategy();
    const source = buildSource();
    const sendStatus = vi.fn();

    const content = await strategy.fetchContent(source, buildSettings(), sendStatus);

    expect(content).toBe('');
    expect(sendStatus).toHaveBeenCalledWith(expect.stringContaining('Could not fetch live streams'), 'warning');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/XtreamCodesStrategy.test.ts`
Expected: FAIL with a module-not-found error for `../XtreamCodesStrategy`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/sourceStrategies/XtreamCodesStrategy.ts`:
```typescript
import fs from 'fs';
import path from 'path';
import type { M3uSource, Settings } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import { fetchUrlContent } from '../sources';
import type { SendStatus } from '../sources';
import { RAW_CACHE_DIR } from '../../config/paths';

export class XtreamCodesStrategy implements PlaylistSourceStrategy {
  async fetchContent(source: M3uSource, settings: Settings, sendStatus: SendStatus): Promise<string> {
    if (!source.xc_data) {
      throw new Error('XC source is missing credential data (xc_data).');
    }
    const { server, username, password } = JSON.parse(source.xc_data) as {
      server?: string;
      username?: string;
      password?: string;
    };
    if (!server || !username || !password) {
      throw new Error('XC source is missing server, username, or password.');
    }

    const activeUserAgent =
      settings.userAgents.find((ua) => ua.id === settings.activeUserAgentId)?.value || 'VLC/3.0.20 (Linux; x86_64)';
    const m3uFetchOptions = { headers: { 'User-Agent': activeUserAgent } };

    let content = '';
    try {
      sendStatus(' -> Fetching live categories and streams from XC server in parallel...', 'info');
      const liveCategoriesUrl = `${server}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;
      const liveStreamsUrl = `${server}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;

      const [categoriesRaw, streamsRaw] = await Promise.all([
        fetchUrlContent(liveCategoriesUrl, m3uFetchOptions),
        fetchUrlContent(liveStreamsUrl, m3uFetchOptions),
      ]);

      const liveCategories = JSON.parse(categoriesRaw as string) as Array<{ category_id: string; category_name: string }>;
      const liveStreams = JSON.parse(streamsRaw as string) as Array<{
        stream_type: string;
        stream_id: string | number;
        name: string;
        stream_icon?: string;
        category_id?: string;
        epg_channel_id?: string;
      }>;

      let liveM3uContent = '';
      let liveStreamCount = 0;
      if (Array.isArray(liveStreams)) {
        for (const stream of liveStreams) {
          if (stream.stream_type === 'live') {
            liveStreamCount++;
            const streamUrl = `${server}/live/${username}/${password}/${stream.stream_id}.ts`;
            const categoryName = Array.isArray(liveCategories)
              ? liveCategories.find((cat) => String(cat.category_id) === String(stream.category_id))?.category_name || 'Live'
              : 'Live';
            const tvgId = stream.epg_channel_id || stream.stream_id;
            liveM3uContent += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${stream.name}" tvg-logo="${stream.stream_icon || ''}" group-title="${categoryName}",${stream.name}\n`;
            liveM3uContent += `${streamUrl}\n`;
          }
        }
      }

      if (liveStreamCount > 0) {
        content += '\n' + liveM3uContent;
        sendStatus(` -> Added ${liveStreamCount} live streams to content.`, 'info');
      } else {
        sendStatus(" -> No live streams found with stream_type = 'live'.", 'info');
      }
    } catch (liveError) {
      console.error(`[XC Live] Error fetching live streams for "${source.name}": ${(liveError as Error).message}`);
      sendStatus(` -> Warning: Could not fetch live streams: ${(liveError as Error).message}`, 'warning');
    }

    try {
      const cacheFilePath = path.join(RAW_CACHE_DIR, `raw_${source.id}.m3u_cache`);
      fs.writeFileSync(cacheFilePath, content);
      source.cachedRawPath = cacheFilePath;
    } catch (cacheWriteError) {
      console.error(`[PROCESS_CACHE] Failed to write raw cache for source "${source.name}" (XC):`, (cacheWriteError as Error).message);
      delete source.cachedRawPath;
    }
    sendStatus(' -> Successfully fetched M3U content from XC server.', 'info');
    return content;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/XtreamCodesStrategy.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sourceStrategies/XtreamCodesStrategy.ts backend/src/services/sourceStrategies/__tests__/XtreamCodesStrategy.test.ts
git commit -m "feat(backend): add XtreamCodesStrategy"
```

---

### Task 4: Strategy registry (`selectPlaylistStrategy`)

**Files:**
- Create: `backend/src/services/sourceStrategies/index.ts`
- Test: `backend/src/services/sourceStrategies/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `M3uFileStrategy` (Task 1), `M3uUrlStrategy` (Task 2),
  `XtreamCodesStrategy` (Task 3), `PlaylistSourceStrategy` type (Task 1).
- Produces: `function selectPlaylistStrategy(type: M3uSource['type']): PlaylistSourceStrategy`
  — throws a descriptive error for an unregistered type (defensive; every
  current `M3uSource['type']` value is registered, so this only fires if
  the shared type is widened without updating this registry).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/sourceStrategies/__tests__/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { selectPlaylistStrategy } from '../index';
import { M3uFileStrategy } from '../M3uFileStrategy';
import { M3uUrlStrategy } from '../M3uUrlStrategy';
import { XtreamCodesStrategy } from '../XtreamCodesStrategy';

describe('selectPlaylistStrategy', () => {
  it('resolves "file" to M3uFileStrategy', () => {
    expect(selectPlaylistStrategy('file')).toBeInstanceOf(M3uFileStrategy);
  });

  it('resolves "url" to M3uUrlStrategy', () => {
    expect(selectPlaylistStrategy('url')).toBeInstanceOf(M3uUrlStrategy);
  });

  it('resolves "xc" to XtreamCodesStrategy', () => {
    expect(selectPlaylistStrategy('xc')).toBeInstanceOf(XtreamCodesStrategy);
  });

  it('throws a descriptive error for an unregistered type', () => {
    // @ts-expect-error -- intentionally passing a value outside M3uSource['type'] to exercise the defensive branch
    expect(() => selectPlaylistStrategy('stalker')).toThrow('No playlist source strategy registered for type "stalker"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/index.test.ts`
Expected: FAIL with a module-not-found error for `../index`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/sourceStrategies/index.ts`:
```typescript
import type { M3uSource } from '@homeiptv/shared-types';
import type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
import { M3uFileStrategy } from './M3uFileStrategy';
import { M3uUrlStrategy } from './M3uUrlStrategy';
import { XtreamCodesStrategy } from './XtreamCodesStrategy';

const strategies: Record<M3uSource['type'], PlaylistSourceStrategy> = {
  file: new M3uFileStrategy(),
  url: new M3uUrlStrategy(),
  xc: new XtreamCodesStrategy(),
};

export function selectPlaylistStrategy(type: M3uSource['type']): PlaylistSourceStrategy {
  const strategy = strategies[type];
  if (!strategy) {
    throw new Error(`No playlist source strategy registered for type "${type}"`);
  }
  return strategy;
}

export type { PlaylistSourceStrategy } from './PlaylistSourceStrategy';
export { M3uFileStrategy } from './M3uFileStrategy';
export { M3uUrlStrategy } from './M3uUrlStrategy';
export { XtreamCodesStrategy } from './XtreamCodesStrategy';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/sourceStrategies/__tests__/index.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sourceStrategies/index.ts backend/src/services/sourceStrategies/__tests__/index.test.ts
git commit -m "feat(backend): add selectPlaylistStrategy registry"
```

---

### Task 5: Wire the registry into `sources.ts`, remove the old function

**Files:**
- Modify: `backend/src/services/sources.ts`
- Test: `backend/src/services/__tests__/processAndMergeSources.test.ts`

**Interfaces:**
- Consumes: `selectPlaylistStrategy` from `./sourceStrategies` (Task 4).
- Produces: nothing new — `processAndMergeSources`'s exported signature is
  unchanged; only its internal call to fetch each M3U source's content
  changes from the old `fetchM3uSourceContent` function to the registry.

`fetchM3uSourceContent` (currently `backend/src/services/sources.ts:204-301`)
is deleted entirely once its logic has been verified equivalent in Tasks
1-3 — its only call site (line ~359) is updated to use the registry.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/processAndMergeSources.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('./settings', () => ({
  getSettings: vi.fn(),
}));

import { getSettings } from '../settings';
import { processAndMergeSources } from '../sources';

describe('processAndMergeSources with the strategy registry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('merges an active file-type M3U source into the live channels file via M3uFileStrategy', async () => {
    vi.mocked(getSettings).mockReturnValue({
      m3uSources: [
        { id: 'src-1', name: 'File Source', type: 'file', isActive: true, path: 'playlist.m3u' },
      ],
      epgSources: [],
      userAgents: [],
      activeUserAgentId: '',
      timezoneOffset: 0,
    } as never);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '#EXTM3U\n#EXTINF:-1 tvg-id="ch1" tvg-name="Channel 1" group-title="News",Channel 1\nhttp://example.com/1.ts\n'
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const sendStatus = vi.fn();
    const result = await processAndMergeSources(sendStatus);

    expect(result.success).toBe(true);
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const liveM3uWrite = writeCalls.find(([filePath]) => String(filePath).includes('live_channels'));
    expect(liveM3uWrite).toBeDefined();
    expect(String(liveM3uWrite![1])).toContain('src-1_ch1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/processAndMergeSources.test.ts`
Expected: FAIL or ERROR — at this point `processAndMergeSources` still
calls the old `fetchM3uSourceContent`, which reads from the real
`SOURCES_DIR`/`RAW_CACHE_DIR` paths via mocked `fs` the same way, so this
specific test may actually pass already since both the old function and
the new registry ultimately call the same `fs` APIs with equivalent logic
— if so, note that in your report and treat Step 3's refactor as verified
correct by this test staying green throughout, plus by
`npm run typecheck` confirming `fetchM3uSourceContent` is fully unused
before you delete it (search for any other reference first).

- [ ] **Step 3: Write the implementation**

In `backend/src/services/sources.ts`, add the import near the other local
imports:
```typescript
import { selectPlaylistStrategy } from './sourceStrategies';
```

Delete the entire `fetchM3uSourceContent` function (currently lines
204-301, from the comment block starting `async function fetchM3uSourceContent(`
through its closing `}`).

Find, inside `processAndMergeSources`'s M3U-processing loop:
```typescript
    try {
      const content = await fetchM3uSourceContent(source, settings, sendStatus);
```

Replace with:
```typescript
    try {
      const content = await selectPlaylistStrategy(source.type).fetchContent(source, settings, sendStatus);
```

Nothing else in `processAndMergeSources` changes — the returned `content`
string has the same shape and is used identically afterward (VOD-refresh
triggering, M3U line parsing for the merged live-channels file).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/processAndMergeSources.test.ts`
Expected: PASS.

Run: `cd backend && npm run typecheck`
Expected: no errors (confirms no other file referenced the deleted
`fetchM3uSourceContent`).

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all suites green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/sources.ts backend/src/services/__tests__/processAndMergeSources.test.ts
git commit -m "refactor(backend): route playlist fetching through selectPlaylistStrategy"
```

---

## Post-plan note for later phases

Adding a new playlist source type from here means: write one class
implementing `PlaylistSourceStrategy` in
`backend/src/services/sourceStrategies/`, add one line to the `strategies`
record in `backend/src/services/sourceStrategies/index.ts`, and widen
`M3uSource['type']` in `shared/types/settings.ts` — no changes to
`processAndMergeSources` or any route. Phase 5's route/service extraction
should treat `sourceStrategies/` as a stable dependency to build
`SourceSyncService` on top of, not something it also refactors.

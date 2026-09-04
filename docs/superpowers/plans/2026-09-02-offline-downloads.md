# Offline Downloads (Movies & Series) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement offline downloading and playback for movies, series episodes, and entire seasons using the browser's Origin Private File System (OPFS) and IndexedDB, accompanied by a dedicated management interface and transparent player integration.

**Architecture:** Video files are streamed chunk-by-chunk directly into the browser's OPFS (`/downloads/{mediaId}.mp4`) via `ReadableStreamDefaultReader` and `FileSystemWritableFileStream` to support gigabyte-scale media without browser RAM exhaustion. Metadata, queue status, and progress are persisted in IndexedDB (`download_tasks`), managed by a singleton `DownloadManager` and bound to a reactive Zustand `downloadStore`. `PlayerPage.tsx` checks OPFS for completed downloads before attempting network streaming.

**Tech Stack:** React 19, TypeScript, Zustand, IndexedDB (`window.indexedDB`), Origin Private File System (OPFS), Vitest, React Router DOM, Tailwind CSS / Vanilla CSS.

## Global Constraints
- Do not exhaust browser memory: video downloads MUST be streamed directly to OPFS chunks without accumulating the whole file in RAM.
- Downloads must support pause/resume via HTTP `Range: bytes={downloadedBytes}-`.
- IndexedDB database name is `viniplay_offline_db` upgraded to version `3`.
- No placeholders, no `TODO` or `TBD` in implementation.

---

### Task 1: Database Migration to v3 (`download_tasks` store in `db.ts`)

**Files:**
- Modify: `frontend/src/services/db.ts`
- Test: `frontend/src/services/db.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

  export interface DownloadTask {
    id: string;
    mediaType: 'movie' | 'series';
    seriesId?: string;
    seriesName?: string;
    season?: string;
    episodeIndex?: number;
    title: string;
    remoteUrl: string;
    logo?: string;
    totalBytes: number;
    downloadedBytes: number;
    status: DownloadStatus;
    speedBytesPerSec?: number;
    errorMessage?: string;
    createdAt: number;
    completedAt?: number;
    fileName: string;
  }

  export function getDownloadTasks(): Promise<DownloadTask[]>;
  export function getDownloadTask(id: string): Promise<DownloadTask | null>;
  export function saveDownloadTask(task: DownloadTask): Promise<void>;
  export function removeDownloadTask(id: string): Promise<void>;
  ```

- [ ] **Step 1: Write failing test in `db.test.ts`**

Add tests for v3 upgrade and CRUD operations on `download_tasks`.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDb,
  getDownloadTasks,
  getDownloadTask,
  saveDownloadTask,
  removeDownloadTask,
  type DownloadTask,
} from './db';

describe('IndexedDB v3 download_tasks', () => {
  const sampleTask: DownloadTask = {
    id: 'movie_123',
    mediaType: 'movie',
    title: 'Inception',
    remoteUrl: 'http://example.com/inception.mp4',
    totalBytes: 104857600,
    downloadedBytes: 52428800,
    status: 'downloading',
    createdAt: Date.now(),
    fileName: 'movie_123.mp4',
  };

  beforeEach(async () => {
    const db = await openDb();
    const tx = db.transaction('download_tasks', 'readwrite');
    tx.objectStore('download_tasks').clear();
    await new Promise<void>((res) => (tx.oncomplete = () => res()));
  });

  it('saves and retrieves a download task by id', async () => {
    await saveDownloadTask(sampleTask);
    const task = await getDownloadTask('movie_123');
    expect(task).toBeDefined();
    expect(task?.title).toBe('Inception');
    expect(task?.status).toBe('downloading');
  });

  it('lists all download tasks ordered by createdAt descending', async () => {
    await saveDownloadTask(sampleTask);
    await saveDownloadTask({
      ...sampleTask,
      id: 'movie_456',
      title: 'Interstellar',
      createdAt: sampleTask.createdAt + 1000,
    });

    const list = await getDownloadTasks();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('movie_456');
    expect(list[1].id).toBe('movie_123');
  });

  it('removes a download task by id', async () => {
    await saveDownloadTask(sampleTask);
    await removeDownloadTask('movie_123');
    const task = await getDownloadTask('movie_123');
    expect(task).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/services/db.test.ts`
Expected: FAIL due to missing `download_tasks` store and helper functions.

- [ ] **Step 3: Implement v3 migration and helper functions in `db.ts`**

Update `DB_VERSION = 3` in `frontend/src/services/db.ts`. In `request.onupgradeneeded`:
```typescript
if (!db.objectStoreNames.contains(STORE_DOWNLOAD_TASKS)) {
  const dtStore = db.createObjectStore(STORE_DOWNLOAD_TASKS, { keyPath: 'id' });
  dtStore.createIndex('by_status', 'status', { unique: false });
  dtStore.createIndex('by_seriesId', 'seriesId', { unique: false });
  dtStore.createIndex('by_createdAt', 'createdAt', { unique: false });
}
```
Implement `getDownloadTasks`, `getDownloadTask`, `saveDownloadTask`, `removeDownloadTask`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/services/db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/db.ts frontend/src/services/db.test.ts
git commit -m "feat(db): upgrade offline database to v3 with download_tasks store"
```

---

### Task 2: OPFS Storage & Download Manager Service

**Files:**
- Create: `frontend/src/services/opfsStorage.ts`
- Create: `frontend/src/services/downloadManager.ts`
- Create: `frontend/src/services/downloadManager.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // opfsStorage.ts
  export function isOpfsSupported(): boolean;
  export function getDownloadsDirectory(): Promise<FileSystemDirectoryHandle>;
  export function getDownloadedFile(fileName: string): Promise<File | null>;
  export function deleteDownloadedFile(fileName: string): Promise<boolean>;
  export function getDiskStorageEstimate(): Promise<{ usedBytes: number; quotaBytes: number }>;

  // downloadManager.ts
  export class DownloadManager {
    static getInstance(): DownloadManager;
    enqueueMovie(movie: { id: string; title: string; url: string; logo?: string }): Promise<DownloadTask>;
    enqueueEpisode(episode: { seriesId: string; seriesName: string; season: string; episodeIndex: number; title: string; url: string; logo?: string }): Promise<DownloadTask>;
    enqueueSeason(series: { id: string; name: string; logo?: string }, season: string, episodes: { name: string; url: string }[]): Promise<DownloadTask[]>;
    pauseDownload(id: string): Promise<void>;
    resumeDownload(id: string): Promise<void>;
    cancelDownload(id: string): Promise<void>;
  }
  ```

- [ ] **Step 1: Implement `opfsStorage.ts`**

Create `frontend/src/services/opfsStorage.ts` with directory handle resolution, file write/read helpers, and disk quota estimation via `navigator.storage.estimate()`.

- [ ] **Step 2: Write failing test for `downloadManager.test.ts`**

Write tests mocking `fetch` and testing download enqueuing, sequential concurrency (1 active task), and pause/resume logic.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run frontend/src/services/downloadManager.test.ts`
Expected: FAIL because `downloadManager.ts` is not yet implemented.

- [ ] **Step 4: Implement `downloadManager.ts`**

Implement chunked stream processing using `fetch` with `Range` header support, writing directly to `FileSystemWritableFileStream`, throttled progress persistence to IndexedDB, and automatic progression to the next queued item.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run frontend/src/services/downloadManager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/opfsStorage.ts frontend/src/services/downloadManager.ts frontend/src/services/downloadManager.test.ts
git commit -m "feat: implement OPFS storage layer and DownloadManager service"
```

---

### Task 3: Reactive Zustand Store for Downloads (`downloadStore.ts`)

**Files:**
- Create: `frontend/src/store/downloadStore.ts`
- Create: `frontend/src/store/downloadStore.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface DownloadStoreState {
    tasks: Record<string, DownloadTask>;
    isInitialized: boolean;
    storageUsage: { usedBytes: number; quotaBytes: number };
    initDownloads: () => Promise<void>;
    refreshStorage: () => Promise<void>;
    getTask: (id: string) => DownloadTask | undefined;
    isDownloaded: (id: string) => boolean;
  }
  ```

- [ ] **Step 1: Write failing test in `downloadStore.test.ts`**

Test store hydration from IndexedDB, status lookups (`isDownloaded`), and real-time task updates.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/store/downloadStore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `downloadStore.ts`**

Create `frontend/src/store/downloadStore.ts` wrapping Zustand with reactive task state and listeners wired to `DownloadManager` events.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/store/downloadStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/downloadStore.ts frontend/src/store/downloadStore.test.ts
git commit -m "feat(store): add reactive downloadStore integrated with IndexedDB"
```

---

### Task 4: UI Action Buttons in VOD Page & Series Modal

**Files:**
- Modify: `frontend/src/pages/vod/VodPage.tsx`
- Modify: `frontend/src/components/vod/SeriesModal.tsx`

- [ ] **Step 1: Add Download Button and badge to movie cards in `VodPage.tsx`**

On movie hover cards, add download button. If already downloaded, display a green check badge. On click, call `DownloadManager.getInstance().enqueueMovie(...)` and show feedback toast.

- [ ] **Step 2: Add "Baixar Temporada" and episode download buttons in `SeriesModal.tsx`**

In each season tab header, add button `Baixar Temporada Completa (${episodes.length} episódios)`.
In each episode row, add circular progress/download button.

- [ ] **Step 3: Run Vitest and typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: PASS with 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/vod/VodPage.tsx frontend/src/components/vod/SeriesModal.tsx
git commit -m "feat(ui): add download buttons for movies, seasons, and episodes"
```

---

### Task 5: Dedicated Downloads Management Page (`/downloads`)

**Files:**
- Create: `frontend/src/pages/downloads/DownloadsPage.tsx`
- Modify: `frontend/src/App.tsx` (or router configuration)
- Modify: Navigation header/sidebar to add "Downloads" icon link

- [ ] **Step 1: Implement `DownloadsPage.tsx`**

Build the Downloads UI:
- Storage quota visual bar (`usedBytes` vs `quotaBytes` formatted in GB).
- Tab 1: "Baixados" (Downloaded items grouped by Movies and Series, with Play and Delete buttons).
- Tab 2: "Fila de Downloads" (Active and queued tasks with progress bar, speed KB/MBps, pause, resume, cancel).

- [ ] **Step 2: Wire Route and Navigation**

Add `/downloads` route in `App.tsx` and a navigation item with download icon in the main navigation menu.

- [ ] **Step 3: Run test and build verification**

Run: `npm run build`
Expected: PASS with successful bundle output.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/downloads/DownloadsPage.tsx frontend/src/App.tsx
git commit -m "feat(downloads): add dedicated DownloadsPage with storage quota and queue control"
```

---

### Task 6: Transparent Player Integration for Local Playback (`PlayerPage.tsx`)

**Files:**
- Modify: `frontend/src/pages/PlayerPage.tsx`
- Test: `frontend/src/test/components/PlayerPage.test.tsx`

- [ ] **Step 1: Check OPFS for local file on media play**

In `PlayerPage.tsx`, before setting `video.src = streamUrlToPlay`:
1. Check `downloadStore.getTask(mediaId)` or lookup in OPFS.
2. If completed, load `getDownloadedFile(task.fileName)`.
3. Set `video.src = URL.createObjectURL(file)`.
4. Display badge: `"Reproduzindo do armazenamento local (Offline)"`.

- [ ] **Step 2: Verify seek and Continue Watching compatibility**

Verify that seeking on the local blob works natively and `saveProgress` continues to write time stamps to `viniplay_offline_db` without requiring an active internet connection.

- [ ] **Step 3: Run player tests**

Run: `npx vitest run frontend/src/test/components/PlayerPage.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PlayerPage.tsx frontend/src/test/components/PlayerPage.test.tsx
git commit -m "feat(player): seamlessly play downloaded media from local OPFS storage"
```

---

### Task 7: Full Verification and Linting

- [ ] **Step 1: Run all test suites**
Run: `npm run test`
Expected: All tests PASS.

- [ ] **Step 2: Run linter and typecheck**
Run: `npm run lint` and `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run production build**
Run: `npm run build`
Expected: Successful build.

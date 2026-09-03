# Watched Series & Episode History (+ In-Progress Cleanup) Implementation Plan

Track and display watched status for series episodes, seasons, and movies with persistent storage in IndexedDB v4, automatic completion detection, manual toggling, in-progress cleanup controls, and filtering in the VOD catalog.

## Proposed Changes

### Database Layer (`frontend/src/services`)

#### [MODIFY] [frontend/src/services/db.ts](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/frontend/src/services/db.ts)
- Upgrade `DB_VERSION` to `4`.
- Define `STORE_WATCHED_EPISODES = 'watched_episodes'`.
- In `onupgradeneeded`, create `watched_episodes` object store with `keyPath: 'id'` and indexes `by_seriesId` and `by_watchedAt`.
- Export interface `WatchedEpisodeRecord`:
  ```typescript
  export interface WatchedEpisodeRecord {
    id: string;             // "${seriesId}_s${season}_e${episodeIndex}" or "movie_${id}"
    seriesId?: string;
    seriesName?: string;
    season?: string;
    episodeIndex?: number;
    title: string;
    mediaType: 'series' | 'movie';
    watchedAt: number;
    autoMarked: boolean;
  }
  ```
- Implement CRUD operations:
  - `getWatchedEpisodes(): Promise<WatchedEpisodeRecord[]>`
  - `getWatchedEpisodesBySeries(seriesId: string): Promise<WatchedEpisodeRecord[]>`
  - `isEpisodeWatched(id: string): Promise<boolean>`
  - `saveWatchedEpisode(record: WatchedEpisodeRecord): Promise<void>`
  - `saveWatchedEpisodesBatch(records: WatchedEpisodeRecord[]): Promise<void>`
  - `removeWatchedEpisode(id: string): Promise<void>`
  - `removeWatchedEpisodesBatch(ids: string[]): Promise<void>`
  - `clearWatchedEpisodes(): Promise<void>`

#### [MODIFY] [frontend/src/services/db.test.ts](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/frontend/src/services/db.test.ts)
- Add unit tests verifying `watched_episodes` CRUD, batch operations, and index querying by `seriesId`.

---

### State Management (`frontend/src/store`)

#### [MODIFY] [frontend/src/store/playbackStore.ts](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/frontend/src/store/playbackStore.ts)
- Add `watchedMap: Record<string, WatchedEpisodeRecord>` to `PlaybackState`.
- Hydrate `watchedMap` from `db.getWatchedEpisodes()` in `init()`.
- In `saveProgress`:
  - When `isFinished === true` (`currentTime / duration >= VOD_COMPLETION_THRESHOLD`), automatically record to `watched_episodes` with `autoMarked: true`.
- Implement actions:
  - `markEpisodeWatched(record)`
  - `unmarkEpisodeWatched(id)`
  - `markSeasonWatched(series, season, episodes)`
  - `unmarkSeasonWatched(seriesId, season, episodes)`
  - `isWatched(id)`
  - `getSeriesWatchedCount(seriesId)`
  - `clearSeriesProgress(seriesId)`: removes all in-progress episodes belonging to the series.
  - `clearAllProgress()`: removes all in-progress items from Continue Watching and IndexedDB.

#### [MODIFY] [frontend/src/store/playbackStore.test.ts](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/frontend/src/store/playbackStore.test.ts)
- Add tests for automatic marking on completion, manual episode toggle, batch season toggle, `clearSeriesProgress`, and `clearAllProgress`.

---

### User Interface Layer

#### [MODIFY] [frontend/src/components/vod/SeriesModal.tsx](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/frontend/src/components/vod/SeriesModal.tsx)
- Subscribe to `watchedMap`, `isWatched`, `markEpisodeWatched`, `unmarkEpisodeWatched`, `markSeasonWatched`, `unmarkSeasonWatched`, `clearSeriesProgress` from `usePlaybackStore`.
- Header:
  - Add button `"Limpar progresso da série"` (if any episode has progress in Continue Watching) with toast feedback.
- Season header:
  - Add counter `Assistidos: X/Y episódios`.
  - Add toggle button: `"Marcar Temporada como Assistida"` / `"Desmarcar Temporada"`.
- Episode rows:
  - Add interactive checkmark button to toggle watched status with toast confirmation.
  - If watched: show green badge `✓ Assistido` and apply subtle opacity dimming (`opacity-80`) so unwatched episodes stand out.

#### [MODIFY] [frontend/src/pages/vod/VodPage.tsx](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/frontend/src/pages/vod/VodPage.tsx)
- Continue Watching rail:
  - Add a `"Limpar Tudo"` button with confirmation prompt in the header of the rail.
  - Make the close/remove button `(X)` on each card always accessible with subtle contrast instead of purely hover-only, and show toast feedback when removed.
- Filters & Catalog:
  - Add `'watched'` to `filterType` state: `all | movie | series | favorites | watched`.
  - Add "Assistidos" filter tab.
  - When `'watched'` filter is active, filter items to those with at least 1 watched episode or watched movie.
  - On series cards, render a badge indicating watched progress (e.g. `✓ 5 eps` ou `✓ Concluída`).

---

## Verification Plan

### Automated Tests
- `npx vitest run src/services/db.test.ts`
- `npx vitest run src/store/playbackStore.test.ts`
- `npx vitest run src/pages/vod/VodPage.test.tsx`
- `npx vitest run --exclude "**/SettingsPage.test.tsx"`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`

### Manual Verification
- In Continue Watching rail, test removing single item and clicking "Limpar Tudo".
- In SeriesModal, test "Limpar progresso da série".
- Test marking/unmarking episodes and seasons as watched, and filtering by "Assistidos".

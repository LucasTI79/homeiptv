# Task 1 — TV Guide screen (React + TS)

## Goal
Port the TV Guide screen from the legacy vanilla-JS app (`public/js/modules/guide.js`, 1104 lines) to a React + TypeScript component tree in `frontend/src/`, wired to the existing TS backend (`backend/src/routes/*.ts`) via the existing TanStack Query setup. Replace the `/guide` route's `<ComingSoonPage title="TV Guide" />` placeholder in `frontend/src/App.tsx` with the real screen.

This is a faithful **rewrite**, not a literal port: use React state/hooks instead of imperative DOM manipulation (`document.getElementById`, `.innerHTML`, manual class toggling). Read `public/js/modules/guide.js` for the exact behavior to replicate, but write idiomatic React.

## Context you need

**Existing frontend scaffolding (do not recreate, build on top of):**
- `frontend/src/App.tsx` — router. Replace the `/guide` route's element.
- `frontend/src/api/client.ts` — `apiFetch<T>(path, options)` helper (fetch wrapper, throws `ApiError` on non-2xx).
- `frontend/src/api/auth.ts` — example of the TanStack Query hook pattern used in this codebase (`useQuery`/`useMutation` wrapping `apiFetch`).
- `frontend/src/store/uiStore.ts` — Zustand store for UI-only state (currently just mobile nav). Add the "selected channel to play" state here (a `{ url, name, id } | null` field + setter) — the Player screen (a later task) will consume it. Do not put channel/EPG data here; that's server state and belongs in TanStack Query.
- `frontend/src/components/AppShell.tsx` — layout shell with nav, already renders `<Outlet />`.
- `shared/types/channel.ts` — `Channel` and `EpgProgram` interfaces (already defined, matches what you need).
- `shared/types/settings.ts` — `Settings` interface (global settings; note `favorites`, `recentChannels`, `activeGroupFilter`, `activeSourceFilter`, `channelColumnWidth` are **user-specific** settings, NOT on this `Settings` type — they come back from `/api/user/settings` merged with global settings, see below).
- `shared/types/dvr.ts` — `DvrJob`, `DvrJobStatus`.
- Import shared types via `@viniplay/shared-types` (see `frontend/src/api/auth.ts` for the import style).

**Backend endpoints you'll call (all already implemented, do not modify backend):**
- `GET /api/config` → `{ m3uContent: string | null, epgContent: Record<channelId, EpgProgram[]>, settings: Settings, vodMovies: [], vodSeries: [] }`. `m3uContent` is a raw M3U playlist string — you must parse it client-side (see parser spec below). This is the guide's channel + EPG data source.
- `POST /api/user/settings` body `{ key: string, value: unknown }` → `{ success: true, settings: Settings & user-specific }`. Used to persist `favorites` (string[] of channel ids), `activeGroupFilter`, `activeSourceFilter`, `recentChannels`. Response `settings` is the merged (global + user) settings object — treat the merged shape as `Settings & { favorites?: string[]; activeGroupFilter?: string; activeSourceFilter?: string; recentChannels?: string[]; channelColumnWidth?: number }` for typing purposes.
- `GET /api/image-proxy?url=<encoded original logo url>` — use this for **every** channel logo `<img>` src instead of the raw `channel.logo` URL (closes issue #113/#115 image mixed-content bug per the plan; this is a hard requirement, not optional).
- `POST /api/notifications` body `{ channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId }` → `{ success: true, id }`. Creates a "notify me" reminder for a program.
- `GET /api/notifications` → array of `{ id, channelId, programId, programTitle, scheduledTime, status, ... }`. Use to determine if a program already has a notification set (match by `programId`).
- `DELETE /api/notifications/:id` → `{ success: true }`. Cancels a notification.
- `POST /api/dvr/schedule` body `{ channelId, channelName, programTitle, programStart, programStop }` → `201 { success: true, job: DvrJob }` or `409 { error, newJob, conflictingJobs }` on conflict.
- `GET /api/dvr/jobs` → `DvrJob[]` (all jobs for the user, or all users' if admin). Use to determine if a program has a DVR job (match by `channelId` + overlapping `startTime`/`programStart`, same semantics as old code's `findDvrJobForProgram`).
- `DELETE /api/dvr/jobs/:id` → cancels a scheduled job (sets status `cancelled`).

**M3U parser — port this exactly** (from `public/js/modules/utils.js`, function `parseM3U`), as `frontend/src/lib/parseM3U.ts`, typed, returning `Channel[]`:
```js
export function parseM3U(data) {
    if (!data) return [];
    const lines = data.split('\n');
    const channels = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && (nextLine.startsWith('http') || nextLine.startsWith('rtp'))) {
                const idMatch = line.match(/tvg-id="([^"]*)"/);
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                const nameMatch = line.match(/tvg-name="([^"]*)"/);
                const groupMatch = line.match(/group-title="([^"]*)"/);
                const chnoMatch = line.match(/tvg-chno="([^"]*)"/);
                const sourceMatch = line.match(/vini-source="([^"]*)"/);
                const commaIndex = line.lastIndexOf(',');
                const displayName = (commaIndex !== -1) ? line.substring(commaIndex + 1).trim() : 'Unknown';
                channels.push({
                    id: idMatch ? idMatch[1] : `unknown-${Math.random()}`,
                    logo: logoMatch ? logoMatch[1] : '',
                    name: nameMatch ? nameMatch[1] : displayName,
                    group: groupMatch ? groupMatch[1] : 'Uncategorized',
                    chno: chnoMatch ? chnoMatch[1] : null,
                    source: sourceMatch ? sourceMatch[1] : 'Default',
                    displayName: displayName,
                    url: nextLine
                });
                i++;
            }
        }
    }
    return channels;
}
```
Also port `formatTimeWithOffset(date, offsetHours)` from the same file (same logic, typed) into `frontend/src/lib/formatTime.ts` — used for program start/end time display, respecting `settings.timezoneOffset`.

## Behavior to replicate (read `public/js/modules/guide.js` for exact reference)

1. **Data loading**: fetch `/api/config` via a `useConfig()` TanStack Query hook (`queryKey: ['config']`). Parse `m3uContent` with `parseM3U`. Build an EPG program list per channel from `epgContent`. Merge `favorites` (from `/api/user/settings`, fetched via a `useUserSettings()`-style hook or included in the same config flow — your call on how to fetch it, but do NOT put it in Zustand) into each channel's `isFavorite`.
2. **Filters**: Group filter (`all` / `favorites` / `recents` / actual group names) and Source filter (`all` / actual source names, hidden entirely if only one source exists) — both native `<select>` dropdowns, persisted to `activeGroupFilter`/`activeSourceFilter` via `/api/user/settings` on change, restored from user settings on load.
3. **Search**: text input, filters channels by name (and programs by title, if `settings.searchScope` includes `"programs"`) using fuzzy matching. **Explicit user requirement from the plan**: debounce the search input ~300ms before it affects filtering/re-render, and sync the debounced term to the URL via React Router's `useSearchParams` (`?q=...`) — so reloading or navigating back restores the exact search term and results without re-typing. Do not update the URL on every keystroke, only after the debounce settles. You do not need Fuse.js's exact fuzzy library — a simple case-insensitive substring match against name/displayName/source/chno (and program title) is an acceptable equivalent; note this as a decision in your report, don't treat exact fuzzy-matching parity as a hard requirement.
4. **Date picker**: select a date within the EPG's min/max date range (computed from all program start/stop times); changes reload the guide's programs for that day. Guide window is a rolling day (`guideState.guideDurationHours`, use 24) starting at local midnight of the selected date, adjusted by `settings.timezoneOffset`.
5. **Grid rendering**: channel list (left column, with logo via image-proxy, name, channel-number badge, source badge if >1 source, favorite star toggle) + horizontally-scrollable timeline per channel showing program blocks positioned/sized by start/duration within the visible day window, with a live-progress bar on the currently-airing program and a red "now" line. **Virtualize the vertical channel list** (only render rows near the viewport) since channel lists can be large — hand-roll simple scroll-position-based virtualization (windowing) with `useRef` + `onScroll`, no need for a virtualization library (none is in this project's dependency stack). A fixed row height is fine (use 96px, matching the legacy CSS).
6. **Clicking a channel** (not a program block) sets the "selected channel to play" in the Zustand `uiStore` and navigates to `/player` (the Player screen itself is a separate, later task — it does not exist yet, just wire the intent).
7. **Clicking a program block** opens a details modal: program title, time range (formatted with `formatTimeWithOffset`), description, a "Play" button (same play-and-navigate action as #6, using the program's parent channel), a favorite-star toggle for the channel, a "Notify Me"/"Notification Set" button (only shown if the program hasn't ended yet) that creates/cancels a notification via the endpoints above, and — only if the logged-in user has DVR access (`isAdmin` or `canUseDvr`, available from `useAuthStatus()` in `frontend/src/api/auth.ts`) — a "Record"/"Cancel Recording"/"Recording..."/"Recorded" button reflecting the DVR job status, wired to the schedule/cancel endpoints above.
8. **Favorites**: clicking the star (in the channel row or in the modal) toggles favorite status, persists the updated `favorites` array via `/api/user/settings`, and updates the UI immediately (optimistic).

## Explicitly out of scope for this task (do not build)
- The actual `/player` route content — just navigate there with the selected channel in `uiStore`.
- Full push-notification subscribe/permission UI (service worker registration, VAPID subscribe flow) — that's a separate, later task (`notification.js` port). For this task, "Notify Me" only needs to call `POST/DELETE /api/notifications` to create/cancel the reminder record; assume push delivery is handled elsewhere.
- Multiview, casting.
- Mobile hamburger menu fix (separate concern, already scoped to Wave 3's `AppShell`/nav work if not already done — check `AppShell.tsx`; if it already avoids the `transitionend` bug, leave it alone).

## File organization
Use `frontend/src/pages/GuidePage.tsx` as the route entry, decompose into components under `frontend/src/components/guide/` (e.g. `ChannelRow.tsx`, `ProgramBlock.tsx`, `ProgramDetailsModal.tsx`, `GuideFilters.tsx`, `GuideSearch.tsx`) and hooks under `frontend/src/api/` (e.g. `guide.ts` for `useConfig`, `useUserSettings`; `notifications.ts`; `dvr.ts` — check if `frontend/src/api/dvr.ts` or `notifications.ts` already exist before creating, and follow the existing hook style in `frontend/src/api/auth.ts`).

## Verification
- `cd frontend && npx tsc --noEmit` passes.
- `cd frontend && npm run build` succeeds.
- Manual smoke test: this repo has a dev launch config (`.claude/launch.json`) — start it, log in, navigate to `/guide`, confirm channels + EPG render, search works and survives a page reload with the term intact, date picker changes the visible day, clicking a program opens the modal with working Notify/Record buttons (if your test user has DVR access), favorite toggling persists across a reload.
- Report any legacy behavior you deliberately did not replicate (e.g. Fuse.js fuzzy matching, sticky-header collapse-on-scroll) as a concern in your report — these are lower-priority polish, not correctness requirements, but the controller should know what was traded off.

## Report contract
Write your full report to `.superpowers/sdd/wave3/task-1-report.md`. Return to the controller only: status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), the commit range, a one-line test summary (tsc/build/manual smoke result), and any concerns.

Commit your work when done (this repo works directly on `main`, no branch needed — confirmed with the user). Use a normal, non-caveman commit message describing the change.

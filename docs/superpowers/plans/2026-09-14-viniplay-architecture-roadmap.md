# ViniPlay Architecture Remediation Roadmap

> This is a roadmap, not an executable plan. Each phase below gets its own
> full implementation plan (file structure + TDD tasks) written just before
> it starts, so the plan reflects the codebase state after prior phases land.
> Do not execute this document directly — use `superpowers:writing-plans` to
> generate the detailed plan for the next phase when you're ready to start it.

**Source assessment:** see conversation review covering SRP, layering, testing,
memory/connection management, error standards, DI, playlist-type strategy,
subtitle/thumbnail pipeline, streaming protocols, DB portability, and
Docker dev/prod split.

**Execution model:** `superpowers:subagent-driven-development` — one fresh
subagent per task, two-stage review between tasks, inside this repo (no
worktree needed per phase unless a phase turns out to need isolation).

## Phase order and why

Phases are ordered so each one is buildable/testable in isolation and later
phases can depend on earlier ones without rework:

1. **Error handling foundation** — typed errors + central Express error
   middleware. Nothing else below needs to wait on this, but every later
   phase's new code should throw typed errors instead of `res.status().send()`,
   so doing it first avoids rewriting Phase 3-5 code twice.
2. **Injectable logger (`ILogger`)** — wraps the existing Winston setup,
   replaces the `console.*` monkey-patch in `logSystem.ts`. Every later
   phase's new services take a logger via constructor injection, so this
   also goes early.
3. **Connection/session hub generalization** — extend the
   `IRemoteSessionHub` pattern (already correct in
   `backend/src/services/remote/`) to active-stream state
   (`backend/src/state/streamState.ts`) and SSE clients
   (`backend/src/state/sseState.ts`). Produces `IConnectionHub<T>` used by
   Phase 5's stream service.
4. **Playlist source strategy** — `PlaylistSourceStrategy` interface with
   `M3uFileStrategy`, `M3uUrlStrategy`, `XtreamCodesStrategy` implementations,
   replacing the branching in `backend/src/services/sources.ts`. Independent
   of Phases 1-3 except for using the typed errors and logger.
5. **Route → service/repository extraction** — split `stream.ts`, `proxy.ts`,
   `sources.ts`, `vod.ts` route handlers into thin controllers over
   `StreamSessionService`, `MediaProxyService`, `SourceSyncService`,
   `VodService`, each backed by a repository for DB access. Depends on
   Phases 1-4 (uses typed errors, logger, connection hub, source strategies).
6. **Subtitle/thumbnail provider chain** — `SubtitleProvider` /
   `ThumbnailProvider` interfaces with a fallback chain
   (Whisper local → external API → embedded track / ffmpeg frame-grab →
   placeholder), wrapping the existing `transcriptionQueue.ts` and
   `videoIntelligence/` code instead of replacing it. Depends on Phase 2
   (logger) and Phase 1 (errors) only.
7. **Test infrastructure** — testcontainers for Postgres/MySQL migration
   parity tests, supertest route tests for the services extracted in
   Phase 5, contract test suite that runs against both `MemoryRemoteSessionHub`
   and `IConnectionHub` implementations. Depends on Phase 3 and 5 existing.
8. **Docker dev/prod split** — `docker-compose.dev.yml` (bind-mount +
   `tsx watch` / Vite dev server, hot reload) vs the existing
   `docker-compose.yml` (build + `node dist/src/index.js`). No code
   dependency on other phases; can run anytime, sequenced last only because
   it's lowest risk/value here.

## Note for Phase 5 (added post-Phase-4)

Phase 4 left a latent circular dependency between `sources.ts` and
`sourceStrategies/` (worked around with a dynamic `import()`, documented
at its call site and in Phase 4's plan doc). **Phase 5's first step should
be extracting `fetchUrlContent`/`SendStatus` out of `sources.ts` into a
standalone module** (e.g. `backend/src/services/httpFetch.ts`) that both
`sources.ts` and the strategies import from — this breaks the cycle for
good, at which point the dynamic import in `sources.ts` can revert to a
normal static one. See `2026-09-14-playlist-source-strategy.md`'s
Architecture section correction note for full detail.

## Definition of done per phase

Each phase's plan must end with:
- All new/changed code covered by vitest tests, `npm run typecheck` clean.
- No behavior regression: existing routes still return the same shape to
  the frontend (verify against `frontend/src/api` callers).
- A short migration note in the plan's final task if any existing call site
  (route, other service) had to change its import or call signature.

## Status

- [x] Phase 1: Error handling foundation — plan: `2026-09-14-error-handling-foundation.md` (merged to main)
- [x] Phase 2: Injectable logger — plan: `2026-09-14-injectable-logger.md` (merged to main)
- [x] Phase 3: Connection hub generalization — plan: `2026-09-14-connection-hub.md` (merged to main)
- [ ] Phase 4: Playlist source strategy — plan: `2026-09-14-playlist-source-strategy.md`
- [ ] Phase 5: Route → service/repository extraction
- [ ] Phase 6: Subtitle/thumbnail provider chain
- [ ] Phase 7: Test infrastructure (testcontainers + supertest)
- [ ] Phase 8: Docker dev/prod split

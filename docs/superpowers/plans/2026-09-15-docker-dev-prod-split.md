# Docker Dev/Prod Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the existing production `Dockerfile` (its multi-stage build is
currently broken — verified below) and add a second, dev-focused Docker
workflow with hot/live reload, so `docker compose --profile container up`
(prod, unchanged shape) and a new `docker compose -f docker-compose.dev.yml up`
(dev, new) are both real, working options, matching the project's existing
non-Docker `npm run dev` / `npm run build && npm start` split.

**Confirmed pre-existing bug:** running `docker build .` today fails at
`RUN npm run build -w @viniplay/frontend` with `npm error No workspaces
found: --workspace=@viniplay/frontend` — the actual workspace name (per
root `package.json`) is `@homeiptv/frontend`/`@homeiptv/backend`, not
`@viniplay/*`. The `shared` workspace has the same class of bug: root
`package.json` declares the workspace as `shared/types`, but the Dockerfile
does `COPY shared/package*.json ./shared/` (no such file — the real one is
at `shared/types/package.json`). This plan's Task 1 fixes both before
building anything new on top of a broken image.

**Architecture:** `Dockerfile` (existing, prod) gets its workspace names and
`shared` paths corrected — no other change to its multi-stage shape.
`Dockerfile.dev` (new) is a single-stage image that installs full
dependencies (including devDependencies — `tsx`, `vite`, `vitest`) and runs
the root `npm run dev` script (which runs both workspaces' `dev` scripts in
parallel via `--workspaces --if-present`, the same command already used for
non-Docker local dev). `docker-compose.dev.yml` (new) bind-mounts each
workspace's `src/` (and the few config files `tsx`/`vite` read directly)
into the dev image's container, so edits on the host are picked up by the
already-running `tsx watch`/`vite` processes with no rebuild — the
container's `node_modules` for every workspace stay in named volumes
instead of being bind-mounted from the host, so a native dependency
(`better-sqlite3`) built for the container's Linux/glibc target is never
shadowed by a host-built binary for a different OS/arch (this is what makes
the setup work identically from a Windows or macOS host, not just Linux).
`docker-compose.yml` (existing, prod) is untouched beyond whatever Task 1's
Dockerfile fix requires of it (nothing — it only references `Dockerfile`,
not its internals).

**Tech Stack:** Docker, Docker Compose, the project's existing `npm run dev`
/ `npm run build` scripts (no new dependencies).

**Spec:** N/A — derived from the roadmap's Phase 8 description and the
original architecture review's request for "um dev mode com hot/live
reload e um modo start". See roadmap:
`docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`.

## Global Constraints

- The existing `docker-compose.yml` prod service's shape (profile name,
  port mapping, volume mounts, `env_file`, the commented GPU passthrough
  block) is preserved exactly — only the `Dockerfile` it builds from is
  fixed.
- The dev workflow must actually hot-reload without a container rebuild —
  verified by editing a file on the host and observing the change without
  restarting the container, not just by inspecting the compose file.
- Native dependencies (`better-sqlite3`) must be installed inside the
  container for the container's platform, never bind-mounted from the
  host's `node_modules` — this is what makes the dev setup
  cross-platform-safe.
- `CHOKIDAR_USEPOLLING=true` is set in the dev compose file's environment
  (not baked into `vite.config.ts` or `tsx`'s own config) so both `vite`'s
  and `tsx watch`'s file watchers reliably see bind-mount filesystem events
  from a Windows or macOS Docker Desktop host, where native inotify events
  don't always propagate across the bind mount.
- English messages/identifiers in code and Dockerfiles; the README update
  in Task 3 is written in Portuguese, matching the rest of that file. No
  `tsconfig.json` changes. No changes to the `stream_history`/other table
  schemas. No new npm dependencies.

---

### Task 1: Fix the broken production `Dockerfile`

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Produces: nothing consumed by other tasks — this task's only output is a
  working image build.
- Consumes: nothing new.

- [ ] **Step 1: Reproduce the failure**

Run: `docker build -t viniplay-prod-check .`
Expected: FAILS at `RUN npm run build -w @viniplay/frontend` with
`npm error No workspaces found: --workspace=@viniplay/frontend`. Confirm
you see this exact failure before changing anything — it's the bug this
task fixes.

- [ ] **Step 2: Fix the workspace names and shared path**

In `Dockerfile`, find these two lines (in the builder stage):
```dockerfile
RUN npm run build -w @viniplay/frontend
RUN npm run build -w @viniplay/backend
```
Replace with:
```dockerfile
RUN npm run build -w @homeiptv/frontend
RUN npm run build -w @homeiptv/backend
```

Find, in both stages, every line referencing `shared` as a top-level
workspace path:
```dockerfile
COPY shared/package*.json ./shared/
```
and
```dockerfile
COPY shared ./shared
```
and (final stage)
```dockerfile
COPY --from=builder /usr/src/app/shared ./shared
```
Replace all three with paths matching the real workspace location
(`shared/types`, per root `package.json`'s `workspaces` array):
```dockerfile
COPY shared/types/package*.json ./shared/types/
```
```dockerfile
COPY shared/types ./shared/types
```
```dockerfile
COPY --from=builder /usr/src/app/shared/types ./shared/types
```

- [ ] **Step 3: Rebuild and verify the fix**

Run: `docker build -t viniplay-prod-check .`
Expected: PASS — the build completes through both `npm run build -w
@homeiptv/frontend` and `-w @homeiptv/backend`, and the final image is
tagged `viniplay-prod-check`.

- [ ] **Step 4: Smoke-test the built image**

Run:
```bash
docker run --rm -d --name viniplay-prod-smoke -p 18998:8998 \
  -e SESSION_SECRET=test-secret-at-least-32-characters-long \
  viniplay-prod-check
sleep 3
curl -sf http://localhost:18998/api/health
docker logs viniplay-prod-smoke
docker stop viniplay-prod-smoke
```
Expected: the `curl` call returns a JSON body with `"status":"ok"` (or
`"degraded"` if it can't reach a DB inside the container — either is fine
here, the point is the process started and answered HTTP requests, not
that its DB is configured). `docker logs` shows no crash/stack trace. If
`SESSION_SECRET` isn't the actual required env var name or minimum length,
check `backend/src/config/env.ts`'s schema first and use whatever it
actually requires — report the exact value you used.

- [ ] **Step 5: Clean up the test image**

Run: `docker rmi viniplay-prod-check`

- [ ] **Step 6: Commit**

```bash
git add Dockerfile
git commit -m "fix: correct workspace names and shared path in production Dockerfile"
```

---

### Task 2: `Dockerfile.dev` + `docker-compose.dev.yml` with hot reload

**Files:**
- Create: `Dockerfile.dev`
- Create: `docker-compose.dev.yml`
- Modify: `frontend/package.json` (add `--host` to the `dev` script)

**Interfaces:**
- Produces: nothing consumed by other tasks.
- Consumes: the root `npm run dev` script (unchanged) and
  `frontend/vite.config.ts`'s existing dev-proxy setup (unchanged — it
  already proxies `/api`, `/stream`, `/dvr` to `http://localhost:$
  {VITE_BACKEND_PORT || 8999}`, which resolves correctly here because both
  `vite` and the backend run as sibling processes inside the same
  container, sharing that container's `localhost`).

- [ ] **Step 1: Add `--host` to the frontend's dev script**

In `frontend/package.json`, change:
```json
"dev": "vite",
```
to:
```json
"dev": "vite --host",
```
(Vite's dev server binds to `localhost` only by default, which is
unreachable from outside its container. `--host` binds `0.0.0.0` instead.
This is harmless for host-only `npm run dev` too — it only widens which
network interfaces Vite listens on, it doesn't change routing or expose
anything beyond the local network the machine is already on.)

- [ ] **Step 2: Write `Dockerfile.dev`**

Create `Dockerfile.dev`:
```dockerfile
# Dev image: installs full dependencies (including devDependencies -- tsx,
# vite, vitest) and runs the same `npm run dev` script used for non-Docker
# local development. Source is bind-mounted in by docker-compose.dev.yml
# for hot reload; this image is never used for the "start" workflow -- see
# Dockerfile for the multi-stage production build.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    gnupg \
    python3-setuptools \
    ffmpeg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
COPY shared/types/package*.json ./shared/types/

RUN npm install

# 8999: backend API (tsx watch). 5173: Vite dev server (hot module reload).
EXPOSE 8999 5173

CMD ["npm", "run", "dev"]
```
(This dev image uses the plain `apt` `ffmpeg` package, not the
`jellyfin-ffmpeg`/VA-API build the production `Dockerfile` installs — dev
is for hot-reload coding, not hardware-transcode testing. Document this if
asked; it's an intentional scope reduction, not an oversight.)

- [ ] **Step 3: Write `docker-compose.dev.yml`**

Create `docker-compose.dev.yml`:
```yaml
services:
  homeiptv-dev:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: homeiptv-dev
    ports:
      - "8999:8999"
      - "5173:5173"
    volumes:
      # Bind-mount source only -- node_modules stay in named volumes below
      # so a native dependency (better-sqlite3) built for this container's
      # Linux/glibc target is never shadowed by a host-built binary for a
      # different OS/arch. This is what makes the setup work the same from
      # a Windows or macOS host, not just Linux.
      - ./backend/src:/usr/src/app/backend/src
      - ./backend/package.json:/usr/src/app/backend/package.json
      - ./backend/tsconfig.json:/usr/src/app/backend/tsconfig.json
      - ./backend/vitest.config.ts:/usr/src/app/backend/vitest.config.ts
      - ./frontend/src:/usr/src/app/frontend/src
      - ./frontend/public:/usr/src/app/frontend/public
      - ./frontend/index.html:/usr/src/app/frontend/index.html
      - ./frontend/vite.config.ts:/usr/src/app/frontend/vite.config.ts
      - ./frontend/tsconfig.json:/usr/src/app/frontend/tsconfig.json
      - ./frontend/package.json:/usr/src/app/frontend/package.json
      - ./shared/types/src:/usr/src/app/shared/types/src
      - ./shared/types/package.json:/usr/src/app/shared/types/package.json
      - ./package.json:/usr/src/app/package.json
      - ./data:/data
      - ./dvr:/dvr
      - homeiptv_dev_root_node_modules:/usr/src/app/node_modules
      - homeiptv_dev_backend_node_modules:/usr/src/app/backend/node_modules
      - homeiptv_dev_frontend_node_modules:/usr/src/app/frontend/node_modules
      - homeiptv_dev_shared_node_modules:/usr/src/app/shared/types/node_modules
    environment:
      - NODE_ENV=development
      - DATA_DIR=/data
      - DVR_DIR=/dvr
      # Bind-mount filesystem change events don't always propagate reliably
      # from a Windows/macOS Docker Desktop host into the container (no
      # native inotify across the mount) -- polling is the standard,
      # reliable cross-platform workaround both tsx's and Vite's watchers
      # respect via this env var.
      - CHOKIDAR_USEPOLLING=true
    env_file:
      - ./.env

volumes:
  homeiptv_dev_root_node_modules:
  homeiptv_dev_backend_node_modules:
  homeiptv_dev_frontend_node_modules:
  homeiptv_dev_shared_node_modules:
```

- [ ] **Step 4: Build and start it**

Run: `docker compose -f docker-compose.dev.yml up --build -d`
Expected: the `homeiptv-dev` container builds and starts. Run
`docker compose -f docker-compose.dev.yml logs -f homeiptv-dev` briefly and
confirm both the backend (`tsx watch`, listening on 8999) and Vite dev
server (listening on 5173) report ready in the log output, then stop
following logs (Ctrl-C, this doesn't stop the container).

- [ ] **Step 5: Verify hot reload for real, not by inspection**

Run: `curl -sf http://localhost:8999/api/health`
Expected: a JSON response (same endpoint Task 1 smoke-tested).

Then make a trivial, reversible edit on the host to prove live reload —
add a comment to `backend/src/routes/health.ts` (e.g. a line
`// hot-reload-check` right above `export const healthRouter`), save it,
wait 2-3 seconds, and run `docker compose -f docker-compose.dev.yml logs
--tail 20 homeiptv-dev` — expect to see `tsx watch` print a restart
message without you having run `docker compose ... restart` or rebuilt
anything. Revert the comment edit afterward (`git diff` should be empty
before you commit this task).

Do the same for the frontend: edit any visible string in
`frontend/src/App.tsx` (or whatever entry component exists), confirm
`docker compose -f docker-compose.dev.yml logs --tail 20 homeiptv-dev`
shows Vite's HMR update message, then revert the edit.

Report the exact log lines you saw for both cases in your report — "it
should work" is not sufficient evidence here, this step exists specifically
to catch a case where the bind mount or `CHOKIDAR_USEPOLLING` setting
doesn't actually work in this environment.

- [ ] **Step 6: Tear down**

Run: `docker compose -f docker-compose.dev.yml down -v`
(the `-v` removes the named `node_modules` volumes too, so the next
person's `up --build` starts clean — do this after you're done verifying,
not before Step 5).

- [ ] **Step 7: Commit**

```bash
git add Dockerfile.dev docker-compose.dev.yml frontend/package.json
git commit -m "feat: add Dockerfile.dev and docker-compose.dev.yml for hot-reload dev workflow"
```

---

### Task 3: Convenience scripts and documentation

**Files:**
- Modify: `package.json` (root)
- Modify: `README.md`

**Interfaces:**
- Produces: nothing consumed by other tasks.
- Consumes: `docker-compose.yml` (Task 1's fixed build), `docker-compose.dev.yml` (Task 2).

- [ ] **Step 1: Add root convenience scripts**

In the root `package.json`'s `scripts` block, add these three entries next
to the existing `"pm2:monit"` line:
```json
"docker:start": "docker compose --profile container up -d --build",
"docker:start:logs": "docker compose --profile container logs -f",
"docker:dev": "docker compose -f docker-compose.dev.yml up --build"
```
(`docker:dev` runs in the foreground on purpose — dev workflows benefit
from seeing `tsx`/`vite` output live; `docker:start` runs detached, since
that's how the README already documents the existing prod flow.)

- [ ] **Step 2: Document both modes in the README**

Read `README.md` first to match its existing tone/formatting (it's in
Portuguese). Find the existing `### 3. Produção com Docker Compose
(Recomendado para Servidores)` section. Immediately after that section
(before the next `###` heading, or at the end of the file if there is
none), add a new subsection:
```markdown
### 4. Desenvolvimento com Docker (hot reload)

Para desenvolver sem instalar Node.js/ffmpeg localmente, use o modo dev do
Docker Compose. Ele monta o código-fonte como volume, então alterações nos
arquivos `.ts`/`.tsx` são refletidas automaticamente (backend via `tsx
watch`, frontend via Vite HMR), sem precisar reconstruir a imagem.

\`\`\`bash
npm run docker:dev
\`\`\`

O backend fica em `http://localhost:8999` e o frontend (com hot reload) em
`http://localhost:5173`. Os dados persistentes ainda usam as pastas `./data`
e `./dvr` do host, como no modo produção.

Este modo usa `Dockerfile.dev`/`docker-compose.dev.yml`, separados do
`Dockerfile`/`docker-compose.yml` de produção -- nenhum dos dois modos
interfere no outro.
```

- [ ] **Step 3: Verify the new scripts parse correctly**

Run: `npm run docker:start --dry-run 2>&1 || true` and
`npm run docker:dev --dry-run 2>&1 || true` from the repo root (both just
need to not error on argument parsing — `--dry-run` on `npm run` prints
what would execute without running it).

Run: `cd backend && npm test && npm run typecheck`
Expected: PASS, no regressions (this task touches no backend code, but
confirm the suite is still green before committing, per this plan's
Definition of Done).

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "docs: add docker:dev/docker:start scripts and document both Docker workflows"
```

---

## Post-plan note

This closes the roadmap's Phase 8 and, with it, every phase in
`docs/superpowers/plans/2026-09-14-viniplay-architecture-roadmap.md`.
Remaining follow-up work explicitly deferred across the whole roadmap
(tracked in each phase's own plan doc, not repeated here): full route/
service extraction for `proxy.ts`/`sources.ts`'s routes/`vod.ts` (Phase 5's
scope note), an `ExternalApiSubtitleProvider` and a granular per-provider
config file (Phase 6's post-plan note), and a MySQL testcontainers variant
plus a `/stream` GET route test (Phase 7's post-plan note).

# Custom Cast Receiver & Stream Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Custom Web Receiver for Google Cast with extended inactivity timeout (1 hour), dynamic App ID configuration, a dynamic backend stream inactivity janitor (15 min default), and an automated keep-alive heartbeat loop.

**Architecture:** A standalone static web receiver in `cast-receiver/` powered by Google Cast CAF SDK (`maxInactivity: 3600`); dynamic settings in backend and shared types (`castReceiverAppId` and `streamInactivityTimeoutSeconds`); a resilient backend stream janitor in `streamState.ts` with a `POST /api/stream/keep-alive` endpoint; and frontend integration in `CastProvider.tsx` (dynamic receiver App ID + 30s heartbeat) and `ProfilesTab.tsx` (UI configuration).

**Tech Stack:** TypeScript, Node.js/Express, Google Cast CAF Receiver SDK (v1.0), React, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-14-custom-cast-receiver-and-stream-resilience-design.md](file:///home/lalvesdev/Documents/projects/personal/ViniPlay/docs/superpowers/specs/2026-10-14-custom-cast-receiver-and-stream-resilience-design.md)

## Global Constraints
- Version floors & dependencies: TypeScript 5+, Node 20+, Express 4, Vitest 4, Cast Application Framework CAF v1.0.
- Fallback requirement: If `castReceiverAppId` is empty or unset, the system MUST fallback to `'CC1AD845'` (Google Default Media Receiver).
- Minimum janitor tolerance: `streamInactivityTimeoutSeconds` MUST have a minimum floor of 60 seconds and default to 900 seconds (15 minutes).
- Receiver isolation: `cast-receiver/` MUST be completely static (vanilla HTML/JS/CSS), zero build dependencies, deployable directly to GitHub Pages or static host.

## Review Focus
1. **Unconfigured / Empty App ID**: When `settings.castReceiverAppId` is empty string or undefined, `CastProvider` must use `'CC1AD845'` without crashing.
2. **Zero or Negative Inactivity Timeout**: If user inputs 0 or negative seconds for `streamInactivityTimeoutSeconds`, the janitor must clamp to at least 60 seconds to prevent aggressive stream killing.
3. **Keep-alive on non-existent stream**: `POST /api/stream/keep-alive` for an unknown or expired stream key/url must return `{ success: true, touched: false }` gracefully without erroring.
4. **Heartbeat cleanup on session drop**: When Cast session ends (`SESSION_ENDED`), the keep-alive interval in `CastProvider` must be cleared immediately to avoid wasteful background requests.
5. **Proxy upstream pause tolerance**: `/api/media-proxy` must handle 60s inactivity without immediate socket termination when player pauses.

---

### Task 1: Shared Types & Settings Model Enhancement

**Files:**
- Modify: `shared/types/settings.ts:90-112`
- Modify: `backend/src/services/settings.ts:1-120`
- Test: `backend/src/services/__tests__/settings.cast.test.ts`

**Interfaces:**
- Consumes: Existing `Settings` interface and `getSettings()` / `saveSettings()` functions.
- Produces: `castReceiverAppId?: string` (defaults to `'CC1AD845'`) and `streamInactivityTimeoutSeconds?: number` (defaults to `900`) added to `Settings`.

- [ ] **Step 1: Write the failing test for default and custom cast settings**

Create `backend/src/services/__tests__/settings.cast.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings, updateSettings } from '../settings';

describe('Settings Cast & Inactivity configuration', () => {
  it('returns default castReceiverAppId and streamInactivityTimeoutSeconds when not explicitly set', () => {
    const settings = getSettings();
    expect(settings.castReceiverAppId ?? 'CC1AD845').toBe('CC1AD845');
    expect(settings.streamInactivityTimeoutSeconds ?? 900).toBe(900);
  });

  it('allows updating castReceiverAppId and streamInactivityTimeoutSeconds', () => {
    const updated = updateSettings({
      castReceiverAppId: 'A1B2C3D4',
      streamInactivityTimeoutSeconds: 1800,
    });
    expect(updated.castReceiverAppId).toBe('A1B2C3D4');
    expect(updated.streamInactivityTimeoutSeconds).toBe(1800);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/__tests__/settings.cast.test.ts` in `backend`
Expected: FAIL (types or default properties not yet added)

- [ ] **Step 3: Update `shared/types/settings.ts` and `backend/src/services/settings.ts`**

In `shared/types/settings.ts`:
Add `castReceiverAppId?: string;` and `streamInactivityTimeoutSeconds?: number;` to the `Settings` interface.

In `backend/src/services/settings.ts`:
In `DEFAULT_SETTINGS` (or default initialization):
Include `castReceiverAppId: 'CC1AD845'` and `streamInactivityTimeoutSeconds: 900`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/__tests__/settings.cast.test.ts` in `backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/types/settings.ts backend/src/services/settings.ts backend/src/services/__tests__/settings.cast.test.ts
git commit -m "feat(settings): add castReceiverAppId and streamInactivityTimeoutSeconds to settings"
```

---

### Task 2: Backend Janitor Dynamic Timeout & Keep-Alive Endpoint

**Files:**
- Modify: `backend/src/state/streamState.ts:60-98`
- Modify: `backend/src/routes/stream.ts:25-45, 215-265`
- Modify: `backend/src/routes/proxy.ts:290-300`
- Test: `backend/src/state/__tests__/streamState.janitor.test.ts`
- Test: `backend/src/routes/__tests__/stream.keep-alive.test.ts`

**Interfaces:**
- Consumes: `Settings.streamInactivityTimeoutSeconds`, `activeStreamProcesses`, `activeCastTokens`.
- Produces: `getStreamInactivityTimeoutMs(): number`, dynamic `cleanupInactiveStreams()`, `POST /api/stream/keep-alive`.

- [ ] **Step 1: Write failing tests for dynamic janitor timeout and keep-alive route**

Create `backend/src/state/__tests__/streamState.janitor.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activeStreamProcesses, cleanupInactiveStreams, getStreamInactivityTimeoutMs, type ActiveStreamInfo } from '../streamState';
import * as settingsService from '../../services/settings';

describe('streamState dynamic janitor timeout', () => {
  beforeEach(() => {
    activeStreamProcesses.clear();
  });

  it('returns default 900000ms when setting is undefined or 900', () => {
    vi.spyOn(settingsService, 'getSettings').mockReturnValue({
      streamInactivityTimeoutSeconds: 900,
    } as any);
    expect(getStreamInactivityTimeoutMs()).toBe(900_000);
  });

  it('clamps timeout to minimum 60000ms if set lower', () => {
    vi.spyOn(settingsService, 'getSettings').mockReturnValue({
      streamInactivityTimeoutSeconds: 10,
    } as any);
    expect(getStreamInactivityTimeoutMs()).toBe(60_000);
  });

  it('does NOT kill stream with references 0 if within inactivity timeout', () => {
    vi.spyOn(settingsService, 'getSettings').mockReturnValue({
      streamInactivityTimeoutSeconds: 900,
    } as any);

    const killSpy = vi.fn();
    activeStreamProcesses.set('test-stream-key', {
      process: { kill: killSpy } as any,
      references: 0,
      lastAccess: Date.now() - 120_000, // 2 minutes ago (well under 15m)
      startTime: new Date().toISOString(),
    } as ActiveStreamInfo);

    cleanupInactiveStreams();
    expect(killSpy).not.toHaveBeenCalled();
    expect(activeStreamProcesses.has('test-stream-key')).toBe(true);
  });

  it('kills stream with references 0 when inactivity timeout exceeded', () => {
    vi.spyOn(settingsService, 'getSettings').mockReturnValue({
      streamInactivityTimeoutSeconds: 900,
    } as any);

    const killSpy = vi.fn();
    activeStreamProcesses.set('stale-stream-key', {
      process: { kill: killSpy } as any,
      references: 0,
      lastAccess: Date.now() - 950_000, // > 15 minutes ago
      startTime: new Date().toISOString(),
    } as ActiveStreamInfo);

    cleanupInactiveStreams();
    expect(killSpy).toHaveBeenCalledWith('SIGKILL');
    expect(activeStreamProcesses.has('stale-stream-key')).toBe(false);
  });
});
```

Create `backend/src/routes/__tests__/stream.keep-alive.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { streamRouter } from '../stream';
import { activeStreamProcesses, type ActiveStreamInfo } from '../../state/streamState';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = { userId: 1, username: 'admin' } as any;
  next();
});
app.use(streamRouter);

describe('POST /api/stream/keep-alive', () => {
  beforeEach(() => {
    activeStreamProcesses.clear();
  });

  it('updates lastAccess for matching streamKey', async () => {
    const past = Date.now() - 100_000;
    activeStreamProcesses.set('1::http://example.com/ch1::profile1', {
      lastAccess: past,
    } as ActiveStreamInfo);

    const res = await request(app)
      .post('/api/stream/keep-alive')
      .send({ streamKey: '1::http://example.com/ch1::profile1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.touched).toBe(true);
    expect(activeStreamProcesses.get('1::http://example.com/ch1::profile1')!.lastAccess).toBeGreaterThan(past);
  });

  it('returns touched false gracefully when stream is not active', async () => {
    const res = await request(app)
      .post('/api/stream/keep-alive')
      .send({ streamUrl: 'http://nonexistent.com/stream' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.touched).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/state/__tests__/streamState.janitor.test.ts src/routes/__tests__/stream.keep-alive.test.ts` in `backend`
Expected: FAIL

- [ ] **Step 3: Implement dynamic timeout in `streamState.ts`, keep-alive in `stream.ts`, and proxy timeout in `proxy.ts`**

In `backend/src/state/streamState.ts`:
- Implement `getStreamInactivityTimeoutMs()` pulling from `getSettings().streamInactivityTimeoutSeconds`, clamped to `Math.max(60, seconds) * 1000`.
- In `cleanupInactiveStreams()`: use `getStreamInactivityTimeoutMs()` instead of `STREAM_INACTIVITY_TIMEOUT`.

In `backend/src/routes/stream.ts`:
- Add `POST /api/stream/keep-alive` with `allowLocalOrAuth(activeCastTokens)` handler:
  Update `lastAccess = Date.now()` for any `activeStreamProcesses` matching `streamKey` or `streamUrl`.

In `backend/src/routes/proxy.ts`:
- Adjust `timeout: 30000` to `timeout: 60000`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/state/__tests__/streamState.janitor.test.ts src/routes/__tests__/stream.keep-alive.test.ts` in `backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/state/streamState.ts backend/src/routes/stream.ts backend/src/routes/proxy.ts backend/src/state/__tests__/streamState.janitor.test.ts backend/src/routes/__tests__/stream.keep-alive.test.ts
git commit -m "feat(backend): dynamic stream janitor timeout and keep-alive endpoint"
```

---

### Task 3: Custom Web Receiver Application (`cast-receiver/`)

**Files:**
- Create: `cast-receiver/index.html`
- Create: `cast-receiver/receiver.js`
- Create: `cast-receiver/style.css`
- Create: `cast-receiver/assets/logo.svg`
- Create: `cast-receiver/README.md`

**Interfaces:**
- Consumes: Google Cast CAF Receiver SDK `https://www.gstatic.com/cast/sdk/libs/caf_receiver/v1.0/cast_receiver_framework.js`.
- Produces: Complete static receiver web app configured with `options.maxInactivity = 3600`, custom ViniPlay branding, and deployment guide.

- [ ] **Step 1: Create `cast-receiver/assets/logo.svg`**

Create clean SVG logo with "ViniPlay" brand icon and text.

- [ ] **Step 2: Create `cast-receiver/style.css`**

Create styles for:
- CSS variables for ViniPlay theme (midnight blue background, cyan/blue accent `#3b82f6`, white text).
- Splash screen (`#splash`) with centered logo, smooth breathing animation, and connection status indicator.
- `<cast-media-player>` skin overrides for smooth progress bar and volume display.

- [ ] **Step 3: Create `cast-receiver/receiver.js`**

Implement:
```javascript
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

const options = new cast.framework.CastReceiverOptions();
// Set maxInactivity to 3600 seconds (1 hour) to prevent premature 5-minute disconnects
options.maxInactivity = 3600;
options.supportedCommands =
  cast.framework.messages.Command.ALL_BASIC_MEDIA |
  cast.framework.messages.Command.SEEK |
  cast.framework.messages.Command.STREAM_VOLUME |
  cast.framework.messages.Command.STREAM_MUTE;

// Intercept LOAD request to tune Shaka player & format metadata
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    const splash = document.getElementById('splash');
    if (splash) splash.classList.add('hidden');
    return loadRequestData;
  }
);

context.start(options);
```

- [ ] **Step 4: Create `cast-receiver/index.html`**

HTML document linking CAF SDK script, `<cast-media-player>`, `style.css`, `receiver.js`, and `#splash` container.

- [ ] **Step 5: Create `cast-receiver/README.md`**

Step-by-step guide explaining:
1. How to push/host `cast-receiver` on GitHub Pages (e.g. `https://[username].github.io/[repo]/cast-receiver/`).
2. How to create an Application in [Google Cast Developer Console](https://cast.google.com/publish) (Custom Receiver -> URL -> Application ID).
3. How to paste the generated App ID into ViniPlay Settings.

- [ ] **Step 6: Commit**

```bash
git add cast-receiver/
git commit -m "feat(receiver): add custom web receiver with 1-hour inactivity timeout and branding"
```

---

### Task 4: Frontend CastProvider Dynamic App ID & Keep-Alive Loop

**Files:**
- Modify: `frontend/src/components/cast/CastProvider.tsx:1-120, 215-230, 305-325`
- Test: `frontend/src/components/cast/__tests__/CastProvider.test.tsx`

**Interfaces:**
- Consumes: `settings?.castReceiverAppId` from `useConfig()`, `POST /api/stream/keep-alive`.
- Produces: `CastProvider` initializing `receiverApplicationId` dynamically and running 30s heartbeat loop while `isCasting && isConnected`.

- [ ] **Step 1: Write test for dynamic receiver ID and heartbeat dispatch in CastProvider**

Create `frontend/src/components/cast/__tests__/CastProvider.test.tsx`:
```typescript
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CastProvider, useCast } from '../CastProvider';
import * as guideApi from '../../../api/guide';

vi.mock('../../../api/guide', () => ({
  useConfig: vi.fn(),
}));

describe('CastProvider dynamic App ID and keep-alive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses default CC1AD845 when castReceiverAppId is empty', () => {
    (guideApi.useConfig as any).mockReturnValue({
      data: { settings: { castReceiverAppId: '' } },
    });

    const setOptionsMock = vi.fn();
    window.cast = {
      framework: {
        CastContext: {
          getInstance: () => ({
            setOptions: setOptionsMock,
            addEventListener: vi.fn(),
          }),
        },
        RemotePlayer: vi.fn().mockImplementation(() => ({})),
        RemotePlayerController: vi.fn().mockImplementation(() => ({
          addEventListener: vi.fn(),
        })),
        LoggerLevel: { DEBUG: 0 },
        setLoggerLevel: vi.fn(),
      },
    } as any;

    window.__isCastAvailable = true;

    function TestComponent() {
      const { isAvailable } = useCast();
      return <div>Available: {String(isAvailable)}</div>;
    }

    render(
      <CastProvider>
        <TestComponent />
      </CastProvider>
    );

    expect(setOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ receiverApplicationId: 'CC1AD845' })
    );
  });

  it('uses configured castReceiverAppId when present', () => {
    (guideApi.useConfig as any).mockReturnValue({
      data: { settings: { castReceiverAppId: 'MY_CUSTOM_APP_ID' } },
    });

    const setOptionsMock = vi.fn();
    window.cast = {
      framework: {
        CastContext: {
          getInstance: () => ({
            setOptions: setOptionsMock,
            addEventListener: vi.fn(),
          }),
        },
        RemotePlayer: vi.fn().mockImplementation(() => ({})),
        RemotePlayerController: vi.fn().mockImplementation(() => ({
          addEventListener: vi.fn(),
        })),
        LoggerLevel: { DEBUG: 0 },
        setLoggerLevel: vi.fn(),
      },
    } as any;

    window.__isCastAvailable = true;

    function TestComponent() {
      useCast();
      return <div>Ready</div>;
    }

    render(
      <CastProvider>
        <TestComponent />
      </CastProvider>
    );

    expect(setOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ receiverApplicationId: 'MY_CUSTOM_APP_ID' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/cast/__tests__/CastProvider.test.tsx` in `frontend`
Expected: FAIL

- [ ] **Step 3: Update `CastProvider.tsx`**

In `frontend/src/components/cast/CastProvider.tsx`:
1. In `initializeCastApi()`:
   Read `const appId = settings?.castReceiverAppId?.trim() || APPLICATION_ID;` and pass to `castContext.setOptions({ receiverApplicationId: appId, ... })`.
2. Add heartbeat loop:
   While `isCasting && isConnected`:
   Set an interval every 30_000ms sending:
   ```typescript
   fetch('/api/stream/keep-alive', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ streamUrl: currentCastState.current.streamUrl }),
   }).catch(() => {});
   ```
   Clear interval in cleanup / `handleSessionEnd`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/cast/__tests__/CastProvider.test.tsx` in `frontend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cast/CastProvider.tsx frontend/src/components/cast/__tests__/CastProvider.test.tsx
git commit -m "feat(cast): integrate dynamic receiver app id and 30s heartbeat loop"
```

---

### Task 5: Settings UI in ProfilesTab (`ProfilesTab.tsx`)

**Files:**
- Modify: `frontend/src/components/settings/ProfilesTab.tsx:160-220`
- Test: `frontend/src/components/settings/__tests__/ProfilesTab.cast.test.tsx`

**Interfaces:**
- Consumes: `settings.castReceiverAppId`, `settings.streamInactivityTimeoutSeconds`, `updateSettings` mutation.
- Produces: Visual fields in `ProfilesTab` to view and update Cast App ID and Inactivity Timeout.

- [ ] **Step 1: Write test for ProfilesTab cast settings inputs**

Create `frontend/src/components/settings/__tests__/ProfilesTab.cast.test.tsx`:
```typescript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProfilesTab } from '../ProfilesTab';
import { renderWithProviders } from '../../../test/renderWithProviders';

describe('ProfilesTab Cast settings', () => {
  it('renders Google Cast Application ID input and timeout selector', () => {
    renderWithProviders(<ProfilesTab />);
    expect(screen.getByLabelText(/Google Cast Application ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tempo Limite de Inatividade/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/settings/__tests__/ProfilesTab.cast.test.tsx` in `frontend`
Expected: FAIL

- [ ] **Step 3: Add Cast settings inputs to `ProfilesTab.tsx`**

In `frontend/src/components/settings/ProfilesTab.tsx`:
In the "Active Streaming & Cast Configuration" card:
Add:
1. `Google Cast Application ID` input with label and helper text:
   - State: `castReceiverAppId`, default to config value or `''`.
   - Placeholder: `CC1AD845 (Default Media Receiver)`.
2. `Tempo Limite de Inatividade (Janitor)` select with options:
   - 300s (5 min), 600s (10 min), 900s (15 min - Recomendado), 1800s (30 min).
3. Include both fields in `handleSaveActiveProfiles()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/settings/__tests__/ProfilesTab.cast.test.tsx` in `frontend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/ProfilesTab.tsx frontend/src/components/settings/__tests__/ProfilesTab.cast.test.tsx
git commit -m "feat(ui): add cast application id and stream inactivity timeout to settings"
```

---

### Task 6: End-to-End Verification & Health Check

**Files:**
- Verify: Full backend build and tests (`npm test` in `backend`)
- Verify: Full frontend build (`npm run build` in `frontend`)

- [ ] **Step 1: Run all backend tests**

Run: `npm test` in `backend`
Expected: All tests PASS.

- [ ] **Step 2: Run frontend build**

Run: `npm run build` in `frontend`
Expected: Build succeeds without TypeScript or Vite bundle errors.

- [ ] **Step 3: Final Commit**

```bash
git add .
git commit -m "chore: verify build and complete custom cast receiver & stream resilience"
```

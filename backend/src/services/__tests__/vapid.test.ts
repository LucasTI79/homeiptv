import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ILogger } from '../../logging';

// `config/env.ts` resolves a session secret at module-import time, touching
// `fs` itself. Since `fs` is mocked globally below, that resolution would
// otherwise run against the mock too (and blow up whenever a test makes
// `fs.existsSync` throw). Pre-setting SESSION_SECRET makes that codepath a
// no-op so the mocked `fs` only ever reflects vapid.ts's own calls.
process.env.SESSION_SECRET = 'test-session-secret';

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
    // `../vapid` transitively imports `./logSystem`, which makes its own
    // fs.existsSync call at module-load time (before initializeVapid runs).
    // Let that first call through safely, then throw on the next one, which
    // is vapid.ts's own existsSync(VAPID_KEYS_PATH) check inside initializeVapid.
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    vi.mocked(fs.existsSync).mockImplementationOnce(() => { throw new Error('disk failure'); });

    const { initializeVapid } = await import('../vapid');
    const { logger, calls } = buildSpyLogger();

    initializeVapid(logger);

    expect(calls.some((c) => c.level === 'error' && c.message.includes('Could not load or generate VAPID keys'))).toBe(true);
  });
});

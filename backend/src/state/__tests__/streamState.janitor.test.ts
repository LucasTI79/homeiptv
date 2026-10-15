import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activeStreamProcesses, cleanupInactiveStreams, getStreamInactivityTimeoutMs, type ActiveStreamInfo } from '../streamState';
import * as settingsService from '../../services/settings';

describe('streamState dynamic janitor timeout', () => {
  beforeEach(() => {
    activeStreamProcesses.clear();
    vi.restoreAllMocks();
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
      historyId: 0,
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
      historyId: 0,
    } as ActiveStreamInfo);

    cleanupInactiveStreams();
    expect(killSpy).toHaveBeenCalledWith('SIGKILL');
    expect(activeStreamProcesses.has('stale-stream-key')).toBe(false);
  });
});

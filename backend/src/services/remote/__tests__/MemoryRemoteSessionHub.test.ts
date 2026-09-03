import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryRemoteSessionHub } from '../MemoryRemoteSessionHub';
import { RemoteMessage, RemoteNowPlayingState } from '@homeiptv/shared-types';

describe('MemoryRemoteSessionHub', () => {
  let hub: MemoryRemoteSessionHub;

  beforeEach(() => {
    hub = new MemoryRemoteSessionHub(3600); // 1 hour TTL for testing
  });

  afterEach(() => {
    hub.destroy();
  });

  it('should create a session with a valid 6-digit pin code and sessionId', async () => {
    const session = await hub.createSession('host-pc-1');
    expect(session.sessionId).toBeDefined();
    expect(session.pinCode).toMatch(/^\d{3}-\d{3}$/);
    expect(session.hostDeviceId).toBe('host-pc-1');
  });

  it('should retrieve a session by sessionId and by pinCode', async () => {
    const session = await hub.createSession('host-pc-2');
    const byId = await hub.getSession(session.sessionId);
    expect(byId).toEqual(session);

    const byPin = await hub.getSessionByPin(session.pinCode);
    expect(byPin).toEqual(session);

    // Also support pin without hyphen
    const cleanPin = session.pinCode.replace('-', '');
    const byCleanPin = await hub.getSessionByPin(cleanPin);
    expect(byCleanPin).toEqual(session);
  });

  it('should update nowPlaying state and retrieve it', async () => {
    const session = await hub.createSession('host-pc-3');
    const state: RemoteNowPlayingState = {
      title: 'Breaking Bad',
      isVod: true,
      isLive: false,
      isPaused: false,
      currentTime: 120,
      duration: 3600,
      volume: 80,
      isMuted: false,
    };

    await hub.updateNowPlaying(session.sessionId, state);
    const updated = await hub.getSession(session.sessionId);
    expect(updated?.nowPlaying).toEqual(state);
  });

  it('should publish messages to subscribed sockets in the session', async () => {
    const session = await hub.createSession('host-pc-4');
    const receivedHost: RemoteMessage[] = [];
    const receivedClient: RemoteMessage[] = [];

    const unsubHost = hub.subscribeToSession(session.sessionId, 'socket-host', (msg) => {
      receivedHost.push(msg);
    });

    const unsubClient = hub.subscribeToSession(session.sessionId, 'socket-client', (msg) => {
      receivedClient.push(msg);
    });

    expect(hub.getClientCount(session.sessionId)).toBe(2);

    const msg: RemoteMessage = { type: 'COMMAND_PLAY_PAUSE' };
    // Client sends message to session, excluding itself
    await hub.publishToSession(session.sessionId, msg, 'socket-client');

    expect(receivedHost).toHaveLength(1);
    expect(receivedHost[0]).toEqual(msg);
    expect(receivedClient).toHaveLength(0); // Excluded sender

    unsubHost();
    unsubClient();
  });

  it('should remove sockets and track client count correctly', async () => {
    const session = await hub.createSession('host-pc-5');

    hub.subscribeToSession(session.sessionId, 'socket-1', vi.fn());
    hub.subscribeToSession(session.sessionId, 'socket-2', vi.fn());
    expect(hub.getClientCount(session.sessionId)).toBe(2);

    await hub.removeSocket('socket-1');
    expect(hub.getClientCount(session.sessionId)).toBe(1);

    await hub.removeSocket('socket-2');
    expect(hub.getClientCount(session.sessionId)).toBe(0);
  });

  it('should close session and cleanup all references', async () => {
    const session = await hub.createSession('host-pc-6');
    await hub.closeSession(session.sessionId);

    expect(await hub.getSession(session.sessionId)).toBeNull();
    expect(await hub.getSessionByPin(session.pinCode)).toBeNull();
  });
});

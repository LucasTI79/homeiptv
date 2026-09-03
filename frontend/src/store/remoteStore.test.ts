import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRemoteStore } from './remoteStore';

class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public url: string;
  public readyState: number = WebSocket.CONNECTING;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((err: any) => void) | null = null;
  public sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 10);
  }

  public send(data: string) {
    this.sent.push(data);
  }

  public close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }
}

describe('useRemoteStore', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances = [];
    localStorage.clear();
    useRemoteStore.getState().disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with default standalone state', () => {
    const state = useRemoteStore.getState();
    expect(state.isPaired).toBe(false);
    expect(state.role).toBe('standalone');
    expect(state.sessionId).toBeNull();
    expect(state.remoteNowPlaying).toBeNull();
  });

  it('connects as client and initializes WebSocket', async () => {
    await useRemoteStore.getState().connectAsClient('test-session-123', '999-888');

    expect(useRemoteStore.getState().role).toBe('client');
    expect(useRemoteStore.getState().sessionId).toBe('test-session-123');

    const wsInstance = MockWebSocket.instances[0];
    expect(wsInstance).toBeDefined();
    expect(wsInstance.url).toContain('sessionId=test-session-123');
    expect(wsInstance.url).toContain('role=client');

    // Wait for onopen
    await new Promise((r) => setTimeout(r, 20));
    expect(useRemoteStore.getState().isPaired).toBe(true);
    expect(useRemoteStore.getState().connectionStatus).toBe('connected');

    // Simulate SYNC_STATE from server
    wsInstance.onmessage?.({
      data: JSON.stringify({
        type: 'SYNC_STATE',
        payload: {
          title: 'Better Call Saul',
          isVod: true,
          isLive: false,
          isPaused: false,
          currentTime: 300,
          duration: 3000,
          volume: 100,
          isMuted: false,
        },
      }),
    });

    expect(useRemoteStore.getState().remoteNowPlaying?.title).toBe('Better Call Saul');
  });

  it('sends commands through active socket', async () => {
    await useRemoteStore.getState().connectAsClient('test-session-456');
    await new Promise((r) => setTimeout(r, 20));

    const wsInstance = MockWebSocket.instances[0];
    useRemoteStore.getState().sendCommand({ type: 'COMMAND_PLAY_PAUSE' });

    expect(wsInstance.sent).toContain(JSON.stringify({ type: 'COMMAND_PLAY_PAUSE' }));
  });

  it('disconnects and clears local storage', async () => {
    await useRemoteStore.getState().connectAsClient('test-session-789');
    await new Promise((r) => setTimeout(r, 20));

    expect(useRemoteStore.getState().isPaired).toBe(true);
    useRemoteStore.getState().disconnect();

    expect(useRemoteStore.getState().isPaired).toBe(false);
    expect(useRemoteStore.getState().sessionId).toBeNull();
    expect(localStorage.getItem('viniplay_remote_session')).toBeNull();
  });
});

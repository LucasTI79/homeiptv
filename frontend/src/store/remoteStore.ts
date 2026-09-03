import { create } from 'zustand';
import type { RemoteMessage, RemoteNowPlayingState } from '@homeiptv/shared-types';

export interface RemoteStoreState {
  isPaired: boolean;
  role: 'host' | 'client' | 'standalone';
  sessionId: string | null;
  pinCode: string | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  clientCount: number;
  remoteNowPlaying: RemoteNowPlayingState | null;

  startHostSession: () => Promise<{ sessionId: string; pinCode: string }>;
  connectAsClient: (sessionId: string, pin?: string) => Promise<void>;
  connectByPin: (pin: string) => Promise<boolean>;
  sendCommand: (message: RemoteMessage) => void;
  syncHostPlayback: (state: RemoteNowPlayingState) => void;
  setHostCommandListener: (listener: (msg: RemoteMessage) => void) => () => void;
  disconnect: () => void;
  checkAutoReconnect: () => Promise<void>;
}

const STORAGE_KEY = 'viniplay_remote_session';

let activeSocket: WebSocket | null = null;
let reconnectTimer: any = null;
let heartbeatInterval: any = null;
let hostCommandListener: ((msg: RemoteMessage) => void) | null = null;

function getWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export const useRemoteStore = create<RemoteStoreState>((set, get) => {
  function cleanupSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (activeSocket) {
      activeSocket.onclose = null;
      activeSocket.onerror = null;
      activeSocket.onmessage = null;
      activeSocket.onopen = null;
      activeSocket.close();
      activeSocket = null;
    }
  }

  function setupHeartbeat(ws: WebSocket) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 15000);
  }

  function initSocket(sessionId: string, role: 'host' | 'client') {
    cleanupSocket();
    set({ connectionStatus: 'connecting' });

    const wsUrl = getWebSocketUrl(`/ws/remote?role=${role}&sessionId=${encodeURIComponent(sessionId)}`);
    const ws = new WebSocket(wsUrl);
    activeSocket = ws;

    ws.onopen = () => {
      set({
        isPaired: true,
        role,
        sessionId,
        connectionStatus: 'connected',
      });
      setupHeartbeat(ws);

      if (role === 'client') {
        ws.send(JSON.stringify({ type: 'REQUEST_SYNC' }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as RemoteMessage;
        if (message.type === 'SYNC_STATE') {
          set({ remoteNowPlaying: message.payload });
        } else if (message.type === 'SESSION_PAIRED') {
          set({ clientCount: message.payload.clientCount });
        } else if (message.type === 'HOST_DISCONNECTED') {
          set({
            remoteNowPlaying: null,
            connectionStatus: 'reconnecting',
          });
        }

        // If host received a command, notify listener
        if (role === 'host' && hostCommandListener) {
          hostCommandListener(message);
        }
      } catch (err) {
        console.warn('[remoteStore] Error parsing WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      const currentRole = get().role;
      if (currentRole === 'client') {
        set({ connectionStatus: 'reconnecting' });
        // Attempt automatic reconnection
        reconnectTimer = setTimeout(() => {
          if (get().role === 'client' && get().sessionId) {
            initSocket(get().sessionId!, 'client');
          }
        }, 2000);
      } else {
        set({
          isPaired: false,
          connectionStatus: 'disconnected',
        });
      }
    };

    ws.onerror = (err) => {
      console.warn('[remoteStore] WebSocket error:', err);
    };
  }

  // Setup visibility change listener once
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const { role, sessionId } = get();
        if (role === 'client' && sessionId) {
          if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
            initSocket(sessionId, 'client');
          } else {
            activeSocket.send(JSON.stringify({ type: 'REQUEST_SYNC' }));
          }
        }
      }
    });
  }

  return {
    isPaired: false,
    role: 'standalone',
    sessionId: null,
    pinCode: null,
    connectionStatus: 'disconnected',
    clientCount: 0,
    remoteNowPlaying: null,

    startHostSession: async () => {
      try {
        const res = await fetch('/api/remote/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostDeviceId: `host-${Date.now()}` }),
        });
        if (!res.ok) throw new Error('Failed to create remote session');
        const data = await res.json();
        set({ pinCode: data.pinCode, sessionId: data.sessionId, role: 'host' });
        initSocket(data.sessionId, 'host');
        return { sessionId: data.sessionId, pinCode: data.pinCode };
      } catch (err) {
        console.error('[remoteStore] Failed to start host session:', err);
        throw err;
      }
    },

    connectAsClient: async (sessionId: string, pin?: string) => {
      try {
        set({ role: 'client', sessionId, pinCode: pin || null });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, pin }));
        initSocket(sessionId, 'client');
      } catch (err) {
        console.error('[remoteStore] Failed to connect as client:', err);
        throw err;
      }
    },

    connectByPin: async (pin: string) => {
      try {
        const cleanPin = pin.trim().replace(/\s+/g, '');
        const res = await fetch(`/api/remote/sessions/by-pin/${encodeURIComponent(cleanPin)}`);
        if (!res.ok) return false;
        const data = await res.json();
        await get().connectAsClient(data.sessionId, data.pinCode);
        return true;
      } catch (err) {
        console.error('[remoteStore] Failed to connect by pin:', err);
        return false;
      }
    },

    sendCommand: (message: RemoteMessage) => {
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.send(JSON.stringify(message));
      } else {
        console.warn('[remoteStore] Cannot send command, socket not open');
      }
    },

    syncHostPlayback: (state: RemoteNowPlayingState) => {
      if (get().role === 'host' && activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        set({ remoteNowPlaying: state });
        activeSocket.send(JSON.stringify({ type: 'SYNC_STATE', payload: state }));
      }
    },

    setHostCommandListener: (listener: (msg: RemoteMessage) => void) => {
      hostCommandListener = listener;
      return () => {
        if (hostCommandListener === listener) {
          hostCommandListener = null;
        }
      };
    },

    disconnect: () => {
      cleanupSocket();
      localStorage.removeItem(STORAGE_KEY);
      set({
        isPaired: false,
        role: 'standalone',
        sessionId: null,
        pinCode: null,
        connectionStatus: 'disconnected',
        clientCount: 0,
        remoteNowPlaying: null,
      });
    },

    checkAutoReconnect: async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (parsed?.sessionId) {
          // Verify session still exists on backend
          const res = await fetch(`/api/remote/sessions/${encodeURIComponent(parsed.sessionId)}`);
          if (res.ok) {
            get().connectAsClient(parsed.sessionId, parsed.pin);
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
  };
});

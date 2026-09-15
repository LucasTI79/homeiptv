import { create } from 'zustand';
import type { RemoteMessage, RemoteNowPlayingState, RemoteUserContext } from '@homeiptv/shared-types';
import { usePlaybackStore } from './playbackStore';
import { useDownloadStore } from './downloadStore';
import { useUiStore } from './uiStore';

export interface RemoteStoreState {
  isPaired: boolean;
  role: 'host' | 'client' | 'standalone';
  sessionId: string | null;
  pinCode: string | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  clientCount: number;
  remoteNowPlaying: RemoteNowPlayingState | null;
  clientCompletedDownloads: string[];

  startHostSession: () => Promise<{ sessionId: string; pinCode: string }>;
  connectAsClient: (sessionId: string, pin?: string) => Promise<void>;
  connectByPin: (pin: string) => Promise<boolean>;
  sendCommand: (message: RemoteMessage) => void;
  syncHostPlayback: (state: RemoteNowPlayingState) => void;
  syncHostUserContext: (context: RemoteUserContext) => void;
  setHostCommandListener: (listener: (msg: RemoteMessage) => void) => () => void;
  setHostNavigateCallback: (cb: ((path: string) => void) | null) => void;
  disconnect: () => void;
  checkAutoReconnect: () => Promise<void>;
}

const STORAGE_KEY = 'viniplay_remote_session';

let activeSocket: WebSocket | null = null;
let reconnectTimer: any = null;
let heartbeatInterval: any = null;
let hostCommandListener: ((msg: RemoteMessage) => void) | null = null;
let hostNavigateCallback: ((path: string) => void) | null = null;

function getWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

function getCompletedDownloadIds(): string[] {
  try {
    const downloadStore = useDownloadStore.getState();
    const tasks = downloadStore.tasks;
    if (Object.keys(tasks).length === 0) {
      downloadStore.initDownloads().catch(() => {});
    }
    return Object.values(tasks)
      .filter((t) => t.status === 'completed')
      .map((t) => t.id);
  } catch {
    return [];
  }
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
        } else if (message.type === 'SYNC_USER_CONTEXT') {
          usePlaybackStore.setState({
            favorites: message.payload.favorites,
            watchedSummary: message.payload.watchedSummary,
            progress: message.payload.progress,
            isHydrated: true,
          });
          set({ clientCompletedDownloads: message.payload.completedDownloads || [] });
        } else if (message.type === 'SESSION_PAIRED') {
          set({ clientCount: message.payload.clientCount });
          // If host, immediately push userContext and nowPlaying to connected client
          if (role === 'host') {
            const pb = usePlaybackStore.getState();
            get().syncHostUserContext({
              favorites: pb.favorites,
              watchedSummary: pb.watchedSummary,
              progress: pb.progress,
              completedDownloads: getCompletedDownloadIds(),
            });
            const np = get().remoteNowPlaying;
            if (np) {
              get().syncHostPlayback(np);
            }
          }
        } else if (message.type === 'HOST_DISCONNECTED') {
          set({
            remoteNowPlaying: null,
            connectionStatus: 'reconnecting',
          });
        }

        // Global host handling: answers sync or updates even if not on /player
        if (role === 'host') {
          if (message.type === 'REQUEST_SYNC') {
            const pb = usePlaybackStore.getState();
            get().syncHostUserContext({
              favorites: pb.favorites,
              watchedSummary: pb.watchedSummary,
              progress: pb.progress,
              completedDownloads: getCompletedDownloadIds(),
            });
            const np = get().remoteNowPlaying;
            if (np) {
              get().syncHostPlayback(np);
            }
          } else if (message.type === 'COMMAND_TOGGLE_FAVORITE') {
            usePlaybackStore.getState().toggleFavorite(message.payload.id);
            const pb = usePlaybackStore.getState();
            get().syncHostUserContext({
              favorites: pb.favorites,
              watchedSummary: pb.watchedSummary,
              progress: pb.progress,
              completedDownloads: getCompletedDownloadIds(),
            });
          } else if (message.type === 'COMMAND_PLAY_MEDIA') {
            const { id, name, url, logo, isVod, seriesContext } = message.payload;
            const downloadTasks = useDownloadStore.getState().tasks;

            const candidateIds = [
              id,
              `movie_${id}`,
              seriesContext ? `${seriesContext.seriesId}_s${seriesContext.season}_e${seriesContext.episodeIndex}` : null,
            ].filter(Boolean) as string[];

            const matchingTask = candidateIds.map((cid) => downloadTasks[cid]).find((t) => t?.status === 'completed');

            useUiStore.getState().setSelectedChannel({
              id,
              name,
              url,
              logo,
              isVod: !!isVod,
              seriesContext: seriesContext
                ? {
                    seriesId: seriesContext.seriesId,
                    seriesName: seriesContext.seriesName,
                    season: seriesContext.season,
                    episodeIndex: seriesContext.episodeIndex,
                    episodes: seriesContext.episodes ?? [],
                  }
                : undefined,
              offlineFileName: matchingTask?.fileName,
              isOffline: !!matchingTask,
            });

            if (hostNavigateCallback) {
              hostNavigateCallback('/player');
            }
          }
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
    clientCompletedDownloads: [],

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
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ role: 'host', sessionId: data.sessionId, pin: data.pinCode })
        );
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: 'client', sessionId, pin }));
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

    syncHostUserContext: (context: RemoteUserContext) => {
      if (get().role === 'host' && activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        const fullContext: RemoteUserContext = {
          ...context,
          completedDownloads: context.completedDownloads || getCompletedDownloadIds(),
        };
        activeSocket.send(JSON.stringify({ type: 'SYNC_USER_CONTEXT', payload: fullContext }));
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

    setHostNavigateCallback: (cb: ((path: string) => void) | null) => {
      hostNavigateCallback = cb;
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
            if (parsed.role === 'host') {
              set({ role: 'host', sessionId: parsed.sessionId, pinCode: parsed.pin || null });
              initSocket(parsed.sessionId, 'host');
            } else {
              get().connectAsClient(parsed.sessionId, parsed.pin);
            }
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

// Auto-sync host user context (favorites, watched, downloads) with debouncing
let userContextDebounceTimer: any = null;
let lastCompletedDownloadsCache: string = '';

function scheduleDebouncedUserContextSync() {
  if (userContextDebounceTimer) {
    clearTimeout(userContextDebounceTimer);
  }
  userContextDebounceTimer = setTimeout(() => {
    const remote = useRemoteStore.getState();
    if (remote.role === 'host' && remote.isPaired && remote.clientCount > 0) {
      const state = usePlaybackStore.getState();
      remote.syncHostUserContext({
        favorites: state.favorites,
        watchedSummary: state.watchedSummary,
        progress: state.progress,
        completedDownloads: getCompletedDownloadIds(),
      });
    }
  }, 2000);
}

// Auto-sync host user context only when favorites or watched status change (avoiding spam on every second of video progress)
usePlaybackStore.subscribe((state, prevState) => {
  const remote = useRemoteStore.getState();
  if (remote.role === 'host' && remote.isPaired && remote.clientCount > 0) {
    if (
      state.favorites !== prevState.favorites ||
      state.watchedSummary !== prevState.watchedSummary
    ) {
      scheduleDebouncedUserContextSync();
    }
  }
});

// Auto-sync host downloads only when completed tasks change (ignoring raw byte progress chunks)
useDownloadStore.subscribe((state) => {
  const remote = useRemoteStore.getState();
  if (remote.role === 'host' && remote.isPaired && remote.clientCount > 0) {
    const completed = Object.values(state.tasks)
      .filter((t) => t.status === 'completed')
      .map((t) => t.id)
      .sort()
      .join(',');
    if (completed !== lastCompletedDownloadsCache) {
      lastCompletedDownloadsCache = completed;
      scheduleDebouncedUserContextSync();
    }
  }
});


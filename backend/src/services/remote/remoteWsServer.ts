import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { IRemoteSessionHub } from './IRemoteSessionHub';
import { RemoteMessage } from '@homeiptv/shared-types';

interface ExtWebSocket extends WebSocket {
  isAlive?: boolean;
}

export function setupRemoteWebSocketServer(
  httpServer: http.Server,
  hub: IRemoteSessionHub
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (request, socket, head) => {
    try {
      const parsedUrl = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (parsedUrl.pathname !== '/ws/remote') {
        return; // Let other upgrade listeners handle it if any
      }

      const role = (parsedUrl.searchParams.get('role') || 'client') as 'host' | 'client';
      let sessionId = parsedUrl.searchParams.get('sessionId');
      const pin = parsedUrl.searchParams.get('pin');

      if (!sessionId && pin) {
        const found = await hub.getSessionByPin(pin);
        if (found) {
          sessionId = found.sessionId;
        }
      }

      if (!sessionId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const session = await hub.getSession(sessionId);
      if (!session) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, { sessionId, role, session });
      });
    } catch (err) {
      console.error('[remoteWsServer] Upgrade error:', err);
      socket.destroy();
    }
  });

  const MAX_BUFFERED_AMOUNT = 64 * 1024; // 64 KB
  const CRITICAL_STALL_BUFFER = 512 * 1024; // 512 KB

  wss.on('connection', async (rawWs: WebSocket, _request: http.IncomingMessage, context: { sessionId: string; role: 'host' | 'client' }) => {
    const ws = rawWs as ExtWebSocket;
    const socketId = crypto.randomUUID();
    const { sessionId, role } = context;

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const safeSend = (msg: RemoteMessage) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      // Backpressure protection:
      // If the client socket buffer is backed up (e.g. mobile device on slow Wi-Fi or screen sleep),
      // drop high-frequency ephemeral updates (SYNC_STATE, SYNC_USER_CONTEXT) to prevent V8 heap explosion.
      if (ws.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        if (msg.type === 'SYNC_STATE' || msg.type === 'SYNC_USER_CONTEXT') {
          return;
        }
        if (ws.bufferedAmount > CRITICAL_STALL_BUFFER) {
          console.warn(`[remoteWsServer] Client ${socketId} socket completely stalled (${ws.bufferedAmount} bytes). Terminating.`);
          ws.terminate();
          return;
        }
      }

      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        console.warn(`[remoteWsServer] Send error to ${socketId}:`, err);
      }
    };

    const unsubscribe = hub.subscribeToSession(sessionId, socketId, (msg: RemoteMessage) => {
      safeSend(msg);
    });

    // If client connects, send initial state and user context if available
    const session = await hub.getSession(sessionId);
    if (ws.readyState === WebSocket.OPEN) {
      if (session?.nowPlaying) {
        safeSend({ type: 'SYNC_STATE', payload: session.nowPlaying });
      }
      if (session?.userContext) {
        safeSend({ type: 'SYNC_USER_CONTEXT', payload: session.userContext });
      }
    }

    // Broadcast client count to session
    const clientCount = hub.getClientCount(sessionId);
    await hub.publishToSession(sessionId, {
      type: 'SESSION_PAIRED',
      payload: { clientCount },
    });

    ws.on('message', async (data: Buffer | string) => {
      try {
        const text = data.toString();
        const message = JSON.parse(text) as RemoteMessage;

        if (message.type === 'PING') {
          if (ws.readyState === WebSocket.OPEN) {
            safeSend({ type: 'PONG' });
          }
          return;
        }

        if (message.type === 'REQUEST_SYNC') {
          const current = await hub.getSession(sessionId);
          if (ws.readyState === WebSocket.OPEN) {
            if (current?.nowPlaying) {
              safeSend({ type: 'SYNC_STATE', payload: current.nowPlaying });
            }
            if (current?.userContext) {
              safeSend({ type: 'SYNC_USER_CONTEXT', payload: current.userContext });
            }
          }
          return;
        }

        if (message.type === 'SYNC_STATE') {
          await hub.updateNowPlaying(sessionId, message.payload);
        } else if (message.type === 'SYNC_USER_CONTEXT') {
          await hub.updateUserContext(sessionId, message.payload);
        }

        // Publish to other members in the session room
        await hub.publishToSession(sessionId, message, socketId);
      } catch (err) {
        console.error('[remoteWsServer] Message error:', err);
      }
    });

    ws.on('close', async () => {
      unsubscribe();
      await hub.removeSocket(socketId);

      const remainingClients = hub.getClientCount(sessionId);
      if (role === 'host') {
        await hub.publishToSession(sessionId, { type: 'HOST_DISCONNECTED' });
      } else {
        await hub.publishToSession(sessionId, {
          type: 'SESSION_PAIRED',
          payload: { clientCount: remainingClients },
        });
      }
    });

    ws.on('error', (err) => {
      console.warn(`[remoteWsServer] Socket error on ${socketId}:`, err.message);
    });
  });

  // Heartbeat check every 20 seconds: terminate unresponsive zombie sockets
  const pingInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const extWs = client as ExtWebSocket;
      if (extWs.isAlive === false) {
        console.log('[remoteWsServer] Terminating unresponsive zombie socket');
        return extWs.terminate();
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, 20000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}

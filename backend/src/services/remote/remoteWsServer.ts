import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { IRemoteSessionHub } from './IRemoteSessionHub';
import { RemoteMessage } from '@homeiptv/shared-types';

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

  wss.on('connection', async (ws: WebSocket, _request: http.IncomingMessage, context: { sessionId: string; role: 'host' | 'client' }) => {
    const socketId = crypto.randomUUID();
    const { sessionId, role } = context;

    let isAlive = true;
    ws.on('pong', () => {
      isAlive = true;
    });

    const unsubscribe = hub.subscribeToSession(sessionId, socketId, (msg: RemoteMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });

    // If client connects, send initial state and user context if available
    const session = await hub.getSession(sessionId);
    if (ws.readyState === WebSocket.OPEN) {
      if (session?.nowPlaying) {
        ws.send(JSON.stringify({ type: 'SYNC_STATE', payload: session.nowPlaying }));
      }
      if (session?.userContext) {
        ws.send(JSON.stringify({ type: 'SYNC_USER_CONTEXT', payload: session.userContext }));
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
            ws.send(JSON.stringify({ type: 'PONG' }));
          }
          return;
        }

        if (message.type === 'REQUEST_SYNC') {
          const current = await hub.getSession(sessionId);
          if (ws.readyState === WebSocket.OPEN) {
            if (current?.nowPlaying) {
              ws.send(JSON.stringify({ type: 'SYNC_STATE', payload: current.nowPlaying }));
            }
            if (current?.userContext) {
              ws.send(JSON.stringify({ type: 'SYNC_USER_CONTEXT', payload: current.userContext }));
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

  // Heartbeat check every 20 seconds
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, 20000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}

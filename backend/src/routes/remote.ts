import { Router } from 'express';
import { IRemoteSessionHub } from '../services/remote/IRemoteSessionHub';

export function createRemoteRouter(hub: IRemoteSessionHub): Router {
  const router = Router();

  // Create a new remote session for a host device (e.g. PC)
  router.post('/sessions', async (req, res) => {
    try {
      const hostDeviceId = (req.body?.hostDeviceId as string) || `host-${Date.now()}`;
      const session = await hub.createSession(hostDeviceId);
      res.json({
        sessionId: session.sessionId,
        pinCode: session.pinCode,
        hostDeviceId: session.hostDeviceId,
        createdAt: session.createdAt,
      });
    } catch (err) {
      console.error('[remoteRouter] Failed to create session:', err);
      res.status(500).json({ error: 'Failed to create remote session' });
    }
  });

  // Lookup session by 6-digit pin code
  router.get('/sessions/by-pin/:pin', async (req, res) => {
    try {
      const { pin } = req.params;
      const session = await hub.getSessionByPin(pin);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      res.json({
        sessionId: session.sessionId,
        pinCode: session.pinCode,
        hostDeviceId: session.hostDeviceId,
        nowPlaying: session.nowPlaying,
      });
    } catch (err) {
      console.error('[remoteRouter] Failed to lookup session by pin:', err);
      res.status(500).json({ error: 'Failed to lookup session' });
    }
  });

  // Get session details
  router.get('/sessions/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await hub.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      res.json(session);
    } catch (err) {
      console.error('[remoteRouter] Failed to get session:', err);
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  return router;
}

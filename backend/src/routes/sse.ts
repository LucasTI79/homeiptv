import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { sseClients } from '../state/sseState';

// Ports GET /api/events (SSE) from server.js:4841-4874.
export const sseRouter = Router();

sseRouter.get('/events', requireAuth, (req, res) => {
  const userId = req.session.userId as number;
  const clientId = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(userId)) {
    sseClients.set(userId, []);
  }
  const clients = sseClients.get(userId)!;
  clients.push({ id: clientId, res, isAdmin: Boolean(req.session.isAdmin) });
  console.log(`[SSE] Client ${clientId} connected for user ID ${userId}. Total clients for user: ${clients.length}.`);

  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connection established' })}\n\n`);

  req.on('close', () => {
    const userClients = sseClients.get(userId);
    if (userClients) {
      const index = userClients.findIndex((c) => c.id === clientId);
      if (index !== -1) {
        userClients.splice(index, 1);
        console.log(`[SSE] Client ${clientId} disconnected for user ID ${userId}. Remaining clients for user: ${userClients.length}.`);
        if (userClients.length === 0) {
          sseClients.delete(userId);
        }
      }
    }
  });
});

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';
import { requireAdmin } from '../middleware/auth';
import { activeStreamProcesses } from '../state/streamState';
import { sendSseEvent } from '../state/sseState';

const SALT_ROUNDS = 10;

// Ports the admin user-management CRUD from server.js:1856-2000.
export const usersRouter = Router();

usersRouter.get('/users', requireAdmin, async (_req, res) => {
  try {
    const rows = await db('users')
      .select('id', 'username', 'isAdmin', 'canUseDvr', 'allowed_sources')
      .orderBy('username');
    res.json(rows);
  } catch (err) {
    console.error('[USER_API] Error fetching users:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

usersRouter.post('/users', requireAdmin, async (req, res) => {
  const { username, password, isAdmin, canUseDvr, allowed_sources } = req.body as {
    username?: string;
    password?: string;
    isAdmin?: boolean;
    canUseDvr?: boolean;
    allowed_sources?: unknown;
  };
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const allowedSourcesStr = allowed_sources ? JSON.stringify(allowed_sources) : null;
    const id = await insertAndGetId('users', {
      username,
      password: hash,
      isAdmin: isAdmin ? 1 : 0,
      canUseDvr: canUseDvr ? 1 : 0,
      allowed_sources: allowedSourcesStr,
    });
    res.json({ success: true, id });
  } catch (err) {
    console.error('[USER_API] Error inserting new user:', (err as Error).message);
    res.status(400).json({ error: 'Username already exists.' });
  }
});

usersRouter.put('/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, password, isAdmin, canUseDvr, allowed_sources } = req.body as {
    username?: string;
    password?: string;
    isAdmin?: boolean;
    canUseDvr?: boolean;
    allowed_sources?: unknown;
  };
  const allowedSourcesStr = allowed_sources ? JSON.stringify(allowed_sources) : null;

  try {
    if (String(req.session.userId) === String(id) && !isAdmin) {
      const row = await db('users').where({ isAdmin: 1 }).count<{ count: string }>({ count: '*' }).first();
      if (Number(row?.count ?? 0) <= 1) {
        return res.status(403).json({ error: 'Cannot remove the last administrator.' });
      }
    }

    const update: Record<string, unknown> = {
      username,
      isAdmin: isAdmin ? 1 : 0,
      canUseDvr: canUseDvr ? 1 : 0,
      allowed_sources: allowedSourcesStr,
    };
    if (password) {
      update.password = await bcrypt.hash(password, SALT_ROUNDS);
    }

    await db('users').where({ id }).update(update);

    if (String(req.session.userId) === String(id)) {
      req.session.username = username;
      req.session.isAdmin = Boolean(isAdmin);
      req.session.canUseDvr = Boolean(canUseDvr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(`[USER_API] Error updating user ${id}:`, (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

usersRouter.delete('/users/:id', requireAdmin, async (req, res) => {
  const idToDelete = Number(req.params.id);
  if (Number(req.session.userId) === idToDelete) {
    return res.status(403).json({ error: 'You cannot delete your own account.' });
  }

  // Ports server.js:1969-1986: kill any live streams the deleted user still
  // has running, then tell their connected client(s) to log out immediately.
  let streamsKilled = 0;
  for (const [streamKey, streamInfo] of activeStreamProcesses.entries()) {
    if (streamInfo.userId === idToDelete) {
      try {
        streamInfo.process.kill('SIGKILL');
        activeStreamProcesses.delete(streamKey);
        streamsKilled++;
      } catch (e) {
        console.warn(`[USER_DELETION] Error killing stream process for user ${idToDelete}: ${(e as Error).message}`);
      }
    }
  }
  if (streamsKilled > 0) {
    console.log(`[USER_DELETION] Terminated ${streamsKilled} active stream(s) for deleted user ${idToDelete}.`);
  }

  sendSseEvent(idToDelete, 'force-logout', { reason: 'Your account has been deleted by an administrator.' });

  try {
    const deleted = await db('users').where({ id: idToDelete }).del();
    if (deleted === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`[USER_API] Error deleting user ${idToDelete}:`, (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

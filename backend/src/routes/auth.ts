import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';

import { env } from '../config/env';

const SALT_ROUNDS = 10;

// Ports /api/auth/* from server.js:1638-1854.
export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'development', // Disable limit during local Vite development
});

authRouter.get('/auth/needs-setup', async (_req, res) => {
  try {
    const row = await db('users').where({ isAdmin: 1 }).count<{ count: string }>({ count: '*' }).first();
    const count = Number(row?.count ?? 0);
    res.json({ needsSetup: count === 0 });
  } catch (err) {
    console.error('[AUTH_API] Error checking admin user count:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

authRouter.post('/auth/setup-admin', loginLimiter, async (req, res) => {
  try {
    const totalRow = await db('users').count<{ count: string }>({ count: '*' }).first();
    const total = Number(totalRow?.count ?? 0);
    if (total > 0) {
      return res.status(403).json({ error: 'Setup has already been completed.' });
    }

    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = await insertAndGetId('users', { username, password: hash, isAdmin: 1, canUseDvr: 1 });

    req.session.userId = id;
    req.session.username = username;
    req.session.isAdmin = true;
    req.session.canUseDvr = true;

    res.json({ success: true, user: { id, username, isAdmin: true, canUseDvr: true } });
  } catch (err) {
    console.error('[AUTH_API] Error during admin setup:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

authRouter.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    const user = await db('users').where({ username }).first();
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const ok = await bcrypt.compare(password ?? '', user.password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.isAdmin === 1;
    req.session.canUseDvr = user.canUseDvr === 1;

    res.json({
      success: true,
      user: { id: user.id, username: user.username, isAdmin: user.isAdmin === 1, canUseDvr: user.canUseDvr === 1 },
    });
  } catch (err) {
    console.error('[AUTH_API] Error during login:', err);
    res.status(500).json({ error: 'Authentication error.' });
  }
});

authRouter.post('/auth/logout', (req, res) => {
  const username = req.session.username || 'unknown';
  req.session.destroy((err) => {
    if (err) {
      console.error(`[AUTH_API] Error destroying session for user ${username}:`, err);
      return res.status(500).json({ error: 'Could not log out.' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

authRouter.get('/auth/status', (req, res) => {
  if (req.session?.userId) {
    res.json({
      isLoggedIn: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        isAdmin: req.session.isAdmin,
        canUseDvr: req.session.canUseDvr,
      },
    });
  } else {
    res.json({ isLoggedIn: false });
  }
});

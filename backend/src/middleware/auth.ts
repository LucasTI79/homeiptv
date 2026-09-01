import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';

// Ports requireAuth/requireAdmin/requireDvrAccess from server.js (server.js:425-453)
// verbatim in behavior: requireAuth re-checks the user still exists in the DB
// on every request (not just that the session cookie is valid), so a deleted
// user's existing session gets kicked out immediately.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const user = await db('users').select('id').where({ id: req.session.userId }).first();
    if (!user) {
      console.warn(`[AUTH_MIDDLEWARE] User ID ${req.session.userId} from session not found in DB. Destroying session.`);
      req.session.destroy(() => {});
      res.clearCookie('connect.sid');
      return res.status(401).json({ error: 'User account no longer exists. Please log in again.' });
    }
    next();
  } catch (err) {
    console.error('[AUTH_MIDDLEWARE] DB error checking user existence:', err);
    return res.status(500).json({ error: 'Server error during authentication.' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isAdmin) return next();
  return res.status(403).json({ error: 'Administrator privileges required.' });
}

export function requireDvrAccess(req: Request, res: Response, next: NextFunction) {
  if (req.session && (req.session.canUseDvr || req.session.isAdmin)) return next();
  return res.status(403).json({ error: 'DVR access required.' });
}

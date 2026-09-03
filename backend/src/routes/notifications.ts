import { Router } from 'express';
import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';
import { requireAuth } from '../middleware/auth';
import { vapidKeys } from '../services/vapid';

// Ports /api/notifications/* from server.js:3089-3263.
export const notificationsRouter = Router();

notificationsRouter.get('/notifications/vapid-public-key', requireAuth, (_req, res) => {
  if (!vapidKeys.publicKey) {
    return res.status(500).json({ error: 'VAPID public key not available on the server.' });
  }
  res.json({ publicKey: vapidKeys.publicKey });
});

notificationsRouter.post('/notifications/subscribe', requireAuth, async (req, res) => {
  const subscription = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const userId = req.session.userId as number;

  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object.' });
  }
  const { endpoint, keys: { p256dh, auth } } = subscription;

  try {
    await db('push_subscriptions')
      .insert({ user_id: userId, endpoint, p256dh, auth })
      .onConflict('endpoint')
      .merge({ user_id: userId, p256dh, auth });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error(`[PUSH_API] Error saving push subscription for user ${userId}:`, err);
    res.status(500).json({ error: 'Could not save subscription.' });
  }
});

notificationsRouter.post('/notifications/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required to unsubscribe.' });
  }

  try {
    const changes = await db('push_subscriptions').where({ endpoint, user_id: req.session.userId }).del();
    if (changes === 0) {
      return res.status(404).json({ error: 'Subscription not found or unauthorized.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`[PUSH_API] Error deleting push subscription for user ${req.session.userId}, endpoint ${endpoint}:`, err);
    res.status(500).json({ error: 'Could not unsubscribe.' });
  }
});

notificationsRouter.post('/notifications', requireAuth, async (req, res) => {
  const { channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId } = req.body as {
    channelId?: string; channelName?: string; channelLogo?: string; programTitle?: string; programDesc?: string;
    programStart?: string; programStop?: string; scheduledTime?: string; programId?: string;
  };
  const userId = req.session.userId as number;

  if (!channelId || !programTitle || !programStart || !scheduledTime || !programId || !channelName) {
    return res.status(400).json({ error: 'Invalid notification data. All required fields must be provided.' });
  }

  try {
    const notificationId = await insertAndGetId('notifications', {
      user_id: userId, channelId, channelName, channelLogo: channelLogo || '', programTitle, programDesc: programDesc || '',
      programStart, programStop, notificationTime: scheduledTime, programId, status: 'pending',
    });

    const subs = await db('push_subscriptions').select('id').where({ user_id: userId });
    const now = new Date().toISOString();
    if (subs.length > 0) {
      await db('notification_deliveries').insert(subs.map((sub) => ({ notification_id: notificationId, subscription_id: sub.id, status: 'pending', updatedAt: now })));
      console.log(`[PUSH_API] Created ${subs.length} delivery records for notification ${notificationId}.`);
    }

    res.status(201).json({ success: true, id: notificationId });
  } catch (err) {
    console.error(`[PUSH_API_ERROR] Database error adding notification for user ${userId}:`, err);
    res.status(500).json({ error: 'Could not add notification to the database.' });
  }
});

notificationsRouter.get('/notifications', requireAuth, async (req, res) => {
  try {
    const rows = await db('notifications as n')
      .where('n.user_id', req.session.userId)
      .select(
        'n.id', 'n.user_id', 'n.channelId', 'n.channelName', 'n.channelLogo', 'n.programTitle', 'n.programDesc',
        'n.programStart', 'n.programStop', db.raw('n.notificationTime as scheduledTime'), 'n.programId',
        db.raw(`CASE
          WHEN (SELECT COUNT(*) FROM notification_deliveries WHERE notification_id = n.id AND status = 'sent') > 0 THEN 'sent'
          WHEN (SELECT COUNT(*) FROM notification_deliveries WHERE notification_id = n.id AND status = 'expired') > 0 THEN 'expired'
          ELSE n.status
        END as status`),
        db.raw('(SELECT MAX(updatedAt) FROM notification_deliveries WHERE notification_id = n.id AND status = \'sent\') as triggeredAt'),
      )
      .orderBy('n.notificationTime', 'desc');
    res.json(rows);
  } catch (err) {
    console.error('[PUSH_API] Error fetching consolidated notifications from database:', err);
    res.status(500).json({ error: 'Could not retrieve notifications.' });
  }
});

// Registered before /:id so "past" isn't parsed as an id.
notificationsRouter.delete('/notifications/past', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const now = new Date().toISOString();
  try {
    const deletedCount = await db('notifications').where('user_id', userId).andWhere('notificationTime', '<=', now).del();
    res.json({ success: true, deletedCount });
  } catch (err) {
    console.error(`[PUSH_API] Error deleting past notifications for user ${userId}:`, (err as Error).message);
    res.status(500).json({ error: 'Could not clear past notifications.' });
  }
});

notificationsRouter.delete('/notifications/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const changes = await db('notifications').where({ id, user_id: req.session.userId }).del();
    if (changes === 0) {
      return res.status(404).json({ error: 'Notification not found or unauthorized.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`[PUSH_API] Error deleting notification ${id} from database:`, err);
    res.status(500).json({ error: 'Could not delete notification.' });
  }
});

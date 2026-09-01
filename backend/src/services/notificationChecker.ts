import webpush from 'web-push';
import { db } from '../db/connection';
import { sendSseEvent } from '../state/sseState';

// Ports checkAndSendNotifications from server.js:4174-4272.
export async function checkAndSendNotifications(): Promise<void> {
  console.log('[PUSH_CHECKER] Running scheduled notification check for all devices.');
  const now = new Date();
  const nowIso = now.toISOString();
  const timeoutCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const expiredCount = await db('notification_deliveries')
      .where('status', 'pending')
      .whereIn('notification_id', db('notifications').select('id').where('notificationTime', '<', timeoutCutoff))
      .update({ status: 'expired', updatedAt: nowIso });
    if (expiredCount > 0) {
      console.log(`[PUSH_CHECKER_CLEANUP] Expired ${expiredCount} old notification deliveries.`);
    }

    const dueDeliveries = await db('notification_deliveries as d')
      .join('notifications as n', 'd.notification_id', 'n.id')
      .join('push_subscriptions as s', 'd.subscription_id', 's.id')
      .where('d.status', 'pending')
      .andWhere('n.notificationTime', '<=', nowIso)
      .select('d.id as delivery_id', 'd.status', 'n.*', 's.id as subscription_id', 's.endpoint', 's.p256dh', 's.auth');

    if (dueDeliveries.length === 0) return;
    console.log(`[PUSH_CHECKER] Found ${dueDeliveries.length} due notification deliveries to process.`);

    for (const delivery of dueDeliveries) {
      console.log(`[PUSH_CHECKER] Processing delivery ID ${delivery.delivery_id} for program "${delivery.programTitle}" to subscription ${delivery.subscription_id}.`);

      const payload = JSON.stringify({
        type: 'program_reminder',
        data: {
          programTitle: delivery.programTitle,
          programStart: delivery.programStart,
          channelName: delivery.channelName,
          channelLogo: delivery.channelLogo || 'https://i.imgur.com/rwa8SjI.png',
          url: `/tvguide?channelId=${delivery.channelId}&programId=${delivery.programId}&programStart=${delivery.programStart}`,
        },
      });

      const pushSubscription = { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } };

      webpush.sendNotification(pushSubscription, payload, { TTL: 86400 })
        .then(async () => {
          console.log(`[PUSH_CHECKER] Successfully sent notification for delivery ID ${delivery.delivery_id}.`);
          await db('notification_deliveries').where({ id: delivery.delivery_id }).update({ status: 'sent', updatedAt: nowIso });
        })
        .catch(async (error: { statusCode?: number; body?: string; message?: string }) => {
          console.error(`[PUSH_CHECKER] Error sending notification for delivery ID ${delivery.delivery_id}:`, error.statusCode, error.body || error.message);

          if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`[PUSH_CHECKER] Subscription ${delivery.subscription_id} is invalid (${error.statusCode}). Deleting subscription and failing deliveries.`);
            sendSseEvent(delivery.user_id, 'subscription-invalidated', { endpoint: delivery.endpoint, reason: `Push service returned status ${error.statusCode}.` });
            await db('push_subscriptions').where({ id: delivery.subscription_id }).del();
            await db('notification_deliveries').where({ subscription_id: delivery.subscription_id, status: 'pending' }).update({ status: 'failed', updatedAt: nowIso });
          } else {
            await db('notification_deliveries').where({ id: delivery.delivery_id }).update({ status: 'failed', updatedAt: nowIso });
          }
        });
    }
  } catch (error) {
    console.error('[PUSH_CHECKER] Unhandled error in checkAndSendNotifications:', error);
  }
}

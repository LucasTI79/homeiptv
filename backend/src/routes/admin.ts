import si from 'systeminformation';
import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { activeStreamProcesses, activeRedirectStreams, broadcastAdminUpdate } from '../state/streamState';
import { sendSseEvent, broadcastSseToAll } from '../state/sseState';
import { DATA_DIR } from '../config/paths';
import { env } from '../config/env';

// Ports /api/admin/* from server.js:3874-4114.
export const adminRouter = Router();

adminRouter.get('/admin/activity', requireAuth, requireAdmin, async (req, res) => {
  const transcodedLive = Array.from(activeStreamProcesses.values()).map((info) => ({
    streamKey: info.streamKey, userId: info.userId, username: info.username, channelName: info.channelName,
    channelLogo: info.channelLogo, streamProfileName: info.streamProfileName, startTime: info.startTime,
    clientIp: info.clientIp, isTranscoded: true,
  }));
  const redirectLive = Array.from(activeRedirectStreams.values()).map((info) => ({
    streamKey: `${info.userId}::${info.historyId}`, userId: info.userId, username: info.username, channelName: info.channelName,
    channelLogo: info.channelLogo, streamProfileName: info.streamProfileName, startTime: info.startTime,
    clientIp: info.clientIp, isTranscoded: false,
  }));
  const liveActivity = [...transcodedLive, ...redirectLive];

  try {
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = parseInt(String(req.query.pageSize ?? '25'), 10) || 25;
    const search = (req.query.search as string) || '';
    const dateFilter = (req.query.dateFilter as string) || 'all';
    const customStart = req.query.startDate as string | undefined;
    const customEnd = req.query.endDate as string | undefined;
    const offset = (page - 1) * pageSize;

    let query = db('stream_history');
    let countQuery = db('stream_history');

    const applyFilters = (q: typeof query) => {
      if (search) {
        q = q.where((builder) => {
          builder.whereLike('username', `%${search}%`)
            .orWhereLike('channel_name', `%${search}%`)
            .orWhereLike('client_ip', `%${search}%`)
            .orWhereLike('stream_profile_name', `%${search}%`);
        });
      }
      const now = new Date();
      if (dateFilter === '24h') {
        q = q.where('start_time', '>=', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
      } else if (dateFilter === '7d') {
        q = q.where('start_time', '>=', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
      } else if (dateFilter === 'custom' && customStart && customEnd) {
        q = q.whereBetween('start_time', [new Date(customStart).toISOString(), new Date(customEnd).toISOString()]);
      }
      return q;
    };

    query = applyFilters(query);
    countQuery = applyFilters(countQuery);

    const countRow = await countQuery.count<{ count: string }>({ count: '*' }).first();
    const totalItems = Number(countRow?.count ?? 0);
    const historyItems = await query.orderBy('start_time', 'desc').limit(pageSize).offset(offset);

    res.json({
      live: liveActivity,
      history: { items: historyItems, totalItems, totalPages: Math.ceil(totalItems / pageSize), currentPage: page, pageSize },
    });
  } catch (err) {
    console.error('[ADMIN_API] Error fetching paginated stream history:', (err as Error).message);
    res.status(500).json({ error: 'Could not retrieve stream history.' });
  }
});

adminRouter.post('/admin/stop-stream', requireAuth, requireAdmin, async (req, res) => {
  const { streamKey } = req.body as { streamKey?: string };
  if (!streamKey) {
    return res.status(400).json({ error: 'A streamKey is required to stop the stream.' });
  }

  const streamInfo = activeStreamProcesses.get(streamKey);
  if (!streamInfo) {
    return res.status(404).json({ error: 'Active stream not found.' });
  }

  console.log(`[ADMIN_API] Admin ${req.session.username} is terminating stream ${streamKey} for user ${streamInfo.username}.`);
  try {
    if (streamInfo.historyId) {
      const endTime = new Date().toISOString();
      const duration = Math.round((new Date(endTime).getTime() - new Date(streamInfo.startTime).getTime()) / 1000);
      await db('stream_history').where({ id: streamInfo.historyId, status: 'playing' }).update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
    }
    streamInfo.process.kill('SIGKILL');
    activeStreamProcesses.delete(streamKey);
    broadcastAdminUpdate();
    res.json({ success: true, message: `Stream terminated for user ${streamInfo.username}.` });
  } catch (e) {
    console.error(`[ADMIN_API] Error terminating stream ${streamKey}: ${(e as Error).message}`);
    res.status(500).json({ error: 'Failed to terminate stream process.' });
  }
});

adminRouter.delete('/admin/history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const olderThanDays = req.query.olderThanDays ? parseInt(String(req.query.olderThanDays), 10) : null;
    let query = db('stream_history');
    if (olderThanDays && olderThanDays > 0) {
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      query = query.where('start_time', '<', cutoff);
    }
    const deletedCount = await query.del();
    console.log(`[ADMIN_API] Admin ${req.session.username} cleared ${deletedCount} stream history records.`);
    res.json({ success: true, message: `Successfully deleted ${deletedCount} stream history records.` });
  } catch (err) {
    console.error('[ADMIN_API] Error clearing stream history:', err);
    res.status(500).json({ error: 'Failed to clear stream history.' });
  }
});

adminRouter.delete('/admin/history/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid history ID.' });
    await db('stream_history').where({ id }).del();
    res.json({ success: true, message: `History item ${id} deleted.` });
  } catch (err) {
    console.error('[ADMIN_API] Error deleting history item:', err);
    res.status(500).json({ error: 'Failed to delete history item.' });
  }
});

adminRouter.post('/admin/change-stream', requireAuth, requireAdmin, (req, res) => {
  const { userId: userIdRaw, streamKey, channel } = req.body as { userId?: string | number; streamKey?: string; channel?: unknown };
  const userId = Number(userIdRaw);

  if (!userId || !streamKey || !channel) {
    return res.status(400).json({ error: 'User ID, stream key, and channel data are required.' });
  }

  const streamInfo = activeStreamProcesses.get(streamKey);
  if (!streamInfo || streamInfo.userId !== userId) {
    return res.status(404).json({ error: 'The specified stream is not active for this user.' });
  }

  console.log(`[ADMIN_API] Admin ${req.session.username} is changing channel for user ${streamInfo.username}.`);
  sendSseEvent(userId, 'change-channel', { channel });
  res.json({ success: true, message: `Change channel command sent to user ${streamInfo.username}.` });
});

adminRouter.get('/admin/system-health', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [cpu, mem, fsSize] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);

    const dataDisk = fsSize.find((d) => d.mount === DATA_DIR);
    const dvrDisk = fsSize.find((d) => d.mount === env.dvrDir);

    res.json({
      cpu: { load: cpu.currentLoad.toFixed(2) },
      memory: { total: mem.total, used: mem.active, percent: ((mem.active / mem.total) * 100).toFixed(2) },
      disks: {
        data: { total: dataDisk?.size || 0, used: dataDisk?.used || 0, percent: dataDisk?.use || 0 },
        dvr: { total: dvrDisk?.size || 0, used: dvrDisk?.used || 0, percent: dvrDisk?.use || 0 },
      },
    });
  } catch (e) {
    console.error('[ADMIN_API] Error fetching system health:', e);
    res.status(500).json({ error: 'Could not retrieve system health information.' });
  }
});

adminRouter.get('/admin/analytics', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const topChannels = await db('stream_history')
      .select('channel_name')
      .sum({ total_duration: 'duration_seconds' })
      .whereNotNull('channel_name')
      .whereNotNull('duration_seconds')
      .groupBy('channel_name')
      .orderBy('total_duration', 'desc')
      .limit(5);

    const topUsers = await db('stream_history')
      .select('username')
      .sum({ total_duration: 'duration_seconds' })
      .whereNotNull('duration_seconds')
      .groupBy('username')
      .orderBy('total_duration', 'desc')
      .limit(5);

    res.json({ topChannels, topUsers });
  } catch (e) {
    console.error('[ADMIN_API] Error fetching analytics data:', e);
    res.status(500).json({ error: 'Could not retrieve analytics data.' });
  }
});

adminRouter.post('/admin/broadcast', requireAuth, requireAdmin, (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  broadcastSseToAll('broadcast-message', { message: message.trim(), sender: req.session.username });
  res.json({ success: true, message: 'Broadcast sent successfully.' });
});

import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { Router } from 'express';
import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';
import { requireAuth } from '../middleware/auth';
import { allowLocalOrAuth } from '../middleware/allowLocalOrAuth';
import { getSettings } from '../services/settings';
import { parseM3U } from '../services/sources';
import { LIVE_CHANNELS_M3U_PATH } from '../config/paths';
import {
  activeStreamProcesses,
  activeRedirectStreams,
  activeCastTokens,
  broadcastAdminUpdate,
  updateActiveStream,
  type ActiveStreamInfo,
} from '../state/streamState';

// Ports /stream (GET+HEAD), /api/cast/generate-token, /api/stream/stop,
// /api/activity/start-redirect, /api/activity/stop-redirect from
// server.js:3446-3854.
export const streamRouter = Router();
const streamAuth = allowLocalOrAuth(activeCastTokens);

async function updateStreamHistoryEnd(historyId: number, startTime: string): Promise<void> {
  const endTime = new Date().toISOString();
  const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
  await db('stream_history').where({ id: historyId, status: 'playing' }).update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
}

streamRouter.route('/stream')
  .get(streamAuth, async (req, res) => {
  const streamUrl = req.query.url as string | undefined;
  const profileId = req.query.profileId as string | undefined;
  const userAgentId = req.query.userAgentId as string | undefined;
  const vodName = req.query.vodName as string | undefined;
  const vodLogo = req.query.vodLogo as string | undefined;
  const seekStartTime = req.query.startTime as string | undefined;

  const userId = req.session.userId as number;
  const username = req.session.username as string;
  const clientIp = req.ip as string;

  const seekSeconds = seekStartTime ? parseFloat(seekStartTime) : 0;
  const streamKey = `${userId}::${streamUrl}::${profileId}${seekSeconds > 0 ? `::t${seekSeconds}` : ''}`;

  const activeStreamInfo = activeStreamProcesses.get(streamKey);
  if (activeStreamInfo) {
    const updated = updateActiveStream(streamKey, (prev) => ({
      ...prev,
      references: prev.references + 1,
      lastAccess: Date.now(),
    }));
    console.log(`[STREAM] Existing stream requested. Key: ${streamKey}. New ref count: ${updated?.references ?? 1}.`);
    activeStreamInfo.process.stdout.pipe(res);

    const detachClient = () => {
      updateActiveStream(streamKey, (prev) => ({
        ...prev,
        references: Math.max(0, prev.references - 1),
        lastAccess: Date.now(),
      }));
      try {
        activeStreamInfo.process.stdout.unpipe(res);
      } catch {}
    };
    req.on('close', detachClient);
    res.on('close', detachClient);
    return;
  }

  console.log(`[STREAM] New request: URL=${streamUrl}, ProfileID=${profileId}, UserAgentID=${userAgentId}`);
  if (!streamUrl) return res.status(400).send('Error: `url` query parameter is required.');

  const settings = getSettings();
  let profile = settings.streamProfiles.find((p) => p.id === profileId);
  if (!profile) profile = settings.castProfiles.find((p) => p.id === profileId);
  if (!profile) {
    return res.status(404).send(`Error: Stream profile with ID "${profileId}" not found.`);
  }

  const isTranscoded = profile.command !== 'redirect';
  if (!isTranscoded) {
    console.log(`[STREAM] Redirecting to stream URL: ${streamUrl}`);
    return res.redirect(302, streamUrl);
  }

  const userAgent = settings.userAgents.find((ua) => ua.id === userAgentId);
  if (!userAgent) {
    return res.status(404).send(`Error: User agent with ID "${userAgentId}" not found.`);
  }

  let channelName: string, channelId: string | null, channelLogo: string | null;
  if (vodName) {
    channelName = vodName;
    channelLogo = vodLogo || null;
    channelId = null;
  } else {
    const allChannels = parseM3U(fs.existsSync(LIVE_CHANNELS_M3U_PATH) ? fs.readFileSync(LIVE_CHANNELS_M3U_PATH, 'utf-8') : '');
    const channel = allChannels.find((c) => c.url === streamUrl);
    channelName = channel ? channel.displayName || channel.name : 'Direct Stream';
    channelId = channel ? channel.id : null;
    channelLogo = channel ? channel.logo || null : null;
  }
  const streamProfileName = profile.name;

  let commandTemplate = `-v level+${settings.playerLogLevel} ` + profile.command
    .replace(/{streamUrl}/g, streamUrl)
    .replace(/{userAgent}|{clientUserAgent}/g, userAgent.value);

  if (seekSeconds > 0) {
    commandTemplate = commandTemplate.replace(' -i ', ` -ss ${seekSeconds} -i `);
  }

  const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((arg) => arg.replace(/^"|"$/g, ''));
  console.log(`[STREAM] FFmpeg command args: ffmpeg ${args.join(' ')}`);
  const ffmpeg = spawn('ffmpeg', args);

  const startTime = new Date().toISOString();
  try {
    const historyId = await insertAndGetId('stream_history', {
      user_id: userId, username, channel_id: channelId, channel_name: channelName,
      start_time: startTime, status: 'playing', client_ip: clientIp, channel_logo: channelLogo, stream_profile_name: streamProfileName,
    });

    const newStreamInfo: ActiveStreamInfo = {
      process: ffmpeg, references: 1, lastAccess: Date.now(), userId, username, channelId, channelName,
      channelLogo, streamProfileName, startTime, historyId, clientIp, streamKey, isTranscoded,
    };
    activeStreamProcesses.set(streamKey, newStreamInfo);
    console.log(`[STREAM] Started FFMPEG process with PID: ${ffmpeg.pid} for user ${userId} for stream key: ${streamKey}.`);
    broadcastAdminUpdate();
  } catch (err) {
    console.error('[STREAM_HISTORY] Error logging stream start:', (err as Error).message);
  }

  if (profile.command.includes('-f mp4')) {
    res.setHeader('Content-Type', 'video/mp4');
  } else {
    res.setHeader('Content-Type', 'video/mp2t');
  }
  ffmpeg.stdout.pipe(res);
  ffmpeg.stderr.on('data', (data) => console.error(`[FFMPEG_ERROR] Stream: ${streamKey} - ${data.toString().trim()}`));

  const cleanupOnExit = async () => {
    const info = activeStreamProcesses.get(streamKey);
    if (info?.historyId) {
      await updateStreamHistoryEnd(info.historyId, info.startTime).catch((e) => console.error('[STREAM] Error updating history on exit:', e));
    }
    activeStreamProcesses.delete(streamKey);
    broadcastAdminUpdate();
  };

  ffmpeg.on('close', (code) => {
    console.log(`[STREAM] ffmpeg process for ${streamKey} exited with code ${code}`);
    cleanupOnExit();
    if (!res.headersSent) res.status(500).send('FFmpeg stream ended unexpectedly or failed to start.');
    else res.end();
  });
  ffmpeg.on('error', (err) => {
    console.error(`[STREAM] Failed to start ffmpeg process for ${streamKey}: ${err.message}`);
    cleanupOnExit();
    if (!res.headersSent) res.status(500).send('Failed to start streaming service. Check server logs.');
  });

  const onClientClose = () => {
    updateActiveStream(streamKey, (prev) => ({
      ...prev,
      references: Math.max(0, prev.references - 1),
      lastAccess: Date.now(),
    }));
    try {
      ffmpeg.stdout.unpipe(res);
    } catch {}
  };
  req.on('close', onClientClose);
  res.on('close', onClientClose);
  })

// HEAD probe support for Shaka Player.
  .head(streamAuth, async (req, res) => {
  const profileId = req.query.profileId as string | undefined;
  const settings = getSettings();
  let profile = settings.streamProfiles.find((p) => p.id === profileId);
  if (!profile) profile = settings.castProfiles.find((p) => p.id === profileId);
  if (!profile) return res.status(404).end();

  res.setHeader('Content-Type', profile.command.includes('-f mp4') ? 'video/mp4' : 'video/mp2t');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');
  res.status(200).end();
});

streamRouter.post('/api/cast/generate-token', requireAuth, (req, res) => {
  try {
    const { streamUrl } = req.body as { streamUrl?: string };
    const userId = req.session.userId as number;
    if (!streamUrl) {
      return res.status(400).json({ error: 'streamUrl is required' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
    activeCastTokens.set(token, { userId, streamUrl, expiresAt, createdAt: Date.now() });

    setTimeout(() => {
      activeCastTokens.delete(token);
      console.log(`[CAST_TOKEN] Token expired and removed: ${token.substring(0, 8)}...`);
    }, 6 * 60 * 60 * 1000);

    console.log(`[CAST_TOKEN] Generated token for user ${userId}, expires in 6 hours`);
    res.json({ token });
  } catch (error) {
    console.error('[CAST_TOKEN] Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate cast token' });
  }
});

streamRouter.post('/api/stream/stop', requireAuth, async (req, res) => {
  const { url: streamUrl, profileId } = req.body as { url?: string; profileId?: string };
  let streamKey: string;

  if (!streamUrl) {
    return res.status(400).json({ error: 'Stream URL is required to stop the stream.' });
  }

  if (profileId) {
    streamKey = `${req.session.userId}::${streamUrl}::${profileId}`;
  } else {
    const partialKey = `${req.session.userId}::${streamUrl}`;
    if (activeStreamProcesses.has(partialKey)) {
      streamKey = partialKey;
    } else {
      streamKey = partialKey;
      for (const key of activeStreamProcesses.keys()) {
        if (key.startsWith(partialKey + '::')) {
          streamKey = key;
          break;
        }
      }
    }
  }

  const activeStreamInfo = activeStreamProcesses.get(streamKey);
  if (!activeStreamInfo) {
    return res.json({ success: true, message: 'No active stream to stop.' });
  }

  if (activeStreamInfo.references > 1) {
    console.log(`[STREAM_STOP_API] Stream ${streamKey} has ${activeStreamInfo.references} active references. NOT terminating process.`);
    return res.json({ success: true, message: 'Stream kept alive for other active clients.' });
  }

  try {
    if (activeStreamInfo.historyId) {
      await updateStreamHistoryEnd(activeStreamInfo.historyId, activeStreamInfo.startTime);
    }
    activeStreamInfo.process.kill('SIGKILL');
    activeStreamProcesses.delete(streamKey);
    broadcastAdminUpdate();
  } catch (e) {
    console.warn(`[STREAM_STOP_API] Could not kill process for key: ${streamKey}. Error: ${(e as Error).message}`);
  }
  res.json({ success: true, message: `Stream process for ${streamKey} terminated.` });
});

streamRouter.post('/api/activity/start-redirect', requireAuth, async (req, res) => {
  const { streamUrl, channelId, channelName, channelLogo } = req.body as {
    streamUrl?: string; channelId?: string; channelName?: string; channelLogo?: string;
  };
  const userId = req.session.userId as number;
  const username = req.session.username as string;
  const clientIp = req.ip as string;
  const startTime = new Date().toISOString();

  try {
    const historyId = await insertAndGetId('stream_history', {
      user_id: userId, username, channel_id: channelId, channel_name: channelName,
      start_time: startTime, status: 'playing', client_ip: clientIp, channel_logo: channelLogo, stream_profile_name: 'Redirect',
    });

    const streamKey = `${userId}::${historyId}`;
    activeRedirectStreams.set(streamKey, {
      streamKey, userId, username, channelId: channelId || null, channelName: channelName || '',
      channelLogo: channelLogo || null, streamProfileName: 'Redirect', startTime, clientIp, isTranscoded: false, historyId,
    });
    broadcastAdminUpdate();

    res.status(201).json({ success: true, historyId });
  } catch (err) {
    console.error('[REDIRECT_LOG] Error logging redirect stream start:', (err as Error).message);
    res.status(500).json({ error: 'Could not log stream start.' });
  }
});

streamRouter.post('/api/activity/stop-redirect', requireAuth, async (req, res) => {
  const { historyId } = req.body as { historyId?: number };
  if (!historyId) {
    return res.status(400).json({ error: 'History ID is required.' });
  }

  const streamKey = `${req.session.userId}::${historyId}`;
  if (activeRedirectStreams.has(streamKey)) {
    activeRedirectStreams.delete(streamKey);
    broadcastAdminUpdate();
  }

  try {
    const row = await db('stream_history').select('start_time').where({ id: historyId, user_id: req.session.userId }).first();
    if (!row) {
      return res.status(200).json({ success: true, message: 'Stream stopped, history record not found.' });
    }
    await updateStreamHistoryEndUnconditional(historyId, row.start_time);
    res.json({ success: true });
  } catch (err) {
    console.error(`[REDIRECT_LOG] Error updating redirect stream end for history ID ${historyId}:`, (err as Error).message);
    res.status(500).json({ error: 'Could not log stream end.' });
  }
});

async function updateStreamHistoryEndUnconditional(historyId: number, startTime: string): Promise<void> {
  const endTime = new Date().toISOString();
  const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
  await db('stream_history').where({ id: historyId }).whereNull('end_time').update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
}

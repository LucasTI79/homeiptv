import fs from 'fs';
import path from 'path';
import disk from 'diskusage';
import { Router } from 'express';
import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';
import { requireAuth, requireDvrAccess } from '../middleware/auth';
import { getSettings } from '../services/settings';
import { env } from '../config/env';
import { activeDvrJobs } from '../state/dvrState';
import { scheduleDvrJob, stopRecording, checkForConflicts, type NewDvrJob } from '../services/dvrRecorder';
import type { DvrJob } from '@viniplay/shared-types';

// Ports the 12 /api/dvr/* routes from server.js:4510-4839.
export const dvrRouter = Router();

dvrRouter.get('/dvr/timeshift/:jobId', requireAuth, requireDvrAccess, async (req, res) => {
  const { jobId } = req.params;
  const userId = req.session.userId;

  try {
    const job = await db('dvr_jobs').select('filePath', 'status').where({ id: jobId, user_id: userId }).first();
    if (!job) return res.status(404).send('Recording job not found or not authorized.');
    if (job.status !== 'recording') return res.status(400).send('Cannot timeshift a recording that is not in progress.');
    if (!job.filePath || !fs.existsSync(job.filePath)) return res.status(404).send('Recording file not found on disk.');

    res.setHeader('Content-Type', 'video/mp2t');
    const stream = fs.createReadStream(job.filePath);
    stream.pipe(res);
    stream.on('error', (streamErr) => {
      console.error(`[DVR_TIMESHIFT] Error streaming file ${job.filePath}:`, streamErr);
      res.end();
    });
  } catch (err) {
    console.error(`[DVR_TIMESHIFT] DB error fetching job ${jobId}:`, err);
    res.status(500).send('Server error.');
  }
});

dvrRouter.post('/dvr/schedule', requireAuth, requireDvrAccess, async (req, res) => {
  const { channelId, channelName, programTitle, programStart, programStop } = req.body as {
    channelId: string; channelName: string; programTitle: string; programStart: string; programStop: string;
  };
  const settings = getSettings();
  const dvrSettings = settings.dvr;
  const preBuffer = (dvrSettings.preBufferMinutes || 0) * 60 * 1000;
  const postBuffer = (dvrSettings.postBufferMinutes || 0) * 60 * 1000;

  const newJob: NewDvrJob = {
    user_id: req.session.userId as number,
    channelId, channelName, programTitle,
    startTime: new Date(new Date(programStart).getTime() - preBuffer).toISOString(),
    endTime: new Date(new Date(programStop).getTime() + postBuffer).toISOString(),
    status: 'scheduled',
    profileId: dvrSettings.activeRecordingProfileId,
    userAgentId: settings.activeUserAgentId,
    preBufferMinutes: dvrSettings.preBufferMinutes || 0,
    postBufferMinutes: dvrSettings.postBufferMinutes || 0,
  };

  const conflictingJobs = await checkForConflicts(newJob, req.session.userId as number);
  if (conflictingJobs.length > 0) {
    return res.status(409).json({ error: 'Recording conflict detected.', newJob, conflictingJobs });
  }

  try {
    const id = await insertAndGetId('dvr_jobs', newJob);
    const jobWithId = { ...newJob, id } as DvrJob;
    scheduleDvrJob(jobWithId);
    res.status(201).json({ success: true, job: jobWithId });
  } catch (err) {
    console.error('[DVR_API] Error scheduling new recording:', err);
    res.status(500).json({ error: 'Could not schedule recording.' });
  }
});

dvrRouter.post('/dvr/schedule/manual', requireAuth, requireDvrAccess, async (req, res) => {
  const { channelId, channelName, startTime, endTime } = req.body as {
    channelId: string; channelName: string; startTime: string; endTime: string;
  };
  const settings = getSettings();
  const dvrSettings = settings.dvr;

  const newJob: NewDvrJob = {
    user_id: req.session.userId as number,
    channelId, channelName,
    programTitle: `Manual Recording: ${channelName}`,
    startTime, endTime,
    status: 'scheduled',
    profileId: dvrSettings.activeRecordingProfileId,
    userAgentId: settings.activeUserAgentId,
    preBufferMinutes: 0,
    postBufferMinutes: 0,
  };

  const conflictingJobs = await checkForConflicts(newJob, req.session.userId as number);
  if (conflictingJobs.length > 0) {
    return res.status(409).json({ error: 'Recording conflict detected.', newJob, conflictingJobs });
  }

  try {
    const id = await insertAndGetId('dvr_jobs', newJob);
    const jobWithId = { ...newJob, id } as DvrJob;
    scheduleDvrJob(jobWithId);
    res.status(201).json({ success: true, job: jobWithId });
  } catch {
    res.status(500).json({ error: 'Could not schedule recording.' });
  }
});

dvrRouter.get('/dvr/jobs', requireAuth, async (req, res) => {
  try {
    if (req.session.isAdmin) {
      const rows = await db('dvr_jobs as j').join('users as u', 'j.user_id', 'u.id').select('j.*', 'u.username').orderBy('j.startTime', 'desc');
      res.json(rows);
    } else if (req.session.canUseDvr) {
      const rows = await db('dvr_jobs').where({ user_id: req.session.userId }).orderBy('startTime', 'desc');
      res.json(rows.map((r) => ({ ...r, username: req.session.username })));
    } else {
      res.json([]);
    }
  } catch {
    res.status(500).json({ error: 'Failed to retrieve recording jobs.' });
  }
});

dvrRouter.get('/dvr/recordings', requireAuth, async (_req, res) => {
  try {
    const rows = await db('dvr_recordings as r').join('users as u', 'r.user_id', 'u.id').select('r.*', 'u.username').orderBy('r.startTime', 'desc');
    res.json(rows.map((r) => ({ ...r, filename: path.basename(r.filePath) })));
  } catch {
    res.status(500).json({ error: 'Failed to retrieve recordings.' });
  }
});

dvrRouter.get('/dvr/storage', requireAuth, (req, res) => {
  if (!req.session.canUseDvr && !req.session.isAdmin) {
    return res.json({ total: 0, used: 0, percentage: 0 });
  }
  try {
    disk.check(env.dvrDir, (err, info) => {
      if (err) {
        console.error('[DVR_STORAGE] Error checking disk usage:', err);
        return res.status(500).json({ error: 'Could not get storage information.' });
      }
      if (!info) return res.status(500).json({ error: 'Could not get storage information.' });
      const used = info.total - info.free;
      const percentage = Math.round((used / info.total) * 100);
      res.json({ total: info.total, used, percentage });
    });
  } catch (e) {
    console.error('[DVR_STORAGE] Unhandled error in diskusage:', e);
    res.status(500).json({ error: 'Server error checking storage.' });
  }
});

dvrRouter.delete('/dvr/jobs/all', requireAuth, requireDvrAccess, async (req, res) => {
  const userId = req.session.userId;
  try {
    const scheduledJobs = await db('dvr_jobs').select('id').where({ user_id: userId, status: 'scheduled' });
    for (const job of scheduledJobs) {
      if (activeDvrJobs.has(job.id)) {
        activeDvrJobs.get(job.id)?.cancel();
        activeDvrJobs.delete(job.id);
      }
    }
    const deletedCount = await db('dvr_jobs').where({ user_id: userId }).del();
    res.json({ success: true, deletedCount });
  } catch {
    res.status(500).json({ error: 'Could not clear jobs from database.' });
  }
});

dvrRouter.delete('/dvr/recordings/all', requireAuth, requireDvrAccess, async (req, res) => {
  const userId = req.session.userId;
  try {
    const recordings = await db('dvr_recordings').select('id', 'filePath').where({ user_id: userId });
    for (const rec of recordings) {
      if (fs.existsSync(rec.filePath)) {
        fs.unlink(rec.filePath, (unlinkErr) => {
          if (unlinkErr) console.error(`[DVR_API] Failed to delete file ${rec.filePath}:`, unlinkErr);
        });
      }
    }
    const deletedCount = await db('dvr_recordings').where({ user_id: userId }).del();
    res.json({ success: true, deletedCount });
  } catch {
    res.status(500).json({ error: 'Could not clear recordings from database.' });
  }
});

dvrRouter.delete('/dvr/jobs/:id', requireAuth, requireDvrAccess, async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  if (activeDvrJobs.has(jobId)) {
    activeDvrJobs.get(jobId)?.cancel();
    activeDvrJobs.delete(jobId);
  }

  try {
    const query = req.session.isAdmin ? { id: jobId } : { id: jobId, user_id: req.session.userId };
    const changes = await db('dvr_jobs').where(query).update({ status: 'cancelled' });
    if (changes === 0) return res.status(404).json({ error: 'Job not found or not authorized to cancel.' });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Could not cancel job.' });
  }
});

dvrRouter.delete('/dvr/recordings/:id', requireAuth, requireDvrAccess, async (req, res) => {
  const { id } = req.params;
  try {
    const query = req.session.isAdmin ? { id } : { id, user_id: req.session.userId };
    const row = await db('dvr_recordings').select('filePath').where(query).first();
    if (!row) return res.status(404).json({ error: 'Recording not found or not authorized.' });

    if (fs.existsSync(row.filePath)) {
      fs.unlink(row.filePath, (unlinkErr) => {
        if (unlinkErr) console.error(`[DVR_API] Failed to delete file ${row.filePath}:`, unlinkErr);
      });
    }
    await db('dvr_recordings').where({ id }).del();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete recording record.' });
  }
});

dvrRouter.post('/dvr/jobs/:id/stop', requireAuth, requireDvrAccess, async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  console.log(`[DVR_API] Received request to stop recording for job ${jobId}.`);
  stopRecording(jobId);

  try {
    const query = req.session.isAdmin ? { id: jobId } : { id: jobId, user_id: req.session.userId };
    const changes = await db('dvr_jobs').where(query).update({ status: 'completed' });
    if (changes === 0) return res.status(404).json({ error: 'Job not found or not authorized to stop.' });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Could not update job status after stop.' });
  }
});

dvrRouter.put('/dvr/jobs/:id', requireAuth, requireDvrAccess, async (req, res) => {
  const { id } = req.params;
  const { startTime, endTime } = req.body as { startTime?: string; endTime?: string };
  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'Both startTime and endTime are required.' });
  }

  try {
    const query = req.session.isAdmin ? { id } : { id, user_id: req.session.userId };
    const job = await db('dvr_jobs').where(query).first();
    if (!job) return res.status(404).json({ error: 'Job not found or unauthorized.' });
    if (job.status !== 'scheduled') return res.status(400).json({ error: 'Only scheduled jobs can be modified.' });

    await db('dvr_jobs').where({ id }).update({ startTime, endTime });
    const updatedJob = { ...job, startTime, endTime } as DvrJob;
    scheduleDvrJob(updatedJob);
    res.json({ success: true, job: updatedJob });
  } catch {
    res.status(500).json({ error: 'Could not update job.' });
  }
});

dvrRouter.delete('/dvr/jobs/:id/history', requireAuth, requireDvrAccess, async (req, res) => {
  const { id } = req.params;
  try {
    const query = req.session.isAdmin ? { id } : { id, user_id: req.session.userId };
    const job = await db('dvr_jobs').select('status').where(query).first();
    if (!job) return res.status(404).json({ error: 'Job not found or unauthorized.' });

    if (['error', 'cancelled', 'completed'].includes(job.status)) {
      await db('dvr_jobs').where({ id }).del();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Only completed, cancelled, or error jobs can be removed from history.' });
    }
  } catch {
    res.status(500).json({ error: 'Could not delete job history.' });
  }
});

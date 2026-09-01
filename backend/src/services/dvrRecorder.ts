import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import schedule from 'node-schedule';
import { db } from '../db/connection';
import { getSettings } from '../services/settings';
import { parseM3U } from '../services/sources';
import { LIVE_CHANNELS_M3U_PATH } from '../config/paths';
import { env } from '../config/env';
import { activeDvrJobs, runningFFmpegProcesses } from '../state/dvrState';
import type { DvrJob } from '@viniplay/shared-types';

// Ports stopRecording/startRecording/scheduleDvrJob/checkForConflicts from
// server.js:4275-4462, using Knex instead of raw db.run/db.all.
export type NewDvrJob = Omit<DvrJob, 'id' | 'ffmpeg_pid' | 'filePath' | 'errorMessage' | 'isConflicting'>;

export function stopRecording(jobId: number): void {
  const pid = runningFFmpegProcesses.get(jobId);
  if (pid) {
    console.log(`[DVR] Gracefully stopping recording for job ${jobId} (PID: ${pid}). Sending SIGINT.`);
    try {
      process.kill(pid, 'SIGINT');
    } catch (e) {
      console.error(`[DVR] Error sending SIGINT to ffmpeg process for job ${jobId}: ${(e as Error).message}. Trying SIGKILL.`);
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  } else {
    console.warn(`[DVR] Cannot stop job ${jobId}: No running ffmpeg process found.`);
  }
}

export async function startRecording(job: DvrJob): Promise<void> {
  console.log(`[DVR] Starting recording for job ${job.id}: "${job.programTitle}"`);
  const settings = getSettings();
  const allChannels = parseM3U(fs.existsSync(LIVE_CHANNELS_M3U_PATH) ? fs.readFileSync(LIVE_CHANNELS_M3U_PATH, 'utf-8') : '');
  const channel = allChannels.find((c) => c.id === job.channelId);

  const fail = async (errorMsg: string) => {
    console.error(`[DVR] Cannot start recording job ${job.id}: ${errorMsg}`);
    await db('dvr_jobs').where({ id: job.id }).update({ status: 'error', ffmpeg_pid: null, errorMessage: errorMsg });
  };

  if (!channel) return fail(`Channel ID ${job.channelId} not found in M3U.`);

  const recProfile = settings.dvr.recordingProfiles.find((p) => p.id === job.profileId);
  if (!recProfile) return fail(`Recording profile ID "${job.profileId}" not found.`);

  const userAgent = settings.userAgents.find((ua) => ua.id === job.userAgentId);
  if (!userAgent) return fail('User agent not found.');

  console.log(`[DVR] Using recording profile: "${recProfile.name}"`);

  const streamUrlToRecord = channel.url;
  const fileExtension = recProfile.command.includes('-f mp4') ? '.mp4' : '.ts';
  const safeFilename = `${job.id}_${job.programTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${fileExtension}`;
  const fullFilePath = path.join(env.dvrDir, safeFilename);

  const commandTemplate = `-v level+${settings.dvrLogLevel} ` + recProfile.command
    .replace(/{streamUrl}/g, streamUrlToRecord)
    .replace(/{userAgent}/g, userAgent.value)
    .replace(/{filePath}/g, fullFilePath);

  const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((arg) => arg.replace(/^"|"$/g, ''));

  console.log(`[DVR] Spawning ffmpeg for job ${job.id} with command: ffmpeg ${args.join(' ')}`);
  const ffmpeg = spawn('ffmpeg', args);
  runningFFmpegProcesses.set(job.id, ffmpeg.pid as number);

  await db('dvr_jobs').where({ id: job.id }).update({ status: 'recording', ffmpeg_pid: ffmpeg.pid, filePath: fullFilePath });

  let ffmpegErrorOutput = '';
  ffmpeg.stderr.on('data', (data) => {
    const line = data.toString().trim();
    console.log(`[FFMPEG_DVR][${job.id}] ${line}`);
    ffmpegErrorOutput += line + '\n';
  });

  ffmpeg.on('close', (code) => {
    runningFFmpegProcesses.delete(job.id);
    const wasStoppedIntentionally = ffmpegErrorOutput.includes('Exiting normally, received signal 2') || code === 255;
    const logMessage = code === 0 || wasStoppedIntentionally ? 'finished gracefully' : `exited with error code ${code}`;
    console.log(`[DVR] Recording process for job ${job.id} ("${job.programTitle}") ${logMessage}.`);

    try {
      if (fs.existsSync(fullFilePath)) {
        fs.chmodSync(fullFilePath, 0o666);
      }
    } catch (chmodErr) {
      console.error(`[DVR] Failed to set permissions for ${fullFilePath}:`, (chmodErr as Error).message);
    }

    fs.stat(fullFilePath, async (statErr, stats) => {
      if ((code === 0 || wasStoppedIntentionally) && !statErr && stats && stats.size > 1024) {
        const durationSeconds = (new Date(job.endTime).getTime() - new Date(job.startTime).getTime()) / 1000;
        try {
          await db('dvr_recordings').insert({
            job_id: job.id, user_id: job.user_id, channelName: job.channelName, programTitle: job.programTitle,
            startTime: job.startTime, durationSeconds: Math.round(durationSeconds), fileSizeBytes: stats.size, filePath: fullFilePath,
          });
          console.log(`[DVR] Job ${job.id} logged to completed recordings.`);
        } catch (insertErr) {
          console.error(`[DVR] Failed to create dvr_recordings entry for job ${job.id}:`, (insertErr as Error).message);
        }
        await db('dvr_jobs').where({ id: job.id }).update({ status: 'completed', ffmpeg_pid: null });
      } else {
        const finalErrorMessage = `Recording failed. FFmpeg exit code: ${code}. ${statErr ? 'File stat error: ' + statErr.message : ''}. FFmpeg output: ${ffmpegErrorOutput.slice(-1000)}`;
        console.error(`[DVR] Recording for job ${job.id} failed. ${finalErrorMessage}`);
        await db('dvr_jobs').where({ id: job.id }).update({ status: 'error', ffmpeg_pid: null, errorMessage: finalErrorMessage });
        if (!statErr && stats && stats.size <= 1024) {
          fs.unlink(fullFilePath, (unlinkErr) => {
            if (unlinkErr) console.error(`[DVR] Could not delete failed recording file: ${fullFilePath}`, unlinkErr);
          });
        }
      }
    });
  });

  ffmpeg.on('error', async (err) => {
    const errorMsg = `Failed to spawn ffmpeg process: ${err.message}`;
    console.error(`[DVR] ${errorMsg} for job ${job.id}`);
    runningFFmpegProcesses.delete(job.id);
    await db('dvr_jobs').where({ id: job.id }).update({ status: 'error', ffmpeg_pid: null, errorMessage: errorMsg });
  });
}

export function scheduleDvrJob(job: DvrJob): void {
  if (activeDvrJobs.has(job.id)) {
    activeDvrJobs.get(job.id)?.cancel();
    activeDvrJobs.delete(job.id);
  }

  const startTime = new Date(job.startTime);
  const endTime = new Date(job.endTime);
  const now = new Date();

  if (endTime <= now) {
    console.log(`[DVR] Job ${job.id} for "${job.programTitle}" is already in the past. Skipping schedule.`);
    if (job.status === 'scheduled') {
      db('dvr_jobs').where({ id: job.id }).update({ status: 'error', errorMessage: 'Job was scheduled for a time in the past.' }).catch((e) => console.error(e));
    }
    return;
  }

  if (startTime > now) {
    const startJob = schedule.scheduleJob(startTime, () => startRecording(job));
    activeDvrJobs.set(job.id, startJob);
    console.log(`[DVR] Scheduled recording start for job ${job.id} at ${startTime}`);
  } else {
    startRecording(job);
  }

  schedule.scheduleJob(endTime, () => stopRecording(job.id));
  console.log(`[DVR] Scheduled recording stop for job ${job.id} at ${endTime}`);
}

export async function checkForConflicts(newJob: NewDvrJob, userId: number): Promise<DvrJob[]> {
  const settings = getSettings();
  const maxConcurrent = settings.dvr?.maxConcurrentRecordings || 1;

  const scheduledJobs = await db('dvr_jobs').where({ user_id: userId, status: 'scheduled' });

  const newStart = new Date(newJob.startTime).getTime();
  const newEnd = new Date(newJob.endTime).getTime();

  const conflictingJobs = scheduledJobs.filter((existingJob) => {
    const existingStart = new Date(existingJob.startTime).getTime();
    const existingEnd = new Date(existingJob.endTime).getTime();
    return newStart < existingEnd && newEnd > existingStart;
  });

  return conflictingJobs.length >= maxConcurrent ? conflictingJobs : [];
}

export async function autoDeleteOldRecordings(): Promise<void> {
  console.log('[DVR_STORAGE] Running daily check for old recordings to delete.');
  try {
    const users = await db('users').select('id');

    for (const user of users) {
      const row = await db('user_settings').select('value').where({ user_id: user.id, key: 'dvr' }).first();
      const settings = getSettings();
      const userDvrSettings = row ? { ...settings.dvr, ...JSON.parse(row.value) } : settings.dvr;

      const deleteDays = userDvrSettings.autoDeleteDays;
      if (!deleteDays || deleteDays <= 0) continue;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - deleteDays);

      const recordingsToDelete = await db('dvr_recordings').select('id', 'filePath').where('user_id', user.id).andWhere('startTime', '<', cutoffDate.toISOString());
      if (recordingsToDelete.length > 0) {
        console.log(`[DVR_STORAGE] Found ${recordingsToDelete.length} old recording(s) to delete for user ${user.id}.`);
      }

      for (const rec of recordingsToDelete) {
        if (fs.existsSync(rec.filePath)) {
          fs.unlink(rec.filePath, async (unlinkErr) => {
            if (unlinkErr) {
              console.error(`[DVR_STORAGE] Failed to delete file ${rec.filePath}:`, unlinkErr);
            } else {
              await db('dvr_recordings').where({ id: rec.id }).del();
              console.log(`[DVR_STORAGE] Deleted old recording file and DB record: ${rec.filePath}`);
            }
          });
        } else {
          await db('dvr_recordings').where({ id: rec.id }).del();
        }
      }
    }
  } catch (err) {
    console.error('[DVR_STORAGE] Could not run auto-delete check:', err);
  }
}

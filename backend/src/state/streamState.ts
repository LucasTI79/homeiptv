import type { ChildProcessWithoutNullStreams } from 'child_process';
import { db } from '../db/connection';

// Ports the module-level state from server.js:31-60, 609-627 (activeStreamProcesses,
// activeRedirectStreams, activeCastTokens, the janitor).
export interface ActiveStreamInfo {
  process: ChildProcessWithoutNullStreams;
  references: number;
  lastAccess: number;
  userId: number;
  username: string;
  channelId: string | null;
  channelName: string;
  channelLogo: string | null;
  streamProfileName: string;
  startTime: string;
  historyId: number;
  clientIp: string;
  streamKey: string;
  isTranscoded: boolean;
}

export interface ActiveRedirectStreamInfo {
  streamKey: string;
  userId: number;
  username: string;
  channelId: string | null;
  channelName: string;
  channelLogo: string | null;
  streamProfileName: string;
  startTime: string;
  clientIp: string;
  isTranscoded: boolean;
  historyId: number;
}

export interface CastTokenData {
  userId: number;
  streamUrl: string;
  expiresAt: number;
  createdAt: number;
}

export const activeStreamProcesses = new Map<string, ActiveStreamInfo>();
export const activeRedirectStreams = new Map<string, ActiveRedirectStreamInfo>();
export const activeCastTokens = new Map<string, CastTokenData>();

export function updateActiveStream(
  streamKey: string,
  updater: (prev: ActiveStreamInfo) => ActiveStreamInfo
): ActiveStreamInfo | null {
  const current = activeStreamProcesses.get(streamKey);
  if (!current) return null;
  const updated = updater(current);
  activeStreamProcesses.set(streamKey, updated);
  return updated;
}

export const STREAM_INACTIVITY_TIMEOUT = 60000; // 60 seconds tolerance for network buffering & Cast

// Wired up by the admin/SSE domain (task #16) once it lands; a no-op until
// then so streaming/DVR code can call it unconditionally, same seam pattern
// as the rest of this port.
export let broadcastAdminUpdate: () => void = () => {};
export function setBroadcastAdminUpdate(fn: () => void): void {
  broadcastAdminUpdate = fn;
}

export function cleanupInactiveStreams(): void {
  const now = Date.now();
  console.log(`[JANITOR] Running cleanup for inactive streams. Current active processes: ${activeStreamProcesses.size}`);

  activeStreamProcesses.forEach((streamInfo, streamKey) => {
    if (streamInfo.references <= 0 && now - streamInfo.lastAccess > STREAM_INACTIVITY_TIMEOUT) {
      console.log(`[JANITOR] Found stale stream process for key: ${streamKey}. Terminating PID: ${streamInfo.process.pid}.`);
      try {
        if (streamInfo.historyId) {
          const endTime = new Date().toISOString();
          const duration = Math.round((new Date(endTime).getTime() - new Date(streamInfo.startTime).getTime()) / 1000);
          db('stream_history')
            .where({ id: streamInfo.historyId, status: 'playing' })
            .update({ end_time: endTime, duration_seconds: duration, status: 'stopped' })
            .catch((err) => console.error('[JANITOR] Error updating stream_history:', err));
        }
        streamInfo.process.kill('SIGKILL');
        activeStreamProcesses.delete(streamKey);
        broadcastAdminUpdate();
      } catch (e) {
        console.warn(`[JANITOR] Error killing stale process for ${streamKey}: ${(e as Error).message}`);
        activeStreamProcesses.delete(streamKey);
        broadcastAdminUpdate();
      }
    }
  });
}

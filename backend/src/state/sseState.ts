import type { Response } from 'express';
import { activeStreamProcesses, activeRedirectStreams } from './streamState';

// Ports sseClients + sendSseEvent/broadcastAdminUpdate/broadcastSseToAll from
// server.js:54, 638-699.
interface SseClient {
  id: number;
  res: Response;
  isAdmin: boolean;
}

export const sseClients = new Map<number, SseClient[]>();

export function sendSseEvent(userId: number, eventName: string, data: unknown): void {
  const clients = sseClients.get(userId);
  if (clients && clients.length > 0) {
    console.log(`[SSE] Sending event '${eventName}' to ${clients.length} client(s) for user ID ${userId}.`);
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach((client) => client.res.write(message));
  }
}

export function broadcastAdminUpdateImpl(): void {
  const transcodedLive = Array.from(activeStreamProcesses.values()).map((info) => ({
    streamKey: info.streamKey,
    userId: info.userId,
    username: info.username,
    channelName: info.channelName,
    channelLogo: info.channelLogo,
    streamProfileName: info.streamProfileName,
    startTime: info.startTime,
    clientIp: info.clientIp,
    isTranscoded: true,
  }));

  const redirectLive = Array.from(activeRedirectStreams.values()).map((info) => ({
    streamKey: `${info.userId}::${info.historyId}`,
    userId: info.userId,
    username: info.username,
    channelName: info.channelName,
    channelLogo: info.channelLogo,
    streamProfileName: info.streamProfileName,
    startTime: info.startTime,
    clientIp: info.clientIp,
    isTranscoded: false,
  }));

  const combinedLiveActivity = [...transcodedLive, ...redirectLive];

  for (const clients of sseClients.values()) {
    clients.forEach((client) => {
      if (client.isAdmin) {
        const message = `event: activity-update\ndata: ${JSON.stringify({ live: combinedLiveActivity })}\n\n`;
        client.res.write(message);
      }
    });
  }
  console.log(`[SSE_ADMIN] Broadcasted combined activity update (${combinedLiveActivity.length} live streams) to all connected admins.`);
}

export function broadcastSseToAll(eventName: string, data: unknown): void {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  let clientCount = 0;
  for (const clients of sseClients.values()) {
    clients.forEach((client) => {
      client.res.write(message);
      clientCount++;
    });
  }
  console.log(`[SSE_BROADCAST] Broadcasted event '${eventName}' to ${clientCount} total clients.`);
}

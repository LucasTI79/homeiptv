import { db } from '../db/connection';
import { insertAndGetId } from '../db/helpers';
import type { CreateStreamHistoryInput, IStreamHistoryRepository } from './IStreamHistoryRepository';

export class KnexStreamHistoryRepository implements IStreamHistoryRepository {
  async create(input: CreateStreamHistoryInput): Promise<number> {
    return insertAndGetId('stream_history', {
      user_id: input.userId,
      username: input.username,
      channel_id: input.channelId,
      channel_name: input.channelName,
      start_time: input.startTime,
      status: input.status,
      client_ip: input.clientIp,
      channel_logo: input.channelLogo,
      stream_profile_name: input.streamProfileName,
    });
  }

  async endPlaying(historyId: number, startTime: string): Promise<void> {
    const endTime = new Date().toISOString();
    const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
    await db('stream_history')
      .where({ id: historyId, status: 'playing' })
      .update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
  }

  async endUnconditional(historyId: number, startTime: string): Promise<void> {
    const endTime = new Date().toISOString();
    const duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
    await db('stream_history')
      .where({ id: historyId })
      .whereNull('end_time')
      .update({ end_time: endTime, duration_seconds: duration, status: 'stopped' });
  }

  async getStartTime(historyId: number, userId: number): Promise<string | undefined> {
    const row = await db('stream_history').select('start_time').where({ id: historyId, user_id: userId }).first();
    return row?.start_time;
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/connection';
import { insertAndGetId } from '../../db/helpers';
import { KnexStreamHistoryRepository } from '../KnexStreamHistoryRepository';

vi.mock('../../db/connection', () => ({ db: vi.fn() }));
vi.mock('../../db/helpers', () => ({ insertAndGetId: vi.fn() }));

describe('KnexStreamHistoryRepository', () => {
  let repo: KnexStreamHistoryRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new KnexStreamHistoryRepository();
  });

  it('create() delegates to insertAndGetId with snake_case columns', async () => {
    vi.mocked(insertAndGetId).mockResolvedValue(42);

    const id = await repo.create({
      userId: 1,
      username: 'alice',
      channelId: 'ch1',
      channelName: 'Channel 1',
      startTime: '2026-01-01T00:00:00.000Z',
      status: 'playing',
      clientIp: '127.0.0.1',
      channelLogo: null,
      streamProfileName: 'Default',
    });

    expect(id).toBe(42);
    expect(insertAndGetId).toHaveBeenCalledWith('stream_history', {
      user_id: 1,
      username: 'alice',
      channel_id: 'ch1',
      channel_name: 'Channel 1',
      start_time: '2026-01-01T00:00:00.000Z',
      status: 'playing',
      client_ip: '127.0.0.1',
      channel_logo: null,
      stream_profile_name: 'Default',
    });
  });

  it('endPlaying() updates the row filtered by id and status "playing"', async () => {
    const update = vi.fn().mockResolvedValue(1);
    const where = vi.fn().mockReturnValue({ update });
    vi.mocked(db).mockReturnValue({ where } as never);

    await repo.endPlaying(42, '2026-01-01T00:00:00.000Z');

    expect(db).toHaveBeenCalledWith('stream_history');
    expect(where).toHaveBeenCalledWith({ id: 42, status: 'playing' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
  });

  it('endUnconditional() updates the row filtered by id and a null end_time', async () => {
    const update = vi.fn().mockResolvedValue(1);
    const whereNull = vi.fn().mockReturnValue({ update });
    const where = vi.fn().mockReturnValue({ whereNull });
    vi.mocked(db).mockReturnValue({ where } as never);

    await repo.endUnconditional(42, '2026-01-01T00:00:00.000Z');

    expect(where).toHaveBeenCalledWith({ id: 42 });
    expect(whereNull).toHaveBeenCalledWith('end_time');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
  });

  it('getStartTime() returns start_time when a matching row exists', async () => {
    const first = vi.fn().mockResolvedValue({ start_time: '2026-01-01T00:00:00.000Z' });
    const where = vi.fn().mockReturnValue({ first });
    const select = vi.fn().mockReturnValue({ where });
    vi.mocked(db).mockReturnValue({ select } as never);

    const startTime = await repo.getStartTime(42, 1);

    expect(startTime).toBe('2026-01-01T00:00:00.000Z');
    expect(select).toHaveBeenCalledWith('start_time');
    expect(where).toHaveBeenCalledWith({ id: 42, user_id: 1 });
  });

  it('getStartTime() returns undefined when no row matches', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ first });
    const select = vi.fn().mockReturnValue({ where });
    vi.mocked(db).mockReturnValue({ select } as never);

    const startTime = await repo.getStartTime(999, 1);

    expect(startTime).toBeUndefined();
  });
});

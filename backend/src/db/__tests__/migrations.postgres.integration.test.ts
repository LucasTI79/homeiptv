import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import knexFactory, { type Knex } from 'knex';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);
// This file lives at backend/src/db/__tests__/ -- three levels up is backend/,
// which is where package.json and the knexfile's relative path resolve from.
const BACKEND_ROOT = path.join(__dirname, '../../..');

describe('Postgres migration parity (testcontainers)', () => {
  let container: StartedTestContainer;
  let knex: Knex;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'viniplay_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    const connectionString = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/viniplay_test`;

    // Run the actual migrate command a real Postgres deployment would run --
    // not a hand-rolled in-process migration runner -- so this test proves
    // the real path works, not just that the migration files parse.
    await execFileAsync('npx', ['knex', 'migrate:latest', '--knexfile', 'src/db/knexfile.ts'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DB_CLIENT: 'pg', DB_CONNECTION: connectionString },
    });

    knex = knexFactory({ client: 'pg', connection: connectionString });
  }, 120000);

  afterAll(async () => {
    await knex?.destroy();
    await container?.stop();
  });

  it('creates every table the initial schema migration defines', async () => {
    const expectedTables = [
      'users', 'user_settings', 'multiview_layouts', 'notifications',
      'push_subscriptions', 'notification_deliveries', 'dvr_jobs',
      'dvr_recordings', 'movies', 'series', 'episodes', 'vod_categories',
      'provider_movie_relations', 'provider_series_relations',
      'provider_episode_relations', 'stream_history',
    ];

    for (const table of expectedTables) {
      await expect(knex.schema.hasTable(table)).resolves.toBe(true);
    }
  });

  it('applies the duration_secs migration to movies and episodes', async () => {
    await expect(knex.schema.hasColumn('movies', 'duration_secs')).resolves.toBe(true);
    await expect(knex.schema.hasColumn('episodes', 'duration_secs')).resolves.toBe(true);
  });

  it('records both migrations as applied in knex_migrations', async () => {
    const rows = await knex<{ name: string }>('knex_migrations').select('name');
    const names = rows.map((r) => r.name);

    expect(names).toContain('20260901120000_initial_schema.ts');
    expect(names).toContain('20260913120000_add_duration_secs.ts');
  });
});

import type { Knex } from 'knex';
import path from 'path';
import { env } from '../config/env';

const client = env.dbClient;
const migrationsDir = path.join(__dirname, 'migrations');

// Default sqlite path lives next to the legacy app's own data dir, under a
// different filename so it never collides with the old viniplay.db.
const defaultSqlitePath = path.join(env.dataDir, 'homeiptv.db');

const configs: Record<string, Knex.Config> = {
  'better-sqlite3': {
    client: 'better-sqlite3',
    connection: {
      filename: (env.dbConnection && !path.isAbsolute(env.dbConnection) ? path.resolve(process.cwd(), env.dbConnection) : env.dbConnection) || defaultSqlitePath,
    },
    pool: {
      afterCreate: (conn: { pragma: (p: string) => void }, cb: (err: Error | null, conn: unknown) => void) => {
        try {
          conn.pragma('journal_mode = WAL');
          conn.pragma('synchronous = NORMAL');
          cb(null, conn);
        } catch (e) {
          cb(e as Error, conn);
        }
      },
    },
    useNullAsDefault: true,
    migrations: { directory: migrationsDir, extension: 'ts' },
  },
  pg: {
    client: 'pg',
    connection: env.dbConnection,
    migrations: { directory: migrationsDir, extension: 'ts' },
  },
  mysql2: {
    client: 'mysql2',
    connection: env.dbConnection,
    migrations: { directory: migrationsDir, extension: 'ts' },
  },
};

const config = configs[client];
if (!config) {
  throw new Error(`Unsupported DB_CLIENT: "${client}". Use 'better-sqlite3', 'pg', or 'mysql2'.`);
}

export default config;

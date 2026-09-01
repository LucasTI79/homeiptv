import type { Knex } from 'knex';
import path from 'path';
import 'dotenv/config';

const client = process.env.DB_CLIENT || 'better-sqlite3';
const migrationsDir = path.join(__dirname, 'migrations');

// Default sqlite path lives next to the legacy app's own data dir, under a
// different filename so it never collides with the old viniplay.db.
const defaultSqlitePath = path.resolve(__dirname, '../../../viniplay-data/viniplay.knex.db');

const configs: Record<string, Knex.Config> = {
  'better-sqlite3': {
    client: 'better-sqlite3',
    connection: {
      filename: process.env.DB_CONNECTION || defaultSqlitePath,
    },
    useNullAsDefault: true,
    migrations: { directory: migrationsDir, extension: 'ts' },
  },
  pg: {
    client: 'pg',
    connection: process.env.DB_CONNECTION,
    migrations: { directory: migrationsDir, extension: 'ts' },
  },
  mysql2: {
    client: 'mysql2',
    connection: process.env.DB_CONNECTION,
    migrations: { directory: migrationsDir, extension: 'ts' },
  },
};

const config = configs[client];
if (!config) {
  throw new Error(`Unsupported DB_CLIENT: "${client}". Use 'better-sqlite3', 'pg', or 'mysql2'.`);
}

export default config;

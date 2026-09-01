// One-off script: copies every row from the old hand-managed viniplay.db
// (server.js's sqlite3 database) into the new Knex-migrated database.
// Run once after `npm run migrate` has created a fresh, empty schema.
//
// Usage: npm run migrate:legacy-data
// Env: LEGACY_SQLITE_PATH (defaults to ../../viniplay-data/viniplay.db)

import path from 'path';
import Database from 'better-sqlite3';
import 'dotenv/config';
import { db } from '../src/db/connection';

const TABLES_IN_DEPENDENCY_ORDER = [
  'users',
  'user_settings',
  'multiview_layouts',
  'notifications',
  'push_subscriptions',
  'notification_deliveries',
  'dvr_jobs',
  'dvr_recordings',
  'movies',
  'series',
  'episodes',
  'vod_categories',
  'provider_movie_relations',
  'provider_series_relations',
  'provider_episode_relations',
  'stream_history',
];

async function main() {
  const legacyPath = process.env.LEGACY_SQLITE_PATH
    || path.resolve(__dirname, '../../viniplay-data/viniplay.db');

  console.log(`[migrate-legacy-data] Reading legacy db: ${legacyPath}`);
  const legacyDb = new Database(legacyPath, { readonly: true, fileMustExist: true });

  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    const tableExists = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);

    if (!tableExists) {
      console.log(`[migrate-legacy-data] Skipping "${table}" (not present in legacy db).`);
      continue;
    }

    const rows = legacyDb.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
      console.log(`[migrate-legacy-data] "${table}": 0 rows, nothing to copy.`);
      continue;
    }

    // Batch in chunks so we don't build one giant INSERT for large tables
    // (e.g. stream_history can grow large on long-running instances).
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await db(table).insert(rows.slice(i, i + BATCH_SIZE));
    }
    console.log(`[migrate-legacy-data] "${table}": copied ${rows.length} rows.`);
  }

  legacyDb.close();
  await db.destroy();
  console.log('[migrate-legacy-data] Done.');
}

main().catch((err) => {
  console.error('[migrate-legacy-data] Failed:', err);
  process.exitCode = 1;
});

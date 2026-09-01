import type { Knex } from 'knex';

// Reproduces the schema server.js creates by hand (server.js:139-268 as of the
// pre-migration codebase), table for table, including the columns that used
// to be added later via ALTER TABLE. No column changes here on purpose --
// this migration's only job is to give the legacy schema a version.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.text('username').unique();
    t.text('password');
    t.integer('isAdmin').defaultTo(0);
    t.integer('canUseDvr').defaultTo(0);
    t.text('allowed_sources');
  });

  await knex.schema.createTable('user_settings', (t) => {
    t.integer('user_id').notNullable();
    t.text('key').notNullable();
    t.text('value');
    t.primary(['user_id', 'key']);
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('multiview_layouts', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('name').notNullable();
    t.text('layout_data').notNullable();
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('notifications', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('channelId').notNullable();
    t.text('channelName').notNullable();
    t.text('channelLogo');
    t.text('programTitle').notNullable();
    t.text('programDesc');
    t.text('programStart').notNullable();
    t.text('programStop').notNullable();
    t.text('notificationTime').notNullable();
    t.text('programId').notNullable();
    t.text('status').defaultTo('pending');
    t.text('triggeredAt');
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('push_subscriptions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('endpoint').notNullable().unique();
    t.text('p256dh').notNullable();
    t.text('auth').notNullable();
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('notification_deliveries', (t) => {
    t.increments('id').primary();
    t.integer('notification_id').notNullable();
    t.integer('subscription_id').notNullable();
    t.text('status').notNullable().defaultTo('pending');
    t.text('updatedAt').notNullable();
    t.foreign('notification_id').references('notifications.id').onDelete('CASCADE');
    t.foreign('subscription_id').references('push_subscriptions.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('dvr_jobs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('channelId').notNullable();
    t.text('channelName').notNullable();
    t.text('programTitle').notNullable();
    t.text('startTime').notNullable();
    t.text('endTime').notNullable();
    t.text('status').notNullable();
    t.integer('ffmpeg_pid');
    t.text('filePath');
    t.text('profileId');
    t.text('userAgentId');
    t.integer('preBufferMinutes');
    t.integer('postBufferMinutes');
    t.text('errorMessage');
    t.integer('isConflicting').defaultTo(0);
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('dvr_recordings', (t) => {
    t.increments('id').primary();
    t.integer('job_id');
    t.integer('user_id').notNullable();
    t.text('channelName').notNullable();
    t.text('programTitle').notNullable();
    t.text('startTime').notNullable();
    t.integer('durationSeconds');
    t.integer('fileSizeBytes');
    t.text('filePath').notNullable().unique();
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
    t.foreign('job_id').references('dvr_jobs.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('movies', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.integer('year');
    t.text('description');
    t.text('logo');
    t.text('tmdb_id');
    t.text('imdb_id');
    t.text('category_name');
    t.text('provider_unique_id').unique();
    t.text('created_at').defaultTo(knex.fn.now());
    t.text('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('series', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.integer('year');
    t.text('description');
    t.text('logo');
    t.text('tmdb_id');
    t.text('imdb_id');
    t.text('category_name');
    t.text('provider_unique_id').unique();
    t.text('created_at').defaultTo(knex.fn.now());
    t.text('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('episodes', (t) => {
    t.increments('id').primary();
    t.integer('series_id').notNullable();
    t.integer('season_num').notNullable();
    t.integer('episode_num').notNullable();
    t.text('name');
    t.text('description');
    t.text('air_date');
    t.text('tmdb_id');
    t.text('imdb_id');
    t.text('created_at').defaultTo(knex.fn.now());
    t.text('updated_at').defaultTo(knex.fn.now());
    t.foreign('series_id').references('series.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('vod_categories', (t) => {
    t.increments('id').primary();
    t.text('category_id').notNullable().unique();
    t.text('category_name').notNullable();
    t.text('created_at').defaultTo(knex.fn.now());
    t.text('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('provider_movie_relations', (t) => {
    t.text('provider_id').notNullable();
    t.integer('movie_id').notNullable();
    t.text('stream_id').notNullable();
    t.text('container_extension');
    t.text('last_seen').notNullable();
    t.primary(['provider_id', 'stream_id']);
    t.foreign('movie_id').references('movies.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('provider_series_relations', (t) => {
    t.text('provider_id').notNullable();
    t.integer('series_id').notNullable();
    t.text('external_series_id').notNullable();
    t.text('last_seen').notNullable();
    t.primary(['provider_id', 'external_series_id']);
    t.foreign('series_id').references('series.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('provider_episode_relations', (t) => {
    t.text('provider_id').notNullable();
    t.integer('episode_id').notNullable();
    t.text('provider_stream_id').notNullable();
    t.text('container_extension');
    t.text('last_seen').notNullable();
    t.primary(['provider_id', 'episode_id']);
    t.foreign('episode_id').references('episodes.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('stream_history', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('username').notNullable();
    t.text('channel_id');
    t.text('channel_name');
    t.text('start_time').notNullable();
    t.text('end_time');
    t.integer('duration_seconds');
    t.text('status').notNullable();
    t.text('client_ip');
    t.text('channel_logo');
    t.text('stream_profile_name');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('stream_history');
  await knex.schema.dropTableIfExists('provider_episode_relations');
  await knex.schema.dropTableIfExists('provider_series_relations');
  await knex.schema.dropTableIfExists('provider_movie_relations');
  await knex.schema.dropTableIfExists('vod_categories');
  await knex.schema.dropTableIfExists('episodes');
  await knex.schema.dropTableIfExists('series');
  await knex.schema.dropTableIfExists('movies');
  await knex.schema.dropTableIfExists('dvr_recordings');
  await knex.schema.dropTableIfExists('dvr_jobs');
  await knex.schema.dropTableIfExists('notification_deliveries');
  await knex.schema.dropTableIfExists('push_subscriptions');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('multiview_layouts');
  await knex.schema.dropTableIfExists('user_settings');
  await knex.schema.dropTableIfExists('users');
}

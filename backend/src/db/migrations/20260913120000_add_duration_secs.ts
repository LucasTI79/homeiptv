import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasEpisodeDuration = await knex.schema.hasColumn('episodes', 'duration_secs');
  if (!hasEpisodeDuration) {
    await knex.schema.alterTable('episodes', (table) => {
      table.integer('duration_secs');
    });
  }

  const hasMovieDuration = await knex.schema.hasColumn('movies', 'duration_secs');
  if (!hasMovieDuration) {
    await knex.schema.alterTable('movies', (table) => {
      table.integer('duration_secs');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasEpisodeDuration = await knex.schema.hasColumn('episodes', 'duration_secs');
  if (hasEpisodeDuration) {
    await knex.schema.alterTable('episodes', (table) => {
      table.dropColumn('duration_secs');
    });
  }

  const hasMovieDuration = await knex.schema.hasColumn('movies', 'duration_secs');
  if (hasMovieDuration) {
    await knex.schema.alterTable('movies', (table) => {
      table.dropColumn('duration_secs');
    });
  }
}

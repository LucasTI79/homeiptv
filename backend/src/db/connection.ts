import knexFactory, { type Knex } from 'knex';
import knexConfig from './knexfile';

export const db: Knex = knexFactory(knexConfig);

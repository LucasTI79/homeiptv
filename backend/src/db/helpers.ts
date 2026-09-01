import { db } from './connection';

// Knex's insert() return shape for the generated primary key differs by
// driver (sqlite/mysql give a plain id, postgres gives a row when using
// .returning()). This normalizes all three to a single number.
export async function insertAndGetId(table: string, data: Record<string, unknown>): Promise<number> {
  const result = await db(table).insert(data).returning('id');
  const first = result[0] as unknown;
  if (typeof first === 'number') return first;
  if (typeof first === 'bigint') return Number(first);
  if (first && typeof first === 'object' && 'id' in (first as Record<string, unknown>)) {
    return Number((first as { id: number | bigint }).id);
  }
  throw new Error(`[db] Could not determine inserted id for table "${table}"`);
}

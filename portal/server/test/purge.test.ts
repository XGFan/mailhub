/**
 * Retention purge selector (AC15 + starred-exempt). The delete must target only
 * mail older than the cutoff AND not starred — a regression here would silently
 * delete favorited mail. Asserted at the SQL level with a never-connected pool.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { mails } from '../src/db/schema';
import { expiredWhere } from '../src/purge';

const pool = new Pool({ connectionString: 'postgres://u:p@127.0.0.1:5432/x' });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

describe('expiredWhere', () => {
  it('deletes only mail past the cutoff AND not starred', () => {
    const { sql, params } = db
      .select({ id: mails.id })
      .from(mails)
      .where(expiredWhere(new Date('2026-01-01T00:00:00Z')))
      .toSQL();
    const lower = sql.toLowerCase();
    // Both the age cutoff and the starred exemption must be present, ANDed.
    expect(lower).toContain('received_at');
    expect(lower).toContain('is_favorite');
    expect(lower).toContain(' and ');
    // The exemption compares is_favorite against the literal false.
    expect(params).toContain(false);
  });
});

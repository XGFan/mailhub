import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { mails } from '../src/db/schema';
import {
  buildOrderBy,
  buildWhereClause,
  DEFAULT_PAGE_SIZE,
  escapeLike,
  MAX_PAGE_SIZE,
  normalizeSearchParams,
  SearchValidationError,
} from '../src/api/search';

// A never-connected pool is enough: `.toSQL()` serializes without executing.
const pool = new Pool({ connectionString: 'postgres://u:p@127.0.0.1:5432/x' });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

// Project only `id` so the SELECT list can't pollute WHERE-clause assertions.
function toSQL(params: ReturnType<typeof normalizeSearchParams>) {
  return db
    .select({ id: mails.id })
    .from(mails)
    .where(buildWhereClause(params))
    .orderBy(...buildOrderBy(params.sort))
    .limit(params.pageSize)
    .toSQL();
}

describe('normalizeSearchParams', () => {
  it('rejects an unknown field', () => {
    expect(() => normalizeSearchParams({ field: 'body' })).toThrow(SearchValidationError);
  });

  it('accepts the four valid fields', () => {
    for (const field of ['all', 'to', 'from', 'subject']) {
      expect(normalizeSearchParams({ field }).field).toBe(field);
    }
  });

  it('defaults and clamps pageSize to <= 100', () => {
    expect(normalizeSearchParams({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizeSearchParams({ pageSize: '999' }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizeSearchParams({ pageSize: '0' }).pageSize).toBe(1);
  });

  it('clamps page to >= 1', () => {
    expect(normalizeSearchParams({ page: '0' }).page).toBe(1);
    expect(normalizeSearchParams({ page: '-5' }).page).toBe(1);
    expect(normalizeSearchParams({ page: '3' }).page).toBe(3);
  });

  it('parses includeSpam truthy variants', () => {
    expect(normalizeSearchParams({ includeSpam: '1' }).includeSpam).toBe(true);
    expect(normalizeSearchParams({ includeSpam: 'true' }).includeSpam).toBe(true);
    expect(normalizeSearchParams({}).includeSpam).toBe(false);
  });

  it('parses favorite truthy variants', () => {
    expect(normalizeSearchParams({ favorite: '1' }).favorite).toBe(true);
    expect(normalizeSearchParams({ favorite: 'true' }).favorite).toBe(true);
    expect(normalizeSearchParams({ favorite: true }).favorite).toBe(true);
    expect(normalizeSearchParams({}).favorite).toBe(false);
  });

  it('defaults sort to date-desc and accepts date-asc', () => {
    expect(normalizeSearchParams({}).sort).toBe('date-desc');
    expect(normalizeSearchParams({ sort: 'date-asc' }).sort).toBe('date-asc');
    expect(normalizeSearchParams({ sort: 'date-desc' }).sort).toBe('date-desc');
  });

  it('falls back to date-desc for an unrecognized sort (never a 400)', () => {
    expect(normalizeSearchParams({ sort: 'bogus' }).sort).toBe('date-desc');
  });
});

describe('escapeLike', () => {
  it('escapes % _ and backslash', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
});

describe('buildWhereClause SQL', () => {
  it('field=all ORs across to_addr, from_addr, subject', () => {
    const { sql } = toSQL(normalizeSearchParams({ q: 'foo', field: 'all' }));
    const lower = sql.toLowerCase();
    expect(lower).toContain('to_addr');
    expect(lower).toContain('from_addr');
    expect(lower).toContain('subject');
    // Three ILIKE conditions joined by OR.
    expect((lower.match(/ilike/g) ?? []).length).toBe(3);
    expect(lower).toContain(' or ');
  });

  it('field=to targets only to_addr', () => {
    const { sql } = toSQL(normalizeSearchParams({ q: 'foo', field: 'to' }));
    const lower = sql.toLowerCase();
    expect((lower.match(/ilike/g) ?? []).length).toBe(1);
    expect(lower).toContain('to_addr');
    expect(lower).not.toContain('from_addr');
  });

  it('escapes LIKE wildcards in the bound parameter', () => {
    const { params } = toSQL(normalizeSearchParams({ q: '50%_off', field: 'subject' }));
    expect(params).toContain('%50\\%\\_off%');
  });

  it('excludes spam by default and includes it when asked', () => {
    const excluded = toSQL(normalizeSearchParams({ q: 'x', field: 'all' })).sql.toLowerCase();
    expect(excluded).toContain('is_spam');
    const included = toSQL(
      normalizeSearchParams({ q: 'x', field: 'all', includeSpam: '1' }),
    ).sql.toLowerCase();
    expect(included).not.toContain('is_spam');
  });

  it('restricts to starred mail only when favorite=true', () => {
    const off = toSQL(normalizeSearchParams({})).sql.toLowerCase();
    expect(off).not.toContain('is_favorite');
    const on = toSQL(normalizeSearchParams({ favorite: '1' })).sql.toLowerCase();
    expect(on).toContain('is_favorite');
  });

  it('combines the favorite filter with a text query (AND)', () => {
    const { sql } = toSQL(normalizeSearchParams({ q: 'foo', field: 'subject', favorite: '1' }));
    const lower = sql.toLowerCase();
    expect(lower).toContain('is_favorite');
    expect(lower).toContain('ilike');
    expect(lower).toContain(' and ');
  });

  it('orders by date DESC NULLS LAST then received_at DESC', () => {
    const { sql } = toSQL(normalizeSearchParams({}));
    const lower = sql.toLowerCase();
    expect(lower).toContain('order by');
    expect(lower).toContain('"date" desc nulls last');
    expect(lower).toContain('received_at" desc');
  });

  it('orders by date ASC NULLS FIRST then received_at ASC when sort=date-asc', () => {
    const { sql } = toSQL(normalizeSearchParams({ sort: 'date-asc' }));
    const lower = sql.toLowerCase();
    expect(lower).toContain('order by');
    expect(lower).toContain('"date" asc nulls first');
    expect(lower).toContain('received_at" asc');
  });
});

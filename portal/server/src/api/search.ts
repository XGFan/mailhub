/**
 * Search query construction for GET /api/mails (plan §5.3, AC5, sec-M4/M5).
 *
 * Factored out of the route handler so the validation, LIKE-escaping, clamping,
 * and the generated SQL (OR-across-columns, ordering) are all unit-testable
 * without a live database — the callers build the Drizzle query and can assert
 * `.toSQL()`.
 */
import type { SearchField } from '@mailhub/shared';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { mails } from '../db/schema';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const VALID_FIELDS: readonly SearchField[] = ['all', 'to', 'from', 'subject'];

/** Thrown for invalid user input (mapped to HTTP 400 by the route). */
export class SearchValidationError extends Error {}

/** Validated + normalized search parameters. */
export interface NormalizedSearch {
  q: string;
  field: SearchField;
  page: number;
  pageSize: number;
  includeSpam: boolean;
}

function toInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Validate and normalize raw query params. Rejects unknown `field` values with
 * a SearchValidationError; clamps `page` (≥1) and `pageSize` (1..100).
 */
export function normalizeSearchParams(raw: {
  q?: string;
  field?: string;
  page?: string | number;
  pageSize?: string | number;
  includeSpam?: string | number | boolean;
}): NormalizedSearch {
  const field = (raw.field ?? 'all') as SearchField;
  if (!VALID_FIELDS.includes(field)) {
    throw new SearchValidationError(`invalid field: ${String(raw.field)}`);
  }

  const page = Math.max(1, toInt(raw.page, 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(raw.pageSize, DEFAULT_PAGE_SIZE)));

  const includeSpam =
    raw.includeSpam === true ||
    raw.includeSpam === 1 ||
    raw.includeSpam === '1' ||
    raw.includeSpam === 'true';

  return { q: (raw.q ?? '').trim(), field, page, pageSize, includeSpam };
}

/**
 * Escape the LIKE/ILIKE wildcards so a user's `%` or `_` is treated literally
 * (Postgres uses backslash as the default LIKE escape character).
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Build the WHERE condition (or undefined for an unfiltered list). */
export function buildWhereClause(p: NormalizedSearch): SQL | undefined {
  const conds: SQL[] = [];

  if (!p.includeSpam) conds.push(eq(mails.isSpam, false));

  if (p.q) {
    const pattern = `%${escapeLike(p.q)}%`;
    switch (p.field) {
      case 'to':
        conds.push(ilike(mails.toAddr, pattern));
        break;
      case 'from':
        conds.push(ilike(mails.fromAddr, pattern));
        break;
      case 'subject':
        conds.push(ilike(mails.subject, pattern));
        break;
      case 'all':
        conds.push(
          or(
            ilike(mails.toAddr, pattern),
            ilike(mails.fromAddr, pattern),
            ilike(mails.subject, pattern),
          )!,
        );
        break;
    }
  }

  if (conds.length === 0) return undefined;
  return conds.length === 1 ? conds[0] : and(...conds);
}

/** Default ordering: header date DESC (nulls last), then received_at DESC. */
export function buildOrderBy(): SQL[] {
  return [sql`${mails.date} DESC NULLS LAST`, desc(mails.receivedAt)];
}

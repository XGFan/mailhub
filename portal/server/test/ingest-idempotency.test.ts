/**
 * AC8 — idempotency. The `r2_key UNIQUE` anchor + `ON CONFLICT DO NOTHING` must
 * make re-processing the same object a no-op, for a mail WITH and WITHOUT a
 * Message-ID. This is a DB-level guarantee, so it runs as an integration test
 * gated on TEST_DATABASE_URL (skipped when no database is available).
 */
import { fileURLToPath } from 'node:url';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mails } from '../src/db/schema';

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

const pool = TEST_DB ? new Pool({ connectionString: TEST_DB }) : null;
const db = pool ? drizzle(pool) : null;

async function insertOnce(r2Key: string, messageId: string | null) {
  return db!
    .insert(mails)
    .values({
      r2Key,
      messageId,
      toAddr: 'me@example.com',
      fromAddr: 'sender@example.com',
      subject: 'hi',
      receivedAt: new Date(),
    })
    .onConflictDoNothing({ target: mails.r2Key })
    .returning({ id: mails.id });
}

async function countFor(r2Key: string): Promise<number> {
  const [{ total }] = await db!
    .select({ total: count() })
    .from(mails)
    .where(eq(mails.r2Key, r2Key));
  return Number(total);
}

describe.skipIf(!TEST_DB)('ingest idempotency (AC8)', () => {
  beforeAll(async () => {
    await migrate(db!, { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('re-processing the same r2_key WITH a Message-ID yields one row', async () => {
    const key = `inbox/${Date.now()}-with-msgid.eml`;
    await db!.delete(mails).where(eq(mails.r2Key, key));

    const first = await insertOnce(key, '<abc@example.com>');
    const second = await insertOnce(key, '<abc@example.com>');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // conflict -> no insert
    expect(await countFor(key)).toBe(1);
  });

  it('re-processing the same r2_key WITHOUT a Message-ID yields one row', async () => {
    const key = `inbox/${Date.now()}-no-msgid.eml`;
    await db!.delete(mails).where(eq(mails.r2Key, key));

    await insertOnce(key, null);
    await insertOnce(key, null);

    expect(await countFor(key)).toBe(1);
  });
});

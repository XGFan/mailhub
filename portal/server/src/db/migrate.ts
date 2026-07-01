/**
 * Migration runner: applies the generated Drizzle migrations, then creates the
 * pg_trgm extension and the search indexes as raw SQL (plan §5.4).
 *
 * The trigram GIN indexes must be created AFTER `CREATE EXTENSION pg_trgm`
 * (they reference the `gin_trgm_ops` operator class), which is why they live
 * here rather than in the Drizzle schema. Everything is idempotent.
 *
 * Run standalone with `pnpm db:migrate` (tsx), and it is also invoked from the
 * portal entrypoint at boot.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Apply schema migrations and (re)create the trigram + sort indexes. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

  // Trigram GIN indexes power case-insensitive ILIKE substring search.
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS mails_to_addr_trgm ON mails USING gin (to_addr gin_trgm_ops);`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS mails_from_addr_trgm ON mails USING gin (from_addr gin_trgm_ops);`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS mails_subject_trgm ON mails USING gin (subject gin_trgm_ops);`,
  );

  // Btree indexes back the default ordering (date DESC, received_at DESC).
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS mails_date_desc_idx ON mails (date DESC NULLS LAST);`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS mails_received_at_desc_idx ON mails (received_at DESC);`,
  );
}

// Execute when run directly (`tsx src/db/migrate.ts`), not when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runMigrations()
    .then(async () => {
      console.log('[migrate] done');
      await pool.end();
    })
    .catch(async (err) => {
      console.error('[migrate] failed', err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

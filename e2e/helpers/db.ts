/**
 * Direct Postgres access for test-state control that the API does not expose:
 * truncating the mail store so the "empty inbox" UI state (AC12) can be asserted
 * against a genuinely empty database, and seeding an artificially-old row when a
 * spec needs one. Uses a short-lived pool so it never leaks connections.
 */
import pg from 'pg';
import { DATABASE_URL } from './env';

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Wait until the core tables exist. Migrations may be applied by either the
 * portal backend's boot migration or the E2E global-setup (they can race, since
 * Playwright starts the webServer alongside global-setup), so we poll rather
 * than assume who won.
 */
export async function waitForTables(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const present = await withClient(async (c) => {
        const r = await c.query(
          "SELECT to_regclass('public.mails') AS m, to_regclass('public.settings') AS s",
        );
        return r.rows[0].m !== null && r.rows[0].s !== null;
      });
      if (present) return;
      lastErr = 'tables not created yet';
    } catch (err) {
      lastErr = String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`tables never appeared: ${lastErr}`);
}

/** Remove every mail (attachments cascade). Leaves the settings row intact. */
export async function truncateMails(): Promise<void> {
  await withClient((c) => c.query('TRUNCATE TABLE mails CASCADE'));
}

/** Reset the portal settings row to defaults (remote images off). */
export async function resetSettings(): Promise<void> {
  await withClient((c) =>
    c.query(
      `INSERT INTO settings (id, show_remote_images) VALUES (1, false)
       ON CONFLICT (id) DO UPDATE SET show_remote_images = false`,
    ),
  );
}

/** How many non-spam mails are currently stored. */
export async function mailCount(): Promise<number> {
  return withClient(async (c) => {
    const r = await c.query('SELECT count(*)::int AS n FROM mails');
    return r.rows[0].n as number;
  });
}

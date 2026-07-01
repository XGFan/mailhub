/**
 * Global setup for the MailHub full-stack E2E.
 *
 * Important ordering note: Playwright launches the `webServer` (the portal
 * backend) *concurrently* with this global setup, and the backend connects to
 * Postgres immediately. Therefore setup must NOT tear the database down (an
 * earlier `docker compose down -v` here killed the backend's live connection and
 * crashed it). Instead we bring the stack UP idempotently and get a clean slate
 * by clearing the bucket and truncating the tables. Teardown is where the stack
 * is removed.
 *
 * Steps: bring up Postgres + MinIO → wait until reachable → create + empty the
 * bucket → apply migrations (tolerating the backend's concurrent boot migration)
 * → truncate the store → build the SPA → start the remote-image tracker.
 *
 * Toggles: E2E_SKIP_DOCKER=1 (reuse a running stack), E2E_SKIP_WEB_BUILD=1
 * (reuse portal/web/dist).
 */
import { mkdir, rm } from 'node:fs/promises';
import pg from 'pg';
import {
  ATTACHMENT_DIR,
  COMPOSE_FILE,
  COMPOSE_PROJECT,
  DATABASE_URL,
  PORTAL_ENV,
  REPO_ROOT,
  TMP_DIR,
} from './helpers/env';
import { resetSettings, truncateMails, waitForTables } from './helpers/db';
import { run } from './helpers/exec';
import { clearBucket, ensureBucket } from './helpers/s3';
import { startTracker } from './helpers/tracker';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForPostgres(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      lastErr = String(err);
      await client.end().catch(() => {});
      await sleep(1000);
    }
  }
  throw new Error(`Postgres not reachable: ${lastErr}`);
}

async function waitForMinio(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      await ensureBucket();
      return;
    } catch (err) {
      lastErr = String(err);
      await sleep(1000);
    }
  }
  throw new Error(`MinIO not reachable: ${lastErr}`);
}

/** Run the portal migrations, retrying to ride out the backend's concurrent boot migration. */
async function migrate(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await run('pnpm', ['--filter', '@mailhub/portal-server', 'db:migrate'], {
        cwd: REPO_ROOT,
        env: { ...PORTAL_ENV },
      });
      return;
    } catch (err) {
      console.warn(`[e2e] migration attempt ${attempt} failed (may be a race): ${err}`);
      await sleep(2000);
    }
  }
  // Either attempt above created the tables, or the backend's boot migration
  // did; waitForTables (in the caller) is the authoritative check.
}

export default async function globalSetup(): Promise<void> {
  const skipDocker = process.env.E2E_SKIP_DOCKER === '1';
  const skipWebBuild = process.env.E2E_SKIP_WEB_BUILD === '1';

  // Fresh scratch dir for attachment bytes.
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(ATTACHMENT_DIR, { recursive: true });

  if (!skipDocker) {
    console.log('[e2e] bringing up Postgres + MinIO (idempotent; NOT destroying a live DB)…');
    await run('docker', ['compose', '-p', COMPOSE_PROJECT, '-f', COMPOSE_FILE, 'up', '-d']);
  } else {
    console.log('[e2e] E2E_SKIP_DOCKER=1 — reusing running stack');
  }

  console.log('[e2e] waiting for Postgres…');
  await waitForPostgres();
  console.log('[e2e] waiting for MinIO + creating bucket…');
  await waitForMinio();
  console.log('[e2e] clearing bucket…');
  await clearBucket();

  console.log('[e2e] applying migrations…');
  await migrate();
  await waitForTables();

  console.log('[e2e] truncating store for a clean slate…');
  await truncateMails();
  await resetSettings();

  if (!skipWebBuild) {
    console.log('[e2e] building web SPA (portal/web/dist)…');
    await run('pnpm', ['--filter', '@mailhub/web', 'build'], { cwd: REPO_ROOT });
  } else {
    console.log('[e2e] E2E_SKIP_WEB_BUILD=1 — reusing existing portal/web/dist');
  }

  console.log('[e2e] starting remote-image tracker…');
  await startTracker();

  console.log('[e2e] setup complete.');
}

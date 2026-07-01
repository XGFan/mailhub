/**
 * Single source of truth for the ports, paths, credentials and derived URLs the
 * E2E harness uses. Imported by playwright.config.ts (webServer env), the global
 * setup/teardown, and the specs so they can never drift apart.
 *
 * Ports are deliberately non-default so the suite does not collide with a
 * developer's own Postgres/MinIO/dev-server or with other background jobs.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Absolute path to e2e/ (this project root). */
export const E2E_DIR = fileURLToPath(new URL('..', import.meta.url));
/** Absolute path to the monorepo root (parent of e2e/). */
export const REPO_ROOT = path.resolve(E2E_DIR, '..');
/** Scratch dir for attachment bytes written by the backend during the run. */
export const TMP_DIR = path.join(E2E_DIR, '.tmp');
/** Where the backend writes parsed attachment + raw .eml bytes. */
export const ATTACHMENT_DIR = path.join(TMP_DIR, 'attachments');

/** docker compose project name (isolates volumes/containers). */
export const COMPOSE_PROJECT = 'mailhub-e2e';
export const COMPOSE_FILE = path.join(E2E_DIR, 'docker-compose.yml');

/** Host ports exposed by docker-compose.yml (must match that file). */
export const PG_PORT = 5433;
export const MINIO_PORT = 9100;

/** The portal backend + SPA (baseURL — the SPA is same-origin). */
export const PORTAL_PORT = 8787;
export const PORTAL_BASE_URL = `http://127.0.0.1:${PORTAL_PORT}`;

/** The out-of-band remote-image tracker used to prove AC6b (zero hits by default). */
export const TRACKER_PORT = 8123;
export const TRACKER_ORIGIN = `http://127.0.0.1:${TRACKER_PORT}`;

/** Postgres + R2/MinIO connection details (fixed dev creds — never production). */
export const DATABASE_URL = `postgres://mailhub:mailhub@127.0.0.1:${PG_PORT}/mailhub`;
export const R2_ENDPOINT = `http://127.0.0.1:${MINIO_PORT}`;
export const R2_ACCESS_KEY_ID = 'mailhub';
export const R2_SECRET_ACCESS_KEY = 'mailhub-secret';
export const R2_BUCKET = 'mailhub-raw';

/** Env block handed to the portal backend (Playwright webServer). */
export const PORTAL_ENV: Record<string, string> = {
  PORT: String(PORTAL_PORT),
  DATABASE_URL,
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  ATTACHMENT_DIR,
  // Short poll so auto-ingest also exercises the path; specs still use the
  // manual POST /api/ingest/run trigger for determinism.
  POLL_INTERVAL_MS: '3000',
  MAX_MAIL_BYTES: '27262976',
  RETENTION_DAYS: '7',
};

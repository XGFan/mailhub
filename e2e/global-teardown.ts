/**
 * Global teardown: stop the tracker and tear down the docker stack (fresh
 * volumes next run). Set E2E_KEEP_STACK=1 to leave Postgres/MinIO running for
 * post-mortem inspection (e.g. `psql`, the MinIO console at :9101).
 */
import { COMPOSE_FILE, COMPOSE_PROJECT } from './helpers/env';
import { run } from './helpers/exec';
import { stopTracker } from './helpers/tracker';

export default async function globalTeardown(): Promise<void> {
  await stopTracker();

  if (process.env.E2E_KEEP_STACK === '1' || process.env.E2E_SKIP_DOCKER === '1') {
    console.log('[e2e] leaving docker stack up (E2E_KEEP_STACK/E2E_SKIP_DOCKER).');
    return;
  }
  await run('docker', [
    'compose',
    '-p',
    COMPOSE_PROJECT,
    '-f',
    COMPOSE_FILE,
    'down',
    '-v',
  ]).catch((err) => console.error('[e2e] docker down failed', err));
}

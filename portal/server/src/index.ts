import { serve } from '@hono/node-server';
import { app } from './api/index';
import { config } from './config';
import { runMigrations } from './db/migrate';
import { startPolling } from './ingestor';
import { startPurgeScheduler } from './purge';

/**
 * Portal entrypoint: apply migrations (best-effort — the API still comes up so
 * probes are reachable if the DB is briefly unavailable), serve the HTTP API,
 * then start the singleton ingestor loop and the retention auto-purge task.
 */
async function main(): Promise<void> {
  try {
    await runMigrations();
    console.log('[portal] migrations applied');
  } catch (err) {
    console.error(
      '[portal] migrations failed — the ingestor will keep retrying. ' +
        'Run `pnpm db:migrate` once the database is reachable.',
      err,
    );
  }

  serve({ fetch: app.fetch, port: config.port });
  console.log(`[portal] API listening on http://0.0.0.0:${config.port}`);

  startPolling();
  startPurgeScheduler();
}

main().catch((err) => {
  console.error('[portal] fatal startup error', err);
  process.exit(1);
});

/**
 * Shared Postgres connection pool + Drizzle client used by the ingestor, the
 * purge task, and the REST API. Lazily connects on first query, so importing
 * this module never blocks startup or a `--noEmit` typecheck.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export const pool = new Pool({ connectionString: config.databaseUrl });

// An idle client emitting an error (e.g. the DB dropped the connection) would
// otherwise surface as an unhandled 'error' event and crash the process. Log it
// and let pg reap the client; the next query lazily reconnects.
pool.on('error', (err) => {
  console.error('pg pool error', err);
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;

/**
 * Path B — the Worker "new mail" nudge gate (`POST /api/signal`). Exercised
 * DB-free via Hono `app.request()`, toggling `config.signalKey` (read at request
 * time). Asserts the SIGNAL_KEY gate AND that it is independent of the global
 * API_KEYS gate. The success code varies with the ingest debounce, so allowed
 * cases assert `status` is neither 401 nor 404 — the point is the gate.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/api/index';
import { config } from '../src/config';
import { pool } from '../src/db/client';

const originalSignal = config.signalKey;
const originalApiKeys = [...config.apiKeys];
const KEY = 'signal-secret-key';

function probe(headers?: Record<string, string>) {
  return app.request('/api/signal', { method: 'POST', headers });
}

afterEach(() => {
  config.signalKey = originalSignal;
  config.apiKeys = [...originalApiKeys];
});

afterAll(async () => {
  // An allowed probe may fire a backgrounded ingest pass that opens a pool
  // client; close it so the run exits cleanly.
  await pool.end().catch(() => {});
});

describe('signal gate — SIGNAL_KEY unset (feature off)', () => {
  it('hides the endpoint (404) even with a header present', async () => {
    config.signalKey = '';
    expect((await probe({ 'X-Signal-Key': KEY })).status).toBe(404);
  });
});

describe('signal gate — SIGNAL_KEY set', () => {
  it('401s when no key is presented', async () => {
    config.signalKey = KEY;
    expect((await probe()).status).toBe(401);
  });

  it('401s on a wrong key', async () => {
    config.signalKey = KEY;
    expect((await probe({ 'X-Signal-Key': 'wrong' })).status).toBe(401);
  });

  it('accepts the correct key (neither 401 nor 404)', async () => {
    config.signalKey = KEY;
    const status = (await probe({ 'X-Signal-Key': KEY })).status;
    expect(status).not.toBe(401);
    expect(status).not.toBe(404);
  });

  it('stays reachable when the global API_KEYS gate is enabled (independent gate)', async () => {
    config.signalKey = KEY;
    config.apiKeys = ['some-other-api-key'];
    const status = (await probe({ 'X-Signal-Key': KEY })).status;
    expect(status).not.toBe(401);
    expect(status).not.toBe(404);
  });
});

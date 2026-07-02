/**
 * Optional API-key gate (feature C). Exercised DB-free via Hono `app.request()`,
 * toggling `config.apiKeys` between cases (the middleware reads it at request
 * time). The probe is `POST /api/ingest/run` — it returns synchronously and its
 * request path touches no DB/R2 — and we assert `status !== 401` for allowed
 * cases (the exact success code varies with the ingest debounce/limiter, which
 * is irrelevant here). The point under test is the gate, not the handler.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/api/index';
import { config } from '../src/config';
import { pool } from '../src/db/client';

const original = [...config.apiKeys];
const KEY = 'a1b2c3-secret-key';

// A non-Bearer Authorization header ("user:pass" base64) used to prove it never
// short-circuits the X-API-Key path.
const BASIC = 'Basic dXNlcjpwYXNz';

function probe(headers?: Record<string, string>) {
  return app.request('/api/ingest/run', { method: 'POST', headers });
}

afterEach(() => {
  config.apiKeys = [...original];
});

afterAll(async () => {
  // A backgrounded ingest pass (fired by the allowed probes) may have opened a
  // pool client; close it so the test run exits cleanly.
  await pool.end().catch(() => {});
});

describe('API-key gate — disabled (no keys configured)', () => {
  it('passes /api/* through untouched', async () => {
    config.apiKeys = [];
    expect((await probe()).status).not.toBe(401);
  });
});

describe('API-key gate — enabled', () => {
  it('401s when no key is presented', async () => {
    config.apiKeys = [KEY];
    const res = await probe();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'unauthorized',
      message: 'invalid or missing API key',
    });
  });

  it('401s on a wrong key', async () => {
    config.apiKeys = [KEY];
    expect((await probe({ 'X-API-Key': 'wrong' })).status).toBe(401);
  });

  it('401s on an empty or whitespace-only key', async () => {
    config.apiKeys = [KEY];
    expect((await probe({ 'X-API-Key': '' })).status).toBe(401);
    expect((await probe({ 'X-API-Key': '   ' })).status).toBe(401);
  });

  it('accepts a valid key via X-API-Key', async () => {
    config.apiKeys = [KEY];
    expect((await probe({ 'X-API-Key': KEY })).status).not.toBe(401);
  });

  it('accepts a valid key via Authorization: Bearer (scheme case-insensitive)', async () => {
    config.apiKeys = [KEY];
    expect((await probe({ Authorization: `Bearer ${KEY}` })).status).not.toBe(401);
    expect((await probe({ Authorization: `bearer ${KEY}` })).status).not.toBe(401);
  });

  it('does not let a non-Bearer Authorization short-circuit a valid X-API-Key', async () => {
    config.apiKeys = [KEY];
    expect((await probe({ Authorization: BASIC, 'X-API-Key': KEY })).status).not.toBe(401);
  });

  it('401s on a non-Bearer Authorization with no X-API-Key', async () => {
    config.apiKeys = [KEY];
    expect((await probe({ Authorization: BASIC })).status).toBe(401);
  });

  it('accepts any one of several configured keys', async () => {
    config.apiKeys = ['other-key', KEY];
    expect((await probe({ 'X-API-Key': KEY })).status).not.toBe(401);
  });

  it('leaves /healthz open even with keys configured', async () => {
    config.apiKeys = [KEY];
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

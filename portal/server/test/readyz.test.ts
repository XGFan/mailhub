/**
 * Readiness semantics (`GET /readyz`). The contract: readiness reflects whether
 * this pod can serve traffic, which is DB reachability. R2 is an at-least-once
 * buffer the ingestor tolerates being briefly down, so its status is reported for
 * observability but is NEVER fatal — a transient R2/network blip must not eject
 * the pod from the Service's endpoints. Exercised DB/R2-free via `app.request()`,
 * spying on the concrete `db`/`r2` objects (same references the handler calls).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/api/index';
import { db } from '../src/db/client';
import * as r2 from '../src/r2';

afterEach(() => {
  vi.restoreAllMocks();
});

function readyz() {
  return app.request('/readyz');
}

describe('GET /readyz — readiness gates on DB only', () => {
  it('200 when DB and R2 are both up', async () => {
    vi.spyOn(db, 'execute').mockResolvedValue(undefined as never);
    vi.spyOn(r2, 'headBucket').mockResolvedValue(undefined);
    const res = await readyz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { db: true, r2: true } });
  });

  it('stays 200 when R2 is down (R2 is non-fatal, only reported)', async () => {
    vi.spyOn(db, 'execute').mockResolvedValue(undefined as never);
    vi.spyOn(r2, 'headBucket').mockRejectedValue(new Error('r2 unreachable'));
    const res = await readyz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { db: true, r2: false } });
  });

  it('503 when DB is down, regardless of R2', async () => {
    vi.spyOn(db, 'execute').mockRejectedValue(new Error('db unreachable'));
    vi.spyOn(r2, 'headBucket').mockResolvedValue(undefined);
    const res = await readyz();
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });
});

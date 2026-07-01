/**
 * High-level helpers the specs use to drive the portal end-to-end: seed a mail
 * through the REAL pipeline (R2 PUT → POST /api/ingest/run → poll the API until
 * it appears), read tracker hits, and toggle portal settings. Everything goes
 * through the same HTTP surface the browser uses, so seeding exercises the whole
 * backend, not a shortcut.
 */
import type { MailListItem, SearchResponse } from '../types';
import { PORTAL_BASE_URL, TRACKER_ORIGIN } from './env';
import { makeSampleEml, type EmlOptions } from '../fixtures/make-eml';
import { putInboxObject } from './s3';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST /api/ingest/run — kick an immediate ingest pass (AC14). */
export async function runIngest(): Promise<void> {
  await fetch(`${PORTAL_BASE_URL}/api/ingest/run`, { method: 'POST' });
}

/** GET /api/mails with arbitrary query params. */
export async function searchMails(qs: Record<string, string>): Promise<SearchResponse> {
  const params = new URLSearchParams(qs);
  const res = await fetch(`${PORTAL_BASE_URL}/api/mails?${params}`);
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return (await res.json()) as SearchResponse;
}

/**
 * Poll GET /api/mails (searching by the unique token) until the seeded mail is
 * visible, or throw after `timeoutMs`. Repeatedly nudges the ingestor so we do
 * not have to wait for the auto-poll cycle.
 */
export async function waitForMailByToken(
  token: string,
  timeoutMs = 20_000,
): Promise<MailListItem> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    await runIngest();
    try {
      const res = await searchMails({ q: token, field: 'all', includeSpam: 'true' });
      const hit = res.items.find((m) => m.subject.includes(token));
      if (hit) return hit;
      lastErr = `no match yet (total=${res.total})`;
    } catch (err) {
      lastErr = String(err);
    }
    await sleep(500);
  }
  throw new Error(`waitForMailByToken(${token}) timed out: ${lastErr}`);
}

export interface SeededMail {
  item: MailListItem;
  token: string;
  toAddr: string;
  fromAddr: string;
  subjectDecoded: string;
  r2Key: string;
}

/**
 * Seed one mail through the full pipeline and return once the API can see it.
 * `token` defaults to a fresh unique value; addresses embed it so searches are
 * unambiguous even when multiple mails are present.
 */
export async function seedMail(
  overrides: Partial<EmlOptions> & { trackerPixelUrl?: string } = {},
): Promise<SeededMail> {
  const token = overrides.token ?? `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const toAddr = overrides.toAddr ?? `recipient-${token}@mailhub.test`;
  const fromAddr = overrides.fromAddr ?? `sender-${token}@example.com`;
  const opts: EmlOptions = {
    fromName: 'Ada Lovelace',
    subjectText: 'Weekly report',
    ...overrides,
    token,
    toAddr,
    fromAddr,
  };
  const built = makeSampleEml(opts);
  const r2Key = await putInboxObject(built.raw, { to: toAddr, from: fromAddr });
  const item = await waitForMailByToken(token);
  return { item, token, toAddr, fromAddr, subjectDecoded: built.subjectDecoded, r2Key };
}

/** Tracker: reset recorded hits to zero. */
export async function resetTracker(): Promise<void> {
  await fetch(`${TRACKER_ORIGIN}/__reset`);
}

/** Tracker: current recorded content hits (excludes the control endpoints). */
export async function trackerHits(): Promise<{ total: number; hits: { path: string }[] }> {
  const res = await fetch(`${TRACKER_ORIGIN}/__hits`);
  return (await res.json()) as { total: number; hits: { path: string }[] };
}

/** Set the portal-wide "show remote images" setting via the API. */
export async function setShowRemoteImages(value: boolean): Promise<void> {
  await fetch(`${PORTAL_BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ showRemoteImages: value }),
  });
}

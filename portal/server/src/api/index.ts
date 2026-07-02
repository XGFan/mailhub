/**
 * Portal REST API (plan §5.3). Same-origin only (no CORS); every response
 * carries the hardening headers. Search is validated + parameterized + rate
 * limited; attachment/raw downloads are forced (never inline, nosniff). In
 * production the built SPA is served from portal/web/dist with a guard so dev
 * (no dist) doesn't crash.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type {
  BlockRule,
  BlockRulesResponse,
  BlockRuleType,
  FavoriteResponse,
  MailDetail,
  MailListItem,
  PortalSettings,
} from '@mailhub/shared';
import { count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { config } from '../config';
import { db, pool } from '../db/client';
import { attachments, blockRules, mails, settings } from '../db/schema';
import { isValidBlockValue, normalizeBlockValue } from '../ingest-helpers';
import { isIngestRunning, runIngestPass } from '../ingestor';
import { headBucket } from '../r2';
import {
  buildOrderBy,
  buildWhereClause,
  normalizeSearchParams,
  SearchValidationError,
} from './search';

export const app = new Hono();

// ---------------------------------------------------------------------------
// Security headers — applied to every response (same-origin, no CORS).
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  await next();
  // NB: the reading-pane iframe uses `srcdoc`, and per the CSP spec a srcdoc
  // document INHERITS its parent's policy (intersected with its own <meta> CSP).
  // So this header must be permissive enough for `img-src` (inline `data:` cid
  // images + opt-in remote images) and `style-src` (the iframe's inline
  // reading-pane CSS) — otherwise `default-src 'self'` would block them and the
  // iframe's meta CSP could never act as the gate. The per-mail remote-image
  // gating still happens in that meta CSP (default `img-src data:` blocks remote
  // by intersection); scripts remain locked to `default-src 'self'` (no inline /
  // remote JS), so XSS defense is unchanged. The parent app only ever renders
  // first-party images itself; untrusted mail is confined to the sandboxed iframe.
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

// ---------------------------------------------------------------------------
// Optional API-key gate — guards `/api/*` only (never /healthz, /readyz, or the
// static SPA below). Backward compatible: with no keys configured the gate is a
// no-op and behavior is identical to the no-auth default. `config.apiKeys` is
// read at request time (not captured at registration) so tests can toggle it.
// ---------------------------------------------------------------------------

/**
 * Extract a presented key: prefer `X-API-Key`; otherwise consult `Authorization`
 * ONLY when its scheme is exactly `Bearer` (case-insensitive, single space). A
 * present non-Bearer `Authorization` (e.g. `Basic …`) must not short-circuit —
 * it yields no key so the X-API-Key path stays authoritative. Empty/whitespace
 * presented keys are rejected (treated as absent).
 */
function extractApiKey(c: { req: { header: (n: string) => string | undefined } }): string | null {
  const headerKey = c.req.header('x-api-key');
  if (headerKey !== undefined) {
    const trimmed = headerKey.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const auth = c.req.header('authorization');
  if (auth !== undefined) {
    const match = /^Bearer (.+)$/i.exec(auth);
    if (match) {
      const trimmed = match[1].trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

/** Constant-time membership test of `candidate` against the configured keys. */
function isValidApiKey(candidate: string, keys: readonly string[]): boolean {
  // sha256 first so every comparison is over fixed 32-byte buffers (timingSafe
  // won't throw on length mismatch, and length itself doesn't leak). Iterate all
  // keys without early-return to keep the work uniform.
  const candidateHash = createHash('sha256').update(candidate).digest();
  let valid = false;
  for (const key of keys) {
    const keyHash = createHash('sha256').update(key).digest();
    if (timingSafeEqual(candidateHash, keyHash)) valid = true;
  }
  return valid;
}

app.use('/api/*', async (c, next) => {
  const keys = config.apiKeys;
  if (keys.length === 0) return next();
  const candidate = extractApiKey(c);
  if (candidate && isValidApiKey(candidate, keys)) return next();
  return c.json({ error: 'unauthorized', message: 'invalid or missing API key' }, 401);
});

// ---------------------------------------------------------------------------
// In-memory token-bucket rate limiting (single-user; keyed by client hint).
// ---------------------------------------------------------------------------
function createRateLimiter(capacity: number, refillPerSec: number) {
  const buckets = new Map<string, { tokens: number; last: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, last: now };
      buckets.set(key, b);
    }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

const searchLimiter = createRateLimiter(30, 10);
const ingestLimiter = createRateLimiter(3, 0.2);
// Star toggles + deletes are single-user actions; keep a generous bucket.
const mutationLimiter = createRateLimiter(30, 10);

function clientKey(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

// ---------------------------------------------------------------------------
// Probes.
// ---------------------------------------------------------------------------
app.get('/healthz', (c) => c.json({ ok: true }));

app.get('/readyz', async (c) => {
  const checks: Record<string, boolean> = {};
  try {
    await db.execute(sql`select 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }
  try {
    await headBucket();
    checks.r2 = true;
  } catch {
    checks.r2 = false;
  }
  const ok = checks.db && checks.r2;
  return c.json({ ok, checks }, ok ? 200 : 503);
});

// ---------------------------------------------------------------------------
// Row -> API mappers (shared @mailhub types are the contract).
// ---------------------------------------------------------------------------
const LIST_COLUMNS = {
  id: mails.id,
  fromAddr: mails.fromAddr,
  fromName: mails.fromName,
  toAddr: mails.toAddr,
  subject: mails.subject,
  snippet: mails.snippet,
  date: mails.date,
  receivedAt: mails.receivedAt,
  hasAttachments: mails.hasAttachments,
  isSpam: mails.isSpam,
  isFavorite: mails.isFavorite,
};

type ListRow = {
  id: string;
  fromAddr: string | null;
  fromName: string | null;
  toAddr: string | null;
  subject: string | null;
  snippet: string | null;
  date: Date | null;
  receivedAt: Date;
  hasAttachments: boolean;
  isSpam: boolean;
  isFavorite: boolean;
};

function toListItem(r: ListRow): MailListItem {
  return {
    id: r.id,
    fromAddr: r.fromAddr ?? '',
    fromName: r.fromName ?? undefined,
    toAddr: r.toAddr ?? '',
    subject: r.subject ?? '',
    snippet: r.snippet ?? '',
    date: r.date ? r.date.toISOString() : null,
    receivedAt: r.receivedAt.toISOString(),
    hasAttachments: r.hasAttachments,
    isSpam: r.isSpam,
    isFavorite: r.isFavorite,
  };
}

// ---------------------------------------------------------------------------
// GET /api/mails — validated, parameterized search.
// ---------------------------------------------------------------------------
app.get('/api/mails', async (c) => {
  if (!searchLimiter(clientKey(c))) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  let params;
  try {
    const q = c.req.query();
    params = normalizeSearchParams({
      q: q.q,
      field: q.field,
      sort: q.sort,
      page: q.page,
      pageSize: q.pageSize,
      includeSpam: q.includeSpam,
      favorite: q.favorite,
    });
  } catch (err) {
    if (err instanceof SearchValidationError) {
      return c.json({ error: 'invalid_query', message: err.message }, 400);
    }
    throw err;
  }

  const where = buildWhereClause(params);
  const offset = (params.page - 1) * params.pageSize;

  const items = await db
    .select(LIST_COLUMNS)
    .from(mails)
    .where(where)
    .orderBy(...buildOrderBy(params.sort))
    .limit(params.pageSize)
    .offset(offset);

  const [{ total }] = await db.select({ total: count() }).from(mails).where(where);

  return c.json({
    items: items.map(toListItem),
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
});

// ---------------------------------------------------------------------------
// GET /api/mails/:id — full detail (sanitized html + attachment metadata).
// ---------------------------------------------------------------------------
app.get('/api/mails/:id', async (c) => {
  const id = c.req.param('id');
  const rows = await db.select().from(mails).where(eq(mails.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
  const m = rows[0];

  const atts = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      isInline: attachments.isInline,
    })
    .from(attachments)
    .where(eq(attachments.mailId, id));

  // Surface the envelope sender only when it differs from the header From, and
  // Reply-To only when present and distinct from From — the reader shouldn't be
  // shown redundant copies of the same address. Compare case-insensitively so a
  // mere domain/case difference isn't treated as a distinct address.
  const sameAsFrom = (addr: string | null) =>
    !!addr && !!m.fromAddr && addr.toLowerCase() === m.fromAddr.toLowerCase();
  const envelopeFrom = m.envelopeFrom && !sameAsFrom(m.envelopeFrom) ? m.envelopeFrom : undefined;
  const replyToAddr = m.replyToAddr && !sameAsFrom(m.replyToAddr) ? m.replyToAddr : undefined;

  const detail: MailDetail = {
    ...toListItem(m),
    htmlSanitized: m.htmlSanitized ?? null,
    textBody: m.textBody ?? null,
    authResults: m.authResults ?? undefined,
    envelopeFrom,
    replyToAddr,
    replyToName: replyToAddr ? (m.replyToName ?? undefined) : undefined,
    attachments: atts.map((a) => ({
      id: a.id,
      filename: a.filename ?? '',
      mimeType: a.mimeType ?? 'application/octet-stream',
      sizeBytes: a.sizeBytes ?? 0,
      isInline: a.isInline,
    })),
  };
  return c.json(detail);
});

// ---------------------------------------------------------------------------
// Forced-download helpers (never inline — sec-H3).
// ---------------------------------------------------------------------------
function sanitizeHeaderFilename(name: string): string {
  // Strip CR/LF and other control chars to prevent header injection.
  return name.replace(/[\r\n\t\x00-\x1f\x7f]/g, '').trim() || 'download';
}

async function streamDownload(
  filePath: string,
  downloadName: string,
): Promise<Response> {
  let size: number;
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return new Response('not found', { status: 404 });
    size = st.size;
  } catch {
    return new Response('not found', { status: 404 });
  }
  const clean = sanitizeHeaderFilename(downloadName);
  const asciiFallback = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const webStream = Readable.toWeb(
    (await import('node:fs')).createReadStream(filePath),
  ) as unknown as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(clean)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// GET /api/mails/:id/raw — download the archived raw .eml.
app.get('/api/mails/:id/raw', async (c) => {
  const id = c.req.param('id');
  const rows = await db
    .select({ rawPath: mails.rawPath })
    .from(mails)
    .where(eq(mails.id, id))
    .limit(1);
  if (rows.length === 0 || !rows[0].rawPath) return c.json({ error: 'not_found' }, 404);
  return streamDownload(rows[0].rawPath, `mail-${id}.eml`);
});

// GET /api/attachments/:id — forced download (never inline, nosniff).
app.get('/api/attachments/:id', async (c) => {
  const id = c.req.param('id');
  const rows = await db
    .select({ storagePath: attachments.storagePath, filename: attachments.filename })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
  return streamDownload(rows[0].storagePath, rows[0].filename ?? `attachment-${id}`);
});

// ---------------------------------------------------------------------------
// PUT /api/mails/:id/favorite — star / unstar. Starred mail is exempt from the
// retention auto-purge (see purge.ts), so it survives past RETENTION_DAYS.
// ---------------------------------------------------------------------------
app.put('/api/mails/:id/favorite', async (c) => {
  if (!mutationLimiter(clientKey(c))) return c.json({ error: 'rate_limited' }, 429);
  const id = c.req.param('id');

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { favorite?: unknown }).favorite !== 'boolean'
  ) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const favorite = (payload as { favorite: boolean }).favorite;

  const updated = await db
    .update(mails)
    .set({ isFavorite: favorite })
    .where(eq(mails.id, id))
    .returning({ id: mails.id, isFavorite: mails.isFavorite });
  if (updated.length === 0) return c.json({ error: 'not_found' }, 404);

  const body: FavoriteResponse = { id: updated[0].id, isFavorite: updated[0].isFavorite };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// DELETE /api/mails/:id — hard delete: remove the row (attachments cascade via
// the FK) plus the attachment files and the archived raw .eml from the PVC.
// ---------------------------------------------------------------------------
app.delete('/api/mails/:id', async (c) => {
  if (!mutationLimiter(clientKey(c))) return c.json({ error: 'rate_limited' }, 429);
  const id = c.req.param('id');

  // Gather on-disk paths BEFORE deleting the row (the delete cascades attachments).
  const rows = await db
    .select({ rawPath: mails.rawPath })
    .from(mails)
    .where(eq(mails.id, id))
    .limit(1);
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);

  const atts = await db
    .select({ storagePath: attachments.storagePath })
    .from(attachments)
    .where(eq(attachments.mailId, id));

  await db.delete(mails).where(eq(mails.id, id));

  // Best-effort file cleanup — a missing file must never fail the delete.
  for (const p of [rows[0].rawPath, ...atts.map((a) => a.storagePath)]) {
    if (!p) continue;
    try {
      await unlink(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[delete] failed to unlink ${p}`, err);
      }
    }
  }

  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// POST /api/ingest/run — debounced manual "Fetch now" (AC14).
// ---------------------------------------------------------------------------
app.post('/api/ingest/run', (c) => {
  if (!ingestLimiter(clientKey(c))) {
    return c.json({ started: false, alreadyRunning: isIngestRunning() }, 429);
  }
  if (isIngestRunning()) {
    return c.json({ started: false, alreadyRunning: true });
  }
  void runIngestPass().catch((err) => console.error('[ingest] manual run failed', err));
  return c.json({ started: true, alreadyRunning: false });
});

// ---------------------------------------------------------------------------
// GET/PUT /api/settings — PortalSettings (showRemoteImages), single row.
// ---------------------------------------------------------------------------
app.get('/api/settings', async (c) => {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const body: PortalSettings = {
    showRemoteImages: rows[0]?.showRemoteImages ?? false,
  };
  return c.json(body);
});

app.put('/api/settings', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { showRemoteImages?: unknown }).showRemoteImages !== 'boolean'
  ) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const showRemoteImages = (payload as PortalSettings).showRemoteImages;
  await db
    .insert(settings)
    .values({ id: 1, showRemoteImages })
    .onConflictDoUpdate({ target: settings.id, set: { showRemoteImages } });
  const body: PortalSettings = { showRemoteImages };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Block (拒收) rules — CRUD over the block_rules table. Matching mail is dropped
// at ingest time (ingestor.ts); adding a rule never retroactively deletes mail.
// ---------------------------------------------------------------------------
type BlockRuleRow = { id: string; ruleType: string; value: string; createdAt: Date };

function toBlockRule(r: BlockRuleRow): BlockRule {
  return {
    id: r.id,
    ruleType: r.ruleType as BlockRuleType,
    value: r.value,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Postgres unique-violation (SQLSTATE 23505), possibly wrapped by drizzle. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === '23505' || e.cause?.code === '23505';
}

app.get('/api/block-rules', async (c) => {
  const rows = await db.select().from(blockRules).orderBy(desc(blockRules.createdAt));
  const body: BlockRulesResponse = { rules: rows.map(toBlockRule) };
  return c.json(body);
});

app.post('/api/block-rules', async (c) => {
  if (!mutationLimiter(clientKey(c))) return c.json({ error: 'rate_limited' }, 429);

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof payload !== 'object' || payload === null) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const { ruleType, value } = payload as { ruleType?: unknown; value?: unknown };
  if ((ruleType !== 'address' && ruleType !== 'domain') || typeof value !== 'string') {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const normalized = normalizeBlockValue(value);
  if (!isValidBlockValue(ruleType, normalized)) {
    return c.json({ error: 'invalid_body', message: 'invalid rule value' }, 400);
  }

  try {
    const inserted = await db
      .insert(blockRules)
      .values({ ruleType, value: normalized })
      .returning();
    return c.json(toBlockRule(inserted[0]), 201);
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: 'duplicate_rule' }, 409);
    throw err;
  }
});

app.delete('/api/block-rules/:id', async (c) => {
  if (!mutationLimiter(clientKey(c))) return c.json({ error: 'rate_limited' }, 429);
  const id = c.req.param('id');
  const deleted = await db
    .delete(blockRules)
    .where(eq(blockRules.id, id))
    .returning({ id: blockRules.id });
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Static SPA (production only) — guarded so dev without a build doesn't crash.
// ---------------------------------------------------------------------------
const DIST_DIR = fileURLToPath(new URL('../../../web/dist', import.meta.url));
const DIST_EXISTS = existsSync(path.join(DIST_DIR, 'index.html'));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (DIST_EXISTS) {
  app.get('*', async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith('/api/') || pathname === '/healthz' || pathname === '/readyz') {
      return next();
    }
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    let filePath = path.resolve(DIST_DIR, `.${rel}`);
    // Contain traversal: only serve inside DIST_DIR, else fall back to the SPA.
    if (
      (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) ||
      !existsSync(filePath) ||
      statSync(filePath).isDirectory()
    ) {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return c.body(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength), 200, {
      'Content-Type': type,
    });
  });
}

// Ensure the pool is referenced for lifecycle tooling / graceful shutdown.
export { pool };

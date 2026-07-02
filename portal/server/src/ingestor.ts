/**
 * Singleton ingestor (plan §5.3). Each pass: paginated LIST of `inbox/`, then
 * per object — dedupe on r2_key, enforce the size cap, parse in an isolated
 * worker, write attachment bytes + raw .eml under ATTACHMENT_DIR, sanitize the
 * HTML, and INSERT ... ON CONFLICT (r2_key) DO NOTHING (AC8/C1). On a successful
 * commit the object is deleted; a parse/size failure moves it to `dead/` so it
 * can't poison the loop (H4). `startPolling` schedules passes with exponential
 * backoff + jitter on consecutive infra errors (M10) and never throws.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from './config';
import { db } from './db/client';
import { attachments, mails } from './db/schema';
import {
  buildCidMap,
  buildSnippet,
  isInlineAttachment,
  isSpamFromAuthResults,
  receivedAtFromKey,
  resolveAttachmentPath,
  resolveRawPath,
} from './ingest-helpers';
import { parseInIsolation } from './parse-isolation';
import { copyToDead, deleteObject, getObject, listInbox, type InboxObject } from './r2';
import { sanitizeMailHtml } from './sanitize';

/** Hard cap on how long a single message may parse before we give up (sec-M2). */
const PARSE_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const INITIAL_PASS_DELAY_MS = 2_000;

let isRunning = false;

/** Is an ingest pass currently in flight? (debounce for the manual trigger.) */
export function isIngestRunning(): boolean {
  return isRunning;
}

/** Result of one ingest pass. */
export interface IngestPassResult {
  processed: number;
}

/**
 * Run one ingest pass over the whole inbox backlog. Debounced: if a pass is
 * already running this returns immediately with processed=0. Per-object errors
 * are contained (routed to dead/) so one bad message can't abort the pass.
 * Throws only on LIST-level infra failures, which the poller backs off on.
 */
export async function runIngestPass(): Promise<IngestPassResult> {
  if (isRunning) return { processed: 0 };
  isRunning = true;
  let processed = 0;
  try {
    const objects = await listInbox();
    for (const obj of objects) {
      try {
        if (await processObject(obj)) processed++;
      } catch (err) {
        console.error(`[ingest] object failed, moving to dead/: ${obj.key}`, err);
        try {
          await copyToDead(obj.key);
        } catch (deadErr) {
          console.error(`[ingest] dead-letter move failed: ${obj.key}`, deadErr);
        }
      }
    }
  } finally {
    isRunning = false;
  }
  return { processed };
}

/** Process one inbox object. Returns true if a new mail row was inserted. */
async function processObject(obj: InboxObject): Promise<boolean> {
  // 1. Idempotency: if this r2_key is already stored, just clean up the object.
  const existing = await db
    .select({ id: mails.id })
    .from(mails)
    .where(eq(mails.r2Key, obj.key))
    .limit(1);
  if (existing.length > 0) {
    await deleteObject(obj.key);
    return false;
  }

  // 2. Size cap (from the listing) — reject oversized without downloading.
  if (obj.size > config.maxMailBytes) {
    await copyToDead(obj.key);
    return false;
  }

  // 3. Fetch bytes + envelope metadata (authoritative to/from).
  const { body, metadata } = await getObject(obj.key);
  if (body.length > config.maxMailBytes) {
    await copyToDead(obj.key);
    return false;
  }

  // 4. Parse in isolation (timeout-bounded).
  const parsed = await parseInIsolation(body, PARSE_TIMEOUT_MS);

  // 5. Derive fields. The envelope recipient (metadata.to) is authoritative for
  //    display/search (a catch-all's delivered-to may differ from the header To).
  //    For the SENDER we prefer the header `From:` — the human-meaningful address
  //    (name + mailbox) — because the envelope sender (metadata.from) is often an
  //    opaque bounce / return-path address (e.g. an SES `MAIL FROM`). The envelope
  //    sender is kept separately for provenance and surfaced only when it differs.
  const toAddr = metadata.to ?? null;
  const fromAddr = parsed.fromAddr ?? metadata.from ?? null;
  const envelopeFrom = metadata.from ?? null;
  const receivedAt = receivedAtFromKey(obj.key);
  const isSpam = isSpamFromAuthResults(parsed.authResultsHeader);
  const snippet = buildSnippet(parsed.textBody, parsed.htmlRaw);
  const hasAttachments = parsed.attachments.some((a) => !isInlineAttachment(a));
  const cidMap = buildCidMap(parsed.attachments);
  const htmlSanitized = parsed.htmlRaw ? sanitizeMailHtml(parsed.htmlRaw, cidMap) : null;

  // 6. Insert the mail row, gated on r2_key. If another pass won the race the
  //    conflict returns no rows and we just delete the object.
  const inserted = await db
    .insert(mails)
    .values({
      r2Key: obj.key,
      messageId: parsed.messageId,
      toAddr,
      fromAddr,
      fromName: parsed.fromName,
      envelopeFrom,
      replyToAddr: parsed.replyToAddr,
      replyToName: parsed.replyToName,
      subject: parsed.subject,
      date: parsed.date ? new Date(parsed.date) : null,
      receivedAt,
      textBody: parsed.textBody,
      htmlSanitized,
      snippet,
      sizeBytes: body.length,
      hasAttachments,
      isSpam,
      authResults: parsed.authResultsHeader,
    })
    .onConflictDoNothing({ target: mails.r2Key })
    .returning({ id: mails.id });

  if (inserted.length === 0) {
    await deleteObject(obj.key);
    return false;
  }
  const mailId = inserted[0].id;

  // 7. Persist attachment bytes (UUID paths under ATTACHMENT_DIR) + raw .eml,
  //    then record attachment rows.
  await mkdir(path.resolve(config.attachmentDir), { recursive: true });
  // rawPath is keyed by the freshly-minted mailId, so it is always unique.
  const rawPath = resolveRawPath(config.attachmentDir, mailId);
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, body);
  await db.update(mails).set({ rawPath }).where(eq(mails.id, mailId));

  for (const att of parsed.attachments) {
    const storagePath = resolveAttachmentPath(config.attachmentDir);
    await writeFile(storagePath, att.content, { flag: 'wx' });
    await db.insert(attachments).values({
      mailId,
      filename: att.filename,
      mimeType: att.mimeType,
      sizeBytes: att.content.length,
      storagePath,
      contentId: att.contentId,
      isInline: isInlineAttachment(att),
    });
  }

  // 8. Commit is durable — remove the object (AC3).
  await deleteObject(obj.key);
  return true;
}

let backoffTimer: NodeJS.Timeout | null = null;
let consecutiveErrors = 0;

/** Backoff delay: pollInterval * 2^errors, capped, plus up to 1s jitter. */
function nextDelay(): number {
  if (consecutiveErrors === 0) return config.pollIntervalMs;
  const exp = config.pollIntervalMs * 2 ** Math.min(consecutiveErrors, 8);
  return Math.min(exp, MAX_BACKOFF_MS) + Math.floor(Math.random() * 1000);
}

/**
 * Start the polling loop. Uses a self-rescheduling timer (not setInterval) so a
 * slow pass can't overlap itself and so backoff is per-cycle. Never throws.
 */
export function startPolling(): void {
  const tick = async () => {
    try {
      await runIngestPass();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`[ingest] pass error #${consecutiveErrors}`, err);
    } finally {
      backoffTimer = setTimeout(tick, nextDelay());
    }
  };
  backoffTimer = setTimeout(tick, INITIAL_PASS_DELAY_MS);
}

/** Stop the polling loop (tests / graceful shutdown). */
export function stopPolling(): void {
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

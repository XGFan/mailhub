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
import { attachments, blockRules, mails } from './db/schema';
import {
  type BlockRuleMatch,
  buildCidMap,
  buildSnippet,
  isBlocked,
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

/**
 * Healthy-path poll cadence is adaptive: right after activity re-check quickly,
 * then climb these warm-up rungs (ms) before settling at the configured idle
 * ceiling (`POLL_INTERVAL_MS`). Each rung is clamped to the ceiling, so a small
 * ceiling (e.g. e2e's 3s) flattens the ladder. Mail arriving during deep idle
 * waits at most one ceiling interval — the accepted poll-vs-push trade-off.
 */
const IDLE_WARMUP_MS = [5_000, 10_000, 30_000];

/**
 * Base for infra-error backoff, kept independent of the idle ceiling so raising
 * the ceiling never slows recovery from a transient LIST failure.
 */
const ERROR_BACKOFF_BASE_MS = 30_000;

let isRunning = false;
/**
 * Consecutive empty passes; drives the healthy-path backoff ladder. Reset to 0
 * by any pass (poll, manual, or Worker signal) that sees a non-empty inbox.
 */
let idleStreak = 0;

/** Is an ingest pass currently in flight? (debounce for the manual trigger.) */
export function isIngestRunning(): boolean {
  return isRunning;
}

/** Result of one ingest pass. */
export interface IngestPassResult {
  /** New mail rows inserted this pass. */
  processed: number;
  /** Objects seen in the inbox listing this pass (drives the poll cadence). */
  listed: number;
}

/**
 * Run one ingest pass over the whole inbox backlog. Debounced: if a pass is
 * already running this returns immediately with processed=0. Per-object errors
 * are contained (routed to dead/) so one bad message can't abort the pass.
 * Throws only on LIST-level infra failures, which the poller backs off on.
 */
export async function runIngestPass(): Promise<IngestPassResult> {
  if (isRunning) return { processed: 0, listed: 0 };
  isRunning = true;
  let processed = 0;
  let listed = 0;
  try {
    // Load the block rules once per pass (not per object) — the set is small and
    // changes rarely, so a single SELECT amortizes across the whole backlog.
    const rules: BlockRuleMatch[] = await db
      .select({ ruleType: blockRules.ruleType, value: blockRules.value })
      .from(blockRules);
    const objects = await listInbox();
    listed = objects.length;
    for (const obj of objects) {
      try {
        if (await processObject(obj, rules)) processed++;
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
  // Warm the poll cadence while mail is flowing; let it relax toward the idle
  // ceiling when the inbox comes up empty. Every caller (poll / manual "Fetch
  // now" / Worker signal) funnels through here, so the ladder stays coherent.
  idleStreak = listed > 0 ? 0 : idleStreak + 1;
  return { processed, listed };
}

/** Process one inbox object. Returns true if a new mail row was inserted. */
async function processObject(
  obj: InboxObject,
  rules: readonly BlockRuleMatch[],
): Promise<boolean> {
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

  // 5a. Block (拒收) short-circuit: if the sender matches a rule, drop the mail
  //     entirely — no DB row, no attachment/raw files, and NOT moved to dead/
  //     (a blocked sender is not a poison message). The R2 object is deleted so
  //     it isn't reprocessed. Matches on the same address we display (fromAddr).
  if (isBlocked(fromAddr, rules)) {
    console.log(`[ingest] blocked ${obj.key} from ${fromAddr}`);
    await deleteObject(obj.key);
    return false;
  }

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

/**
 * Healthy-path delay for a given idle streak: climb the warm-up rungs, then
 * settle at the ceiling. Pure + exported for tests. Each rung is clamped to the
 * ceiling, so a ceiling below a rung (e.g. e2e's 3s) just flattens the ladder.
 */
export function healthyDelayMs(streak: number, ceilingMs: number): number {
  const rung = streak < IDLE_WARMUP_MS.length ? IDLE_WARMUP_MS[streak] : ceilingMs;
  return Math.min(rung, ceilingMs);
}

/**
 * Next poll delay. Infra errors dominate: exponential backoff from a fixed base
 * (independent of the idle ceiling), capped, with jitter. Otherwise follow the
 * adaptive healthy-path ladder keyed on the current idle streak.
 */
function nextDelay(): number {
  if (consecutiveErrors > 0) {
    const exp = ERROR_BACKOFF_BASE_MS * 2 ** Math.min(consecutiveErrors, 8);
    return Math.min(exp, MAX_BACKOFF_MS) + Math.floor(Math.random() * 1000);
  }
  return healthyDelayMs(idleStreak, config.pollIntervalMs);
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

/**
 * Retention auto-purge (plan §5.3, AC15). Deletes `mails` rows older than
 * RETENTION_DAYS (attachment rows cascade) and unlinks their attachment files +
 * archived raw .eml from the PVC. Runs hourly via an in-process timer — no extra
 * k8s object.
 */
import { unlink } from 'node:fs/promises';
import { and, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { config } from './config';
import { db } from './db/client';
import { attachments, mails } from './db/schema';

const PURGE_INTERVAL_MS = 60 * 60_000;

/**
 * The selector for mail eligible for retention deletion: older than the cutoff
 * AND not starred. Starred mail is retention-exempt. Exported so the exemption
 * is unit-testable via `.toSQL()` without a live database.
 */
export function expiredWhere(cutoff: Date): SQL {
  return and(lt(mails.receivedAt, cutoff), eq(mails.isFavorite, false))!;
}

/** Result of one purge run. */
export interface PurgeResult {
  deletedMails: number;
  deletedFiles: number;
}

async function safeUnlink(p: string | null): Promise<boolean> {
  if (!p) return false;
  try {
    await unlink(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    console.error(`[purge] failed to unlink ${p}`, err);
    return false;
  }
}

/** Delete expired mails + their on-disk files. Returns counts for observability. */
export async function purgeExpired(): Promise<PurgeResult> {
  const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000);

  // Starred mail is retention-exempt: it survives past the cutoff until the user
  // unstars or explicitly deletes it.
  const expired = await db
    .select({ id: mails.id, rawPath: mails.rawPath })
    .from(mails)
    .where(expiredWhere(cutoff));
  if (expired.length === 0) return { deletedMails: 0, deletedFiles: 0 };

  const ids = expired.map((m) => m.id);

  // Gather attachment file paths BEFORE deleting rows (the delete cascades).
  const atts = await db
    .select({ storagePath: attachments.storagePath })
    .from(attachments)
    .where(inArray(attachments.mailId, ids));

  await db.delete(mails).where(inArray(mails.id, ids));

  let deletedFiles = 0;
  for (const a of atts) if (await safeUnlink(a.storagePath)) deletedFiles++;
  for (const m of expired) if (await safeUnlink(m.rawPath)) deletedFiles++;

  console.log(`[purge] removed ${expired.length} mails, ${deletedFiles} files`);
  return { deletedMails: expired.length, deletedFiles };
}

let purgeTimer: NodeJS.Timeout | null = null;

/** Schedule hourly purges (never throws out of the timer). */
export function startPurgeScheduler(): void {
  const run = () => {
    purgeExpired().catch((err) => console.error('[purge] run failed', err));
  };
  purgeTimer = setInterval(run, PURGE_INTERVAL_MS);
}

/** Stop the purge scheduler (tests / graceful shutdown). */
export function stopPurgeScheduler(): void {
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
}

import { toast } from 'sonner';
import type { BlockRuleType } from '@mailhub/shared';
import { ApiError, api } from '@/lib/api';
import { normalizeBlockValue } from '@/lib/block-rules';

/** The mail a block action was launched from (row menu / reading pane). */
export interface BlockSourceMail {
  id: string;
  isFavorite: boolean;
}

/**
 * Create a block rule and toast the outcome. Shared by the mail detail pane and
 * the list-row overflow menu so the success/duplicate copy stays identical.
 *
 * When the block was launched from a mail (`source`), that one message is also
 * deleted — blocking a sender you are looking at should make it disappear, not
 * just gate future mail. Only that message is touched: the rule stays
 * non-retroactive for the rest of the archive. Starred mail is exempt, matching
 * the retention policy that never auto-removes a starred message.
 *
 * Returns whether the source mail was deleted so the caller can resync its UI.
 */
export async function blockAndToast(
  ruleType: BlockRuleType,
  value: string,
  source?: BlockSourceMail,
): Promise<{ deleted: boolean }> {
  const normalized = normalizeBlockValue(value);

  // A duplicate rule is not a failure here: the rule the user asked for is in
  // place, so the source mail should still be removed.
  let duplicate = false;
  try {
    await api.createBlockRule(ruleType, normalized);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      duplicate = true;
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add block rule');
      return { deleted: false };
    }
  }

  let deleted = false;
  if (source && !source.isFavorite) {
    try {
      await api.deleteMail(source.id);
      deleted = true;
    } catch (err) {
      // The rule stuck; only the cleanup failed — report it separately so the
      // block itself is still confirmed below.
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete this message');
    }
  }

  const subject =
    ruleType === 'domain' ? `Blocked domain ${normalized}.` : `Blocked ${normalized}.`;
  let tail = ' Future mail will be dropped.';
  if (deleted) tail = ' This message was deleted; future mail will be dropped.';
  else if (source?.isFavorite) {
    tail = ' Future mail will be dropped — this starred message was kept.';
  }

  if (duplicate) toast.info(`${normalized} is already blocked.${tail}`);
  else toast.success(`${subject}${tail}`);

  return { deleted };
}

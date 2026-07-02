import { toast } from 'sonner';
import type { BlockRuleType } from '@mailhub/shared';
import { ApiError, api } from '@/lib/api';
import { normalizeBlockValue } from '@/lib/block-rules';

/**
 * Create a block rule and toast the outcome. Shared by the mail detail pane and
 * the list-row overflow menu so the success/duplicate copy stays identical.
 * Blocking only affects *future* mail — existing archived mail is untouched.
 */
export async function blockAndToast(ruleType: BlockRuleType, value: string): Promise<void> {
  const normalized = normalizeBlockValue(value);
  try {
    await api.createBlockRule(ruleType, normalized);
    toast.success(
      ruleType === 'domain'
        ? `Blocked domain ${normalized}. Future mail will be dropped.`
        : `Blocked ${normalized}. Future mail will be dropped.`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      toast.info('That block rule already exists');
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add block rule');
    }
  }
}

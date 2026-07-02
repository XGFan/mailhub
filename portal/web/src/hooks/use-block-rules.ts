import { useCallback, useState } from 'react';
import type { BlockRule, BlockRuleType } from '@mailhub/shared';
import { ApiError, api } from '@/lib/api';

export interface BlockRulesState {
  rules: BlockRule[];
  isLoading: boolean;
  /** Load error (e.g. a 401 before an API key is saved), for quiet display. */
  error: string | null;
  /** (Re)load the rule list. Called when the settings dialog opens. */
  refresh: () => Promise<void>;
  /** Create a rule; throws ApiError (409 duplicate / 400 invalid) to the caller. */
  add: (ruleType: BlockRuleType, value: string) => Promise<BlockRule>;
  /** Delete a rule by id; throws ApiError to the caller. */
  remove: (id: string) => Promise<void>;
}

/**
 * Block-rules list state for the settings dialog. Fetching is lazy (via
 * `refresh`) so it runs on dialog open rather than app mount. Mutations update
 * the local list optimistically-in-place on success so the UI stays in sync
 * without a full reload.
 */
export function useBlockRules(): BlockRulesState {
  const [rules, setRules] = useState<BlockRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getBlockRules();
      setRules(res.rules);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load block rules');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const add = useCallback(async (ruleType: BlockRuleType, value: string) => {
    const rule = await api.createBlockRule(ruleType, value);
    setRules((prev) => [rule, ...prev]);
    return rule;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteBlockRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { rules, isLoading, error, refresh, add, remove };
}

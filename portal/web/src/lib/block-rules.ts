import type { BlockRuleType } from '@mailhub/shared';

/**
 * Client-side helpers for block (拒收) rules. These mirror the server's
 * validation/normalization so the settings form can reject obviously-bad input
 * before a round-trip; the server stays authoritative (a 400 still surfaces).
 * Kept dependency-free so it is trivially unit-testable.
 */

/** Lowercase + trim, matching how the server stores rule values. */
export function normalizeBlockValue(value: string): string {
  return value.trim().toLowerCase();
}

/** Only lowercase letters, digits, dots and hyphens are valid domain chars. */
const DOMAIN_CHARS = /^[a-z0-9.-]+$/;

/**
 * Validate a rule value for the given type. Returns a human-readable error
 * message, or `null` when the value looks acceptable.
 */
export function validateBlockValue(ruleType: BlockRuleType, raw: string): string | null {
  const value = normalizeBlockValue(raw);
  if (!value) return 'Enter a value to block';

  if (ruleType === 'address') {
    const at = value.indexOf('@');
    // Exactly one '@', with a non-empty local part and domain part.
    if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) {
      return 'Enter a valid email address';
    }
    return null;
  }

  // domain
  if (value.includes('@')) return 'Enter a bare domain, without “@”';
  if (!value.includes('.')) return 'Enter a valid domain (e.g. example.com)';
  if (!DOMAIN_CHARS.test(value)) return 'Enter a valid domain';
  return null;
}

/** The domain portion of an email address, lowercased, or `null` if malformed. */
export function domainOf(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const at = addr.lastIndexOf('@');
  if (at < 0 || at === addr.length - 1) return null;
  return addr.slice(at + 1).trim().toLowerCase() || null;
}

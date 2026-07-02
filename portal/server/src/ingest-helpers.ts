/**
 * Pure helpers used by the ingestor, factored out so their security-relevant
 * logic (path safety AC11, spam detection, received_at derivation, snippet /
 * cid-map building) is unit-testable without a DB, R2, or worker.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ParsedAttachment } from './parser';

/**
 * Resolve a server-generated storage path for an attachment. The filename is
 * NEVER used — a fresh UUID is, and the result is asserted to stay under
 * `attachmentDir` so a filename like `../../evil` cannot escape (AC11/sec-H4).
 */
export function resolveAttachmentPath(attachmentDir: string, uuid = randomUUID()): string {
  const base = path.resolve(attachmentDir);
  const target = path.resolve(base, uuid);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(prefix)) {
    throw new Error(`refusing attachment path outside ATTACHMENT_DIR: ${target}`);
  }
  return target;
}

/** Path for the archived raw .eml (also under ATTACHMENT_DIR, in raw/). */
export function resolveRawPath(attachmentDir: string, mailId: string): string {
  const base = path.resolve(attachmentDir);
  const rawDir = path.resolve(base, 'raw');
  const target = path.resolve(rawDir, `${mailId}.eml`);
  const prefix = rawDir.endsWith(path.sep) ? rawDir : rawDir + path.sep;
  if (!target.startsWith(prefix)) {
    throw new Error(`refusing raw path outside ATTACHMENT_DIR: ${target}`);
  }
  return target;
}

/**
 * Derive the received time from the R2 key `inbox/<epochMs>-<uuid>.eml`. Falls
 * back to now() if the key doesn't carry a parseable epoch (spoof-proof enough:
 * the Worker, not the sender, mints the key).
 */
export function receivedAtFromKey(key: string, now: () => number = Date.now): Date {
  const base = key.slice(key.lastIndexOf('/') + 1);
  const dash = base.indexOf('-');
  const epochStr = dash === -1 ? base : base.slice(0, dash);
  const epoch = Number(epochStr);
  if (Number.isFinite(epoch) && epoch > 0) return new Date(epoch);
  return new Date(now());
}

/**
 * Mark spam from the Email-Routing Authentication-Results header: any explicit
 * SPF/DKIM/DMARC failure flips the junk flag (M7). Absent header => not spam.
 */
export function isSpamFromAuthResults(header: string | null): boolean {
  if (!header) return false;
  const h = header.toLowerCase();
  return (
    /\bspf=(fail|softfail)\b/.test(h) ||
    /\bdkim=fail\b/.test(h) ||
    /\bdmarc=fail\b/.test(h)
  );
}

/** First ~140 chars of plain text (falling back to stripped HTML), collapsed. */
export function buildSnippet(
  textBody: string | null,
  htmlRaw: string | null,
  max = 140,
): string {
  let source = textBody ?? '';
  if (!source.trim() && htmlRaw) {
    // Drop script/style blocks entirely (their inner text is not readable
    // content) before stripping the remaining tags.
    source = htmlRaw
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
  }
  const collapsed = source.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
}

/** Is this attachment an inline (cid-referenced) part? */
export function isInlineAttachment(a: ParsedAttachment): boolean {
  return a.disposition === 'inline' || (a.contentId != null && a.disposition == null);
}

/** Build the cid -> data: URI map from a mail's inline attachments. */
export function buildCidMap(attachments: ParsedAttachment[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of attachments) {
    if (a.contentId && isInlineAttachment(a)) {
      map[a.contentId] = `data:${a.mimeType};base64,${a.content.toString('base64')}`;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Block (拒收) rules — pure matching + value validation, shared by the ingest
// short-circuit and the block-rules route so both agree on semantics.
// ---------------------------------------------------------------------------

/** The minimal shape of a rule the matcher needs (a DB row is a superset). */
export interface BlockRuleMatch {
  ruleType: string;
  value: string;
}

/** Lowercased address domain, or null if `addr` carries no `@`. */
function addrDomain(addr: string): string | null {
  const at = addr.lastIndexOf('@');
  return at === -1 ? null : addr.slice(at + 1);
}

/**
 * Is `addr` blocked by any rule? Case-insensitive. `address` rules match the
 * full address exactly; `domain` rules match the address's domain exactly OR any
 * subdomain of it (`foo.com` blocks `a@news.foo.com` but NOT `a@evilfoo.com`).
 * A null/empty `addr`, or one without `@`, never matches a domain rule and never
 * throws (values are already stored lowercase, but we lowercase defensively).
 */
export function isBlocked(
  addr: string | null | undefined,
  rules: readonly BlockRuleMatch[],
): boolean {
  if (!addr) return false;
  const a = addr.trim().toLowerCase();
  if (!a) return false;
  const domain = addrDomain(a);
  for (const rule of rules) {
    const value = rule.value.toLowerCase();
    if (rule.ruleType === 'address') {
      if (a === value) return true;
    } else if (rule.ruleType === 'domain') {
      if (domain !== null && (domain === value || domain.endsWith(`.${value}`))) {
        return true;
      }
    }
  }
  return false;
}

/** Trim + lowercase a raw block-rule value into its canonical stored form. */
export function normalizeBlockValue(value: string): string {
  return value.trim().toLowerCase();
}

/** A plausible bare domain: dotted, no `@`, sane charset, no leading/trailing/`..`. */
function isPlausibleDomain(domain: string): boolean {
  return (
    domain.length > 0 &&
    domain.includes('.') &&
    /^[a-z0-9.-]+$/.test(domain) &&
    !domain.startsWith('.') &&
    !domain.endsWith('.') &&
    !domain.includes('..')
  );
}

/**
 * Validate an already-normalized (trimmed + lowercased) block-rule value for its
 * type. `address` needs a single `@` with a non-empty local part and a plausible
 * domain; `domain` needs a bare plausible domain (no `@`). Rejects any internal
 * whitespace. Returns false for an unknown rule type.
 */
export function isValidBlockValue(ruleType: string, value: string): boolean {
  if (!value || /\s/.test(value)) return false;
  if (ruleType === 'address') {
    const at = value.indexOf('@');
    if (at === -1 || at !== value.lastIndexOf('@')) return false;
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return local.length > 0 && isPlausibleDomain(domain);
  }
  if (ruleType === 'domain') {
    return !value.includes('@') && isPlausibleDomain(value);
  }
  return false;
}

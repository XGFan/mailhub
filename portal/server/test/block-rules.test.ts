/**
 * Block (拒收) rule semantics — the pure matcher + value validators shared by
 * the ingest short-circuit (ingestor.ts) and the block-rules route (api). These
 * are DB-free: they exercise `isBlocked` / `isValidBlockValue` / `normalizeBlockValue`
 * directly. The load-bearing edge cases are subdomain scope (foo.com must NOT
 * match evilfoo.com) and malformed addresses (no `@` must never throw or match a
 * domain rule).
 */
import { describe, expect, it } from 'vitest';
import {
  type BlockRuleMatch,
  isBlocked,
  isValidBlockValue,
  normalizeBlockValue,
} from '../src/ingest-helpers';

const addr = (value: string): BlockRuleMatch => ({ ruleType: 'address', value });
const domain = (value: string): BlockRuleMatch => ({ ruleType: 'domain', value });

describe('isBlocked — address rules', () => {
  it('matches the full address exactly', () => {
    expect(isBlocked('spam@foo.com', [addr('spam@foo.com')])).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    expect(isBlocked('SPAM@Foo.Com', [addr('spam@foo.com')])).toBe(true);
    expect(isBlocked('spam@foo.com', [addr('SPAM@FOO.COM')])).toBe(true);
  });

  it('does not match a different local part', () => {
    expect(isBlocked('ham@foo.com', [addr('spam@foo.com')])).toBe(false);
  });

  it('does not treat an address rule as a domain rule', () => {
    // An address rule for spam@foo.com must not block everyone @foo.com.
    expect(isBlocked('other@foo.com', [addr('spam@foo.com')])).toBe(false);
  });
});

describe('isBlocked — domain rules', () => {
  it('matches the exact domain', () => {
    expect(isBlocked('a@foo.com', [domain('foo.com')])).toBe(true);
  });

  it('matches any subdomain', () => {
    expect(isBlocked('a@news.foo.com', [domain('foo.com')])).toBe(true);
    expect(isBlocked('a@a.b.foo.com', [domain('foo.com')])).toBe(true);
  });

  it('does NOT match a lookalike sibling domain (evilfoo.com)', () => {
    expect(isBlocked('a@evilfoo.com', [domain('foo.com')])).toBe(false);
  });

  it('does not match a parent of the rule domain', () => {
    expect(isBlocked('a@com', [domain('foo.com')])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isBlocked('a@NEWS.FOO.COM', [domain('foo.com')])).toBe(true);
  });
});

describe('isBlocked — edge cases', () => {
  it('returns false for empty rules', () => {
    expect(isBlocked('a@foo.com', [])).toBe(false);
  });

  it('returns false for null / undefined / empty addr', () => {
    expect(isBlocked(null, [domain('foo.com')])).toBe(false);
    expect(isBlocked(undefined, [domain('foo.com')])).toBe(false);
    expect(isBlocked('', [domain('foo.com')])).toBe(false);
    expect(isBlocked('   ', [domain('foo.com')])).toBe(false);
  });

  it('an address with no @ never throws and never matches a domain rule', () => {
    expect(() => isBlocked('not-an-email', [domain('foo.com')])).not.toThrow();
    expect(isBlocked('not-an-email', [domain('foo.com')])).toBe(false);
  });

  it('an address with no @ can still match an (identical) address rule', () => {
    // Not a realistic stored rule, but the matcher must be pure string compare.
    expect(isBlocked('not-an-email', [addr('not-an-email')])).toBe(true);
  });

  it('checks all rules in the list', () => {
    const rules = [addr('x@a.com'), domain('foo.com'), addr('y@b.com')];
    expect(isBlocked('a@foo.com', rules)).toBe(true);
  });
});

describe('normalizeBlockValue', () => {
  it('trims and lowercases', () => {
    expect(normalizeBlockValue('  SPAM@Foo.Com  ')).toBe('spam@foo.com');
    expect(normalizeBlockValue('FOO.COM')).toBe('foo.com');
  });
});

describe('isValidBlockValue — address', () => {
  it('accepts a plausible address', () => {
    expect(isValidBlockValue('address', 'spam@foo.com')).toBe(true);
  });

  it('rejects a missing @ / empty local / empty domain', () => {
    expect(isValidBlockValue('address', 'foo.com')).toBe(false);
    expect(isValidBlockValue('address', '@foo.com')).toBe(false);
    expect(isValidBlockValue('address', 'spam@')).toBe(false);
  });

  it('rejects more than one @', () => {
    expect(isValidBlockValue('address', 'a@b@foo.com')).toBe(false);
  });

  it('rejects a domain part without a dot', () => {
    expect(isValidBlockValue('address', 'spam@localhost')).toBe(false);
  });

  it('rejects internal whitespace', () => {
    expect(isValidBlockValue('address', 'sp am@foo.com')).toBe(false);
  });
});

describe('isValidBlockValue — domain', () => {
  it('accepts a plausible dotted domain', () => {
    expect(isValidBlockValue('domain', 'foo.com')).toBe(true);
    expect(isValidBlockValue('domain', 'a.b.foo.com')).toBe(true);
  });

  it('rejects an @-bearing value', () => {
    expect(isValidBlockValue('domain', 'a@foo.com')).toBe(false);
  });

  it('rejects a dotless value', () => {
    expect(isValidBlockValue('domain', 'localhost')).toBe(false);
  });

  it('rejects leading/trailing dots and empty labels', () => {
    expect(isValidBlockValue('domain', '.foo.com')).toBe(false);
    expect(isValidBlockValue('domain', 'foo.com.')).toBe(false);
    expect(isValidBlockValue('domain', 'foo..com')).toBe(false);
  });

  it('rejects an invalid charset', () => {
    expect(isValidBlockValue('domain', 'foo_bar.com')).toBe(false);
    expect(isValidBlockValue('domain', 'foo/bar.com')).toBe(false);
  });
});

describe('isValidBlockValue — unknown type', () => {
  it('returns false', () => {
    expect(isValidBlockValue('bogus', 'foo.com')).toBe(false);
  });
});

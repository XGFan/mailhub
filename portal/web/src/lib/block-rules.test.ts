import { describe, expect, it } from 'vitest';
import { domainOf, normalizeBlockValue, validateBlockValue } from './block-rules';

describe('normalizeBlockValue', () => {
  it('trims and lowercases', () => {
    expect(normalizeBlockValue('  Foo@Example.COM ')).toBe('foo@example.com');
  });
});

describe('validateBlockValue — address', () => {
  it('accepts a well-formed address', () => {
    expect(validateBlockValue('address', 'alice@example.com')).toBeNull();
    expect(validateBlockValue('address', '  Bob@Example.com ')).toBeNull();
  });

  it('rejects empty, missing @, empty local/domain, or multiple @', () => {
    expect(validateBlockValue('address', '')).not.toBeNull();
    expect(validateBlockValue('address', 'example.com')).not.toBeNull();
    expect(validateBlockValue('address', '@example.com')).not.toBeNull();
    expect(validateBlockValue('address', 'alice@')).not.toBeNull();
    expect(validateBlockValue('address', 'a@b@c.com')).not.toBeNull();
  });
});

describe('validateBlockValue — domain', () => {
  it('accepts a bare domain', () => {
    expect(validateBlockValue('domain', 'example.com')).toBeNull();
    expect(validateBlockValue('domain', 'news.example.co.uk')).toBeNull();
  });

  it('rejects addresses, dot-less names, and bad chars', () => {
    expect(validateBlockValue('domain', 'a@example.com')).not.toBeNull();
    expect(validateBlockValue('domain', 'localhost')).not.toBeNull();
    expect(validateBlockValue('domain', 'exa mple.com')).not.toBeNull();
    expect(validateBlockValue('domain', '')).not.toBeNull();
  });
});

describe('domainOf', () => {
  it('extracts the lowercased domain', () => {
    expect(domainOf('Alice@Example.com')).toBe('example.com');
  });

  it('returns null for malformed / empty input', () => {
    expect(domainOf(null)).toBeNull();
    expect(domainOf(undefined)).toBeNull();
    expect(domainOf('no-at-sign')).toBeNull();
    expect(domainOf('trailing@')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { mailHash, parseMailHash } from './mail-hash';

describe('parseMailHash', () => {
  it('reads the id out of a mail hash', () => {
    expect(parseMailHash('#/mail/abc123')).toBe('abc123');
  });

  it('returns null for an empty, unrelated or id-less hash', () => {
    expect(parseMailHash('')).toBeNull();
    expect(parseMailHash('#')).toBeNull();
    expect(parseMailHash('#/settings')).toBeNull();
    expect(parseMailHash('#/mail/')).toBeNull();
    expect(parseMailHash('#/mail/   ')).toBeNull();
  });

  it('decodes escaped ids and survives a malformed escape', () => {
    expect(parseMailHash('#/mail/a%2Fb')).toBe('a/b');
    expect(parseMailHash('#/mail/%')).toBeNull();
  });
});

describe('mailHash', () => {
  it('round-trips through parseMailHash', () => {
    for (const id of ['abc123', 'a/b', 'id with space', '中文']) {
      expect(parseMailHash(mailHash(id))).toBe(id);
    }
  });

  it('clears the hash for no selection', () => {
    expect(mailHash(null)).toBe('');
  });
});

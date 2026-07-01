import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAttachmentPath, resolveRawPath } from '../src/ingest-helpers';

const DIR = '/data/attachments';

describe('resolveAttachmentPath (AC11)', () => {
  it('uses a server-generated UUID under ATTACHMENT_DIR, ignoring any filename', () => {
    // A malicious attachment filename never reaches this function — the caller
    // passes a UUID. The resolved path must stay directly under ATTACHMENT_DIR.
    const uuid = '11111111-2222-3333-4444-555555555555';
    const p = resolveAttachmentPath(DIR, uuid);
    expect(p).toBe(path.resolve(DIR, uuid));
    expect(path.dirname(p)).toBe(path.resolve(DIR));
  });

  it('refuses a traversal-shaped id that would escape ATTACHMENT_DIR', () => {
    expect(() => resolveAttachmentPath(DIR, '../../evil')).toThrow();
    expect(() => resolveAttachmentPath(DIR, '../etc/passwd')).toThrow();
  });

  it('keeps generated paths inside the directory across many UUIDs', () => {
    const base = path.resolve(DIR) + path.sep;
    for (let i = 0; i < 50; i++) {
      const p = resolveAttachmentPath(DIR);
      expect(p.startsWith(base)).toBe(true);
    }
  });
});

describe('resolveRawPath', () => {
  it('places the raw .eml under ATTACHMENT_DIR/raw keyed by mail id', () => {
    const p = resolveRawPath(DIR, 'abc-123');
    expect(p).toBe(path.resolve(DIR, 'raw', 'abc-123.eml'));
  });
});

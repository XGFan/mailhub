import { describe, expect, it } from 'vitest';
import {
  buildCidMap,
  buildSnippet,
  isSpamFromAuthResults,
  receivedAtFromKey,
} from '../src/ingest-helpers';
import type { ParsedAttachment } from '../src/parser';

describe('receivedAtFromKey', () => {
  it('derives the time from the key epoch prefix', () => {
    const key = 'inbox/1700000000000-3f2a.eml';
    expect(receivedAtFromKey(key).getTime()).toBe(1700000000000);
  });

  it('falls back to now() for an unparseable key', () => {
    const fixed = 1234;
    expect(receivedAtFromKey('inbox/not-an-epoch.eml', () => fixed).getTime()).toBe(fixed);
  });
});

describe('isSpamFromAuthResults', () => {
  it('is false when the header is absent', () => {
    expect(isSpamFromAuthResults(null)).toBe(false);
  });

  it('flags explicit SPF/DKIM/DMARC failures', () => {
    expect(isSpamFromAuthResults('mx.example; spf=fail smtp.mailfrom=a@b')).toBe(true);
    expect(isSpamFromAuthResults('mx.example; dkim=fail header.d=b')).toBe(true);
    expect(isSpamFromAuthResults('mx.example; dmarc=fail')).toBe(true);
  });

  it('does not flag passing results', () => {
    expect(isSpamFromAuthResults('mx.example; spf=pass dkim=pass dmarc=pass')).toBe(false);
  });
});

describe('buildSnippet', () => {
  it('collapses whitespace and truncates to the limit', () => {
    const s = buildSnippet('  hello \n\n world   again  ', null, 11);
    expect(s).toBe('hello world');
  });

  it('falls back to stripped HTML when text is empty', () => {
    expect(buildSnippet('', '<p>Hi <b>there</b></p>', 140)).toBe('Hi there');
  });

  it('does not leak <script>/<style> inner text into the fallback snippet', () => {
    const s = buildSnippet('', '<p>Hi</p><script>alert(1)</script><style>.x{}</style>', 140);
    expect(s).toBe('Hi');
  });
});

describe('buildCidMap', () => {
  it('maps inline content-ids to data: URIs', () => {
    const atts: ParsedAttachment[] = [
      {
        filename: 'logo.png',
        mimeType: 'image/png',
        content: Buffer.from([0xde, 0xad]),
        contentId: 'logo@x',
        disposition: 'inline',
      },
      {
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from([0x25]),
        contentId: null,
        disposition: 'attachment',
      },
    ];
    const map = buildCidMap(atts);
    expect(map['logo@x']).toBe(`data:image/png;base64,${Buffer.from([0xde, 0xad]).toString('base64')}`);
    expect(Object.keys(map)).toHaveLength(1);
  });
});

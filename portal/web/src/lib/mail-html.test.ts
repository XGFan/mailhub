import { describe, expect, it } from 'vitest';
import { buildMailSrcDoc } from './mail-html';
import { escapeRegExp } from './format';

describe('buildMailSrcDoc (AC6/AC6b)', () => {
  const body = '<p>hi</p><img src="https://tracker.example/pixel.gif">';

  it('injects a meta CSP that blocks remote images by default', () => {
    const doc = buildMailSrcDoc(body, false);
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("default-src 'none'");
    // Only data: images allowed → remote <img>/beacons cannot fetch.
    expect(doc).toContain('img-src data:;');
    expect(doc).not.toContain('img-src data: https:');
    // Sanitized body is embedded verbatim.
    expect(doc).toContain(body);
  });

  it('widens img-src to remote schemes only when opted in', () => {
    const doc = buildMailSrcDoc(body, true);
    expect(doc).toContain('img-src data: https: http:');
  });

  it('never permits scripts or default remote content', () => {
    const doc = buildMailSrcDoc(body, true);
    // default-src stays 'none'; scripts are never granted a source.
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain('script-src');
  });
});

describe('escapeRegExp (search highlight safety)', () => {
  it('escapes regex metacharacters so raw input is matched literally', () => {
    const q = 'a.b*(c)+';
    const re = new RegExp(escapeRegExp(q));
    expect(re.test('a.b*(c)+')).toBe(true);
    expect(re.test('axbxxxc')).toBe(false);
  });

  it('does not throw on characters that would break a raw RegExp', () => {
    expect(() => new RegExp(escapeRegExp('['))).not.toThrow();
    expect(() => new RegExp(escapeRegExp('('))).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml } from '../src/sanitize';

describe('sanitizeMailHtml', () => {
  it('drops <script> tags and their content', () => {
    const out = sanitizeMailHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out.toLowerCase()).not.toContain('script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips event-handler attributes like onerror', () => {
    const out = sanitizeMailHtml('<img src="x" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('preserves remote https <img> src (client CSP gates the load, not the sanitizer)', () => {
    const out = sanitizeMailHtml('<img src="https://cdn.example/track.png?u=1" alt="remote">');
    expect(out).toContain('https://cdn.example/track.png?u=1');
  });

  it('preserves remote http <img> src (blocked client-side by CSP until opt-in)', () => {
    const out = sanitizeMailHtml('<img src="http://127.0.0.1:8123/px.gif" alt="remote">');
    expect(out).toContain('http://127.0.0.1:8123/px.gif');
  });

  it('drops javascript: (and other dangerous) <img> src while keeping remote URLs', () => {
    const out = sanitizeMailHtml('<img src="javascript:alert(1)" alt="x">');
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).not.toContain('alert(1)');
  });

  it('rewrites cid: image refs to their data: URI', () => {
    const dataUri = 'data:image/png;base64,AAAA';
    const out = sanitizeMailHtml('<img src="cid:logo@x">', { 'logo@x': dataUri });
    expect(out).toContain(dataUri);
    expect(out).not.toContain('cid:');
  });

  it('drops an unknown cid: image (no matching inline part)', () => {
    const out = sanitizeMailHtml('<img src="cid:missing">', {});
    expect(out).not.toContain('cid:');
    expect(out).not.toContain('src=');
  });

  it('strips <meta http-equiv="refresh">', () => {
    const out = sanitizeMailHtml(
      '<meta http-equiv="refresh" content="0;url=http://evil.example">',
    );
    expect(out.toLowerCase()).not.toContain('refresh');
    expect(out).not.toContain('evil.example');
  });

  it('forces links to open safely (target=_blank + rel)', () => {
    const out = sanitizeMailHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('drops http: and javascript: link schemes', () => {
    const out = sanitizeMailHtml(
      '<a href="javascript:alert(1)">a</a><a href="http://evil.example">b</a>',
    );
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).not.toContain('http://evil.example');
  });

  it('strips inline style declarations (no url()/@import beacons)', () => {
    const out = sanitizeMailHtml(
      '<div style="background:url(http://evil.example/x.png)">y</div>',
    );
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('url(');
  });
});

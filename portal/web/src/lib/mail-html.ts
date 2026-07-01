/**
 * Build the `srcdoc` document for the sandboxed reading-pane iframe.
 *
 * Security (plan §5.5 / AC6 / AC6b): the iframe is rendered with `sandbox=""`
 * (no scripts, no forms, no popups, no top-navigation) and
 * `referrerpolicy="no-referrer"`. As defense-in-depth we ALSO inject a meta
 * Content-Security-Policy that, by default, permits only `data:` images — so
 * remote `<img>`, CSS `url()` beacons and `<meta refresh>` trigger ZERO
 * network requests when a message is opened. Inline `cid:` images (rewritten
 * to `data:` server-side) still render.
 *
 * When the reader opts in — per-mail, or via the global "show remote images"
 * portal setting — we widen `img-src` so remote images load CLIENT-SIDE ONLY
 * (the browser reveals its IP, but there is no server-side fetch / SSRF).
 */
export function buildMailSrcDoc(sanitizedHtml: string, allowRemoteImages: boolean): string {
  const imgSrc = allowRemoteImages ? 'data: https: http:' : 'data:';
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`;
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    '<style>',
    'html,body{margin:0;padding:16px;background:#ffffff;color:#0a0a0a;',
    "font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
    'word-break:break-word;overflow-wrap:anywhere;}',
    'img{max-width:100%;height:auto;}',
    'a{color:#2563eb;}',
    'table{max-width:100%;border-collapse:collapse;}',
    'pre{white-space:pre-wrap;word-break:break-word;}',
    'blockquote{margin:0 0 0 12px;padding-left:12px;border-left:3px solid #e5e5e5;color:#525252;}',
    '</style>',
    '</head>',
    `<body>${sanitizedHtml}</body>`,
    '</html>',
  ].join('');
}

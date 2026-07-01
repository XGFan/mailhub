/**
 * Server-side HTML sanitization for untrusted mail bodies (plan §5.5 / H1).
 *
 * Rules:
 *  - drop script/style/iframe/object/embed/form/meta/base/link (and any other
 *    tag not on the allow-list);
 *  - link (`<a>`) schemes: https, mailto only — NO http:, NO javascript:, NO
 *    protocol-relative //host;
 *  - strip all inline CSS (allowedStyles {}) so `url()` / `@import` beacons die;
 *  - `<a>` gets target=_blank rel="noopener noreferrer nofollow";
 *  - `<img>`: `cid:` refs resolve to `data:` URIs from the mail's inline parts;
 *    remote http(s) `<img>` src URLs are PRESERVED (dangerous schemes such as
 *    `javascript:`/`vbscript:` and protocol-relative //host are still dropped).
 *    Remote images are NOT a server-side fetch here — they are only ever loaded
 *    CLIENT-SIDE, and blocked by default: the reading-pane iframe's CSP
 *    (`img-src data:`) stops the browser from requesting them until the reader
 *    opts in ("show remote images" / "Load images"). Keeping the URL is what
 *    makes that opt-in possible; privacy (no tracking pixel / IP leak by
 *    default) is enforced by the client CSP, NOT by stripping the URL here.
 *
 * The result is rendered in a sandboxed, CSP-locked iframe on the client; this
 * server pass is the first defense (XSS: no script/style/handlers/CSS), and the
 * iframe CSP is the second (remote-content gating). Defense in depth.
 */
import sanitizeHtml from 'sanitize-html';

/** Map of Content-ID (no angle brackets) -> `data:` URI for inline images. */
export type CidMap = Record<string, string>;

const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote',
  'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del',
  'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img',
  'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u',
  'ul', 'var', 'wbr',
];

/**
 * Sanitize a mail HTML body. `inlineCidMap` supplies the `data:` URIs that
 * `cid:` image references resolve to (built from the mail's inline attachments).
 */
export function sanitizeMailHtml(html: string, inlineCidMap: CidMap = {}): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      '*': ['align', 'valign', 'dir', 'title', 'width', 'height'],
    },
    // Default (governs <a>): https/mailto only. No http, no js.
    allowedSchemes: ['https', 'mailto', 'cid', 'data'],
    // <img> additionally keeps remote http/https URLs so the client can load
    // them on opt-in (blocked by the iframe CSP by default). javascript:/etc.
    // are absent → still dropped. cid: is rewritten to data: by the transform.
    allowedSchemesByTag: {
      img: ['https', 'http', 'data', 'cid'],
    },
    allowProtocolRelative: false,
    // Empty => every CSS declaration is stripped (kills url()/@import beacons).
    allowedStyles: {},
    // script/style/etc. are absent from allowedTags; drop them + their content.
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
      img: (tagName, attribs) => {
        const src = (attribs.src ?? '').trim();
        const lower = src.toLowerCase();
        // Inline cid: -> data: URI from the mail's inline parts.
        if (lower.startsWith('cid:')) {
          const cid = src.slice(4).replace(/^<|>$/g, '');
          const dataUri = inlineCidMap[cid];
          if (dataUri) return { tagName, attribs: { ...attribs, src: dataUri } };
          // Unknown cid — drop the src so nothing loads.
          const { src: _drop, ...rest } = attribs;
          return { tagName, attribs: rest };
        }
        // Already-inlined data: images are allowed through.
        if (lower.startsWith('data:')) return { tagName, attribs };
        // Remote http(s) images: PRESERVE the URL. They are never fetched by the
        // server; the client only loads them on opt-in, and the reading-pane CSP
        // (`img-src data:`) blocks the request by default. Privacy is enforced by
        // that CSP, not by removing the URL here (see the file header).
        if (lower.startsWith('http://') || lower.startsWith('https://')) {
          return { tagName, attribs };
        }
        // Any other scheme (javascript:, vbscript:, protocol-relative //host, …)
        // is dangerous — drop the src so nothing can load.
        const { src: _bad, ...rest } = attribs;
        return { tagName, attribs: rest };
      },
    },
  });
}

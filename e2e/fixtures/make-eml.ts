/**
 * Build a realistic raw RFC822 message for the E2E suite, matching what a real
 * inbound mail (via Cloudflare Email Routing → the CF Worker → R2) would look
 * like. The Worker stores the raw MIME verbatim and puts the envelope to/from
 * into R2 customMetadata (NOT into the message) — the seed helper does the same.
 *
 * The default message is deliberately hostile so the security ACs have teeth:
 *   - an RFC2047-encoded Subject containing an emoji (AC4 decode),
 *   - a text/plain + text/html alternative,
 *   - an inline `cid:` image (AC6b: must still render as data:),
 *   - a remote tracker `<img>` (AC6b: must NOT be fetched by default),
 *   - a `<script>` tag + an `onerror` handler (AC6: must never execute),
 *   - a file attachment (AC7: forced download).
 */

const CRLF = '\r\n';

/** 1x1 red PNG — a valid raster so the inline cid image decodes (naturalWidth>0). */
const INLINE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export interface EmlOptions {
  /** Unique run token woven into subject/body so searches are unambiguous. */
  token: string;
  /** Envelope sender address (also the From header address). */
  fromAddr: string;
  /** From header display name. */
  fromName?: string;
  /** Envelope recipient (set in R2 metadata by the caller too). */
  toAddr: string;
  /** Human subject text; emoji + token are appended and the whole is RFC2047-encoded. */
  subjectText?: string;
  /** Plain-text body. */
  text?: string;
  /** Include the text/html alternative (with cid + remote + script). */
  html?: boolean;
  /** Absolute URL of the out-of-band tracker for the remote `<img>` beacon. */
  trackerPixelUrl?: string;
  /** Include the inline cid image part. */
  inlineImage?: boolean;
  /** Include a downloadable file attachment. */
  attachment?: boolean;
}

/** RFC2047 "B" encoded-word for a UTF-8 string (single word; keep inputs short). */
function encodeWord(s: string): string {
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function b64Wrap(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join(CRLF);
}

export interface BuiltEml {
  raw: Buffer;
  subjectDecoded: string;
  messageId: string;
}

export function makeSampleEml(opts: EmlOptions): BuiltEml {
  const {
    token,
    fromAddr,
    fromName,
    toAddr,
    subjectText = 'Hello',
    text = `Plain text body for ${token}. This is the readable snippet.`,
    html = true,
    trackerPixelUrl,
    inlineImage = true,
    attachment = true,
  } = opts;

  const subjectDecoded = `${subjectText} 👋 ${token}`;
  const messageId = `<${token}@mailhub.test>`;
  const cid = `inline-${token}@mailhub.test`;
  const fromHeader = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

  const mixed = `mixed-${token}`;
  const alt = `alt-${token}`;

  const htmlBody = [
    '<!doctype html><html><body>',
    `<h1>Rich HTML for ${token}</h1>`,
    `<p>Inline image below should render from a <code>cid:</code> data URI.</p>`,
    inlineImage ? `<p><img id="cidimg" src="cid:${cid}" alt="inline logo" width="1" height="1"></p>` : '',
    trackerPixelUrl
      ? `<p><img id="tracker" src="${trackerPixelUrl}" alt="remote" width="1" height="1"></p>`
      : '',
    // Must never execute (sandboxed iframe + server-side sanitize strips it):
    `<script>document.title='xss-executed';new Image().src='${trackerPixelUrl ?? 'http://127.0.0.1:1/'}?via=script';</script>`,
    `<img id="onerr" src="cid:does-not-exist" onerror="new Image().src='${trackerPixelUrl ?? 'http://127.0.0.1:1/'}?via=onerror'">`,
    `<p><a href="https://example.com/${token}">a safe link</a></p>`,
    '</body></html>',
  ].join('');

  const lines: string[] = [];
  lines.push(`From: ${fromHeader}`);
  lines.push(`To: ${toAddr}`);
  lines.push(`Subject: ${encodeWord(subjectDecoded)}`);
  lines.push(`Message-ID: ${messageId}`);
  lines.push('Date: Wed, 01 Jul 2026 10:30:00 +0000');
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
  lines.push('');
  lines.push(`--${mixed}`);

  // Body: multipart/alternative (text + optional html).
  lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
  lines.push('');
  lines.push(`--${alt}`);
  lines.push('Content-Type: text/plain; charset="utf-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(text);
  lines.push('');
  if (html) {
    lines.push(`--${alt}`);
    lines.push('Content-Type: text/html; charset="utf-8"');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(htmlBody);
    lines.push('');
  }
  lines.push(`--${alt}--`);
  lines.push('');

  // Inline cid image.
  if (inlineImage) {
    lines.push(`--${mixed}`);
    lines.push('Content-Type: image/png');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('Content-Disposition: inline');
    lines.push(`Content-ID: <${cid}>`);
    lines.push('');
    lines.push(b64Wrap(INLINE_PNG_B64));
    lines.push('');
  }

  // File attachment.
  if (attachment) {
    const payload = Buffer.from(
      `MailHub attachment payload for ${token}.\nKeep this as an octet-stream download.\n`,
      'utf8',
    ).toString('base64');
    lines.push(`--${mixed}`);
    lines.push('Content-Type: text/plain; name="report.txt"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('Content-Disposition: attachment; filename="report.txt"');
    lines.push('');
    lines.push(b64Wrap(payload));
    lines.push('');
  }

  lines.push(`--${mixed}--`);
  lines.push('');

  return { raw: Buffer.from(lines.join(CRLF), 'utf8'), subjectDecoded, messageId };
}

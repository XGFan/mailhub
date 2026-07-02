/**
 * MIME parsing via postal-mime (plan §5.3). postal-mime does RFC2047 subject
 * decoding for us and never fetches remote content, so there is no SSRF surface
 * here. This module is pure (no DB / no disk); the ingestor drives it, and the
 * parse-worker runs `parseRaw` inside an isolated worker_thread (sec-M2).
 */
import PostalMime from 'postal-mime';

/** A parsed attachment with its raw bytes as a Node Buffer. */
export interface ParsedAttachment {
  filename: string | null;
  mimeType: string;
  content: Buffer;
  contentId: string | null;
  disposition: 'attachment' | 'inline' | null;
}

/** Normalized parse result consumed by the ingestor. */
export interface ParsedMail {
  messageId: string | null;
  subject: string | null;
  fromAddr: string | null;
  fromName: string | null;
  /** Reply-To header address (first entry), or null. */
  replyToAddr: string | null;
  /** Reply-To header display name (first entry), or null. */
  replyToName: string | null;
  textBody: string | null;
  htmlRaw: string | null;
  /** ISO 8601 string, or null if the Date header was absent/unparseable. */
  date: string | null;
  attachments: ParsedAttachment[];
  authResultsHeader: string | null;
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  return Buffer.from(content);
}

function normalizeContentId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // Strip surrounding angle brackets: "<abc@host>" -> "abc@host".
  return raw.replace(/^<|>$/g, '') || null;
}

function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Parse a raw MIME buffer into a normalized ParsedMail. */
export async function parseRaw(buf: Buffer): Promise<ParsedMail> {
  const email = await PostalMime.parse(buf, { attachmentEncoding: 'arraybuffer' });

  const authResultsHeader =
    email.headers
      .filter((h) => h.key === 'authentication-results')
      .map((h) => h.value)
      .join('\n') || null;

  const attachments: ParsedAttachment[] = email.attachments.map((a) => ({
    filename: a.filename ?? null,
    mimeType: a.mimeType || 'application/octet-stream',
    content: toBuffer(a.content),
    contentId: normalizeContentId(a.contentId),
    disposition: a.disposition ?? null,
  }));

  // Reply-To is an array; the first mailbox is the meaningful reply target.
  const replyTo = email.replyTo?.[0];

  return {
    messageId: email.messageId ?? null,
    subject: email.subject ?? null,
    fromAddr: email.from?.address ?? null,
    fromName: email.from?.name || null,
    replyToAddr: replyTo?.address ?? null,
    replyToName: replyTo?.name || null,
    textBody: email.text ?? null,
    htmlRaw: email.html ?? null,
    date: normalizeDate(email.date),
    attachments,
    authResultsHeader,
  };
}

/**
 * Drizzle schema for the MailHub Postgres tables (plan §5.4).
 *
 * The GIN pg_trgm indexes and the btree date/received_at indexes are created as
 * raw SQL in db/migrate.ts (they depend on the pg_trgm extension existing
 * first), so they are intentionally NOT declared here. This file owns the table
 * shapes plus the load-bearing `r2_key UNIQUE` idempotency anchor and the
 * message_id lookup index.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const mails = pgTable(
  'mails',
  {
    /** Server-generated UUID primary key. */
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * R2 object key — the idempotency anchor. UNIQUE so that re-processing the
     * same object (crash between store and delete) can `ON CONFLICT DO NOTHING`
     * and never create a duplicate row (AC8 / C1).
     */
    r2Key: text('r2_key').notNull().unique(),
    /** Message-ID header — non-unique (spoofable), indexed for threading only. */
    messageId: text('message_id'),
    /** Envelope recipient — what the address actually received (search anchor). */
    toAddr: text('to_addr'),
    /** Envelope sender address. */
    fromAddr: text('from_addr'),
    /** Display name parsed from the From header. */
    fromName: text('from_name'),
    /** RFC2047-decoded subject. */
    subject: text('subject'),
    /** Parsed header date (nullable / spoofable). */
    date: timestamp('date', { withTimezone: true }),
    /** Derived from the r2_key epoch — always present, spoof-proof sort fallback. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    /** Plain-text body. */
    textBody: text('text_body'),
    /** Server-sanitized HTML body ready for the sandboxed iframe. */
    htmlSanitized: text('html_sanitized'),
    /** First ~140 chars of text, HTML-stripped and whitespace-collapsed. */
    snippet: text('snippet'),
    /** Raw message size in bytes. */
    sizeBytes: integer('size_bytes'),
    /** Whether the mail has one or more non-inline attachments. */
    hasAttachments: boolean('has_attachments').notNull().default(false),
    /** SPF/DKIM/DMARC-derived spam flag (junk filtering, M7). */
    isSpam: boolean('is_spam').notNull().default(false),
    /** Raw Authentication-Results header, if present. */
    authResults: text('auth_results'),
    /** Absolute path to the archived raw .eml on the attachment PVC. */
    rawPath: text('raw_path'),
    /** Row creation time. */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('mails_message_id_idx').on(t.messageId)],
);

export const attachments = pgTable('attachments', {
  /** Server-generated UUID primary key. */
  id: uuid('id').primaryKey().defaultRandom(),
  /** Owning mail; attachments cascade-delete with their mail. */
  mailId: uuid('mail_id')
    .notNull()
    .references(() => mails.id, { onDelete: 'cascade' }),
  /** Original filename — display only, NEVER used as a filesystem path. */
  filename: text('filename'),
  /** Reported MIME type (served forced-download regardless). */
  mimeType: text('mime_type'),
  /** Attachment size in bytes. */
  sizeBytes: integer('size_bytes'),
  /** Server-generated path under ATTACHMENT_DIR (validated — AC11/sec-H4). */
  storagePath: text('storage_path').notNull(),
  /** Content-ID for inline (cid:) parts, without angle brackets. */
  contentId: text('content_id'),
  /** True for inline (cid:) parts referenced by the HTML body. */
  isInline: boolean('is_inline').notNull().default(false),
});

/**
 * Single-row settings table (always id = 1). Holds the client-configurable
 * PortalSettings; `showRemoteImages` defaults to off (remote content blocked).
 */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  showRemoteImages: boolean('show_remote_images').notNull().default(false),
});

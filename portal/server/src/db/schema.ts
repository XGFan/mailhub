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
  uniqueIndex,
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
    /**
     * Sender address for display — the header `From:` address (human-meaningful),
     * falling back to the envelope sender only when the header is absent.
     */
    fromAddr: text('from_addr'),
    /** Display name parsed from the From header. */
    fromName: text('from_name'),
    /**
     * SMTP envelope sender (the `MAIL FROM` / Return-Path). Kept for provenance
     * (e.g. an SES bounce address) and surfaced only when it differs from the
     * header From.
     */
    envelopeFrom: text('envelope_from'),
    /** Reply-To address parsed from the header, if present. */
    replyToAddr: text('reply_to_addr'),
    /** Display name parsed from the Reply-To header. */
    replyToName: text('reply_to_name'),
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
    /**
     * User-starred flag. Starred mail is exempt from retention auto-purge, so it
     * survives past RETENTION_DAYS until unstarred or explicitly deleted.
     */
    isFavorite: boolean('is_favorite').notNull().default(false),
    /** Raw Authentication-Results header, if present. */
    authResults: text('auth_results'),
    /** Absolute path to the archived raw .eml on the attachment PVC. */
    rawPath: text('raw_path'),
    /** Row creation time. */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('mails_message_id_idx').on(t.messageId),
    // Backs the "starred only" filter and the retention purge's favorite skip.
    index('mails_is_favorite_idx').on(t.isFavorite),
  ],
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

/**
 * Block (拒收) rules. Mail whose sender matches a rule is dropped at ingest time
 * (dropped, never archived — see ingestor.ts). `value` is stored lowercase; the
 * `(rule_type, value)` unique index makes duplicate rules a 409 rather than a
 * silent second row.
 */
export const blockRules = pgTable(
  'block_rules',
  {
    /** Server-generated UUID primary key. */
    id: uuid('id').primaryKey().defaultRandom(),
    /** `'address'` (full email) or `'domain'` (domain + all its subdomains). */
    ruleType: text('rule_type').notNull(),
    /** Lowercased address ("a@example.com") or bare domain ("example.com"). */
    value: text('value').notNull(),
    /** Row creation time (drives the newest-first list order). */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('block_rules_type_value_idx').on(t.ruleType, t.value)],
);

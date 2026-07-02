/**
 * @mailhub/shared — the MailHub API contract.
 *
 * These types are the single source of truth shared by the portal backend
 * (portal/server) and the web client (portal/web) so the two agree on the
 * shape of every request and response. Keep this package dependency-free and
 * type-only: everything here erases at compile time.
 *
 * Field semantics are derived from the approved plan (§5.3 API / §5.4 data
 * model). Notably, `toAddr` is the *envelope* recipient (what the address
 * actually received — authoritative for recipient search), and `date` is the
 * parsed header date which may be missing, whereas `receivedAt` is always
 * present (derived from the R2 object key epoch, spoof-proof).
 */

/** A single row in the mail list / search results. */
export interface MailListItem {
  /** Server-generated UUID primary key. */
  id: string;
  /** Envelope sender address (e.g. "alice@example.com"). */
  fromAddr: string;
  /** Optional display name parsed from the From header. */
  fromName?: string;
  /** Envelope recipient — the address that actually received this mail. */
  toAddr: string;
  /** RFC2047-decoded subject (may be empty). */
  subject: string;
  /** Short plain-text preview: first ~140 chars, HTML-stripped, collapsed. */
  snippet: string;
  /** Parsed header date as an ISO 8601 string, or null if absent/unparseable. */
  date: string | null;
  /** When the mail was received, as an ISO 8601 string (always present). */
  receivedAt: string;
  /** Whether the mail has one or more (non-inline) attachments. */
  hasAttachments: boolean;
  /** Whether SPF/DKIM/DMARC results marked this as likely spam/junk. */
  isSpam: boolean;
  /** Whether the user has starred this mail (starred mail is retention-exempt). */
  isFavorite: boolean;
}

/** Metadata for a single parsed attachment (bytes served separately). */
export interface Attachment {
  /** Server-generated UUID primary key. */
  id: string;
  /** Original filename for display only — never used as a filesystem path. */
  filename: string;
  /** Reported MIME type (served forced-download regardless). */
  mimeType: string;
  /** Size of the attachment in bytes. */
  sizeBytes: number;
  /** True for inline (cid:) parts referenced by the HTML body. */
  isInline: boolean;
}

/** Full mail detail returned by GET /api/mails/:id. */
export interface MailDetail extends MailListItem {
  /** Server-sanitized HTML body ready for the sandboxed iframe, or null. */
  htmlSanitized: string | null;
  /** Plain-text body, or null. */
  textBody: string | null;
  /** All attachments (inline + regular) for this mail. */
  attachments: Attachment[];
  /** Raw Authentication-Results header, if present (SPF/DKIM/DMARC). */
  authResults?: string;
  /**
   * SMTP envelope sender (the `MAIL FROM` / Return-Path, e.g. an SES bounce
   * address). Surfaced only when it differs from the header From so the reader
   * can see where the mail actually originated. Display prefers `fromAddr`.
   */
  envelopeFrom?: string;
  /** Reply-To address parsed from the header, if present and distinct. */
  replyToAddr?: string;
  /** Optional display name parsed from the Reply-To header. */
  replyToName?: string;
}

/** Which column(s) a search query targets. `all` ORs to/from/subject. */
export type SearchField = 'all' | 'to' | 'from' | 'subject';

/** Query parameters accepted by GET /api/mails. */
export interface SearchQuery {
  /** Free-text substring (case-insensitive). Omit/empty ⇒ list newest. */
  q?: string;
  /** Target field; defaults to `all`. */
  field?: SearchField;
  /** 1-based page number; defaults to 1. */
  page?: number;
  /** Page size; defaults to 50, bounded to a server maximum (100). */
  pageSize?: number;
  /** Include spam/junk in results; defaults to false. */
  includeSpam?: boolean;
  /** Restrict results to starred mail only; defaults to false. */
  favorite?: boolean;
}

/** Paginated response from GET /api/mails. */
export interface SearchResponse {
  items: MailListItem[];
  page: number;
  pageSize: number;
  /** Total number of matching rows across all pages. */
  total: number;
}

/** Response from POST /api/ingest/run (the manual "Fetch now" trigger). */
export interface IngestRunResponse {
  /** Whether this call started a new ingest pass. */
  started: boolean;
  /** True if a pass was already running and this call was debounced. */
  alreadyRunning: boolean;
  /** Number of messages processed, when known. */
  processed?: number;
}

/** Response from PUT /api/mails/:id/favorite (the star toggle). */
export interface FavoriteResponse {
  id: string;
  isFavorite: boolean;
}

/** Client-configurable portal settings. */
export interface PortalSettings {
  /** When true, remote images in HTML mail load client-side (never server-side). */
  showRemoteImages: boolean;
}

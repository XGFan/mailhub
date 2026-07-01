import 'dotenv/config';

/**
 * Runtime configuration, read from the environment with sane defaults that
 * mirror .env.example. Secrets have no defaults and must be provided.
 */
export interface Config {
  /** HTTP port the portal API listens on. */
  port: number;
  /** Postgres connection string (least-privilege role). */
  databaseUrl: string;
  /** R2 S3-compatible endpoint. */
  r2Endpoint: string;
  /** R2 S3 access key id. */
  r2AccessKeyId: string;
  /** R2 S3 secret access key. */
  r2SecretAccessKey: string;
  /** R2 bucket name that buffers raw MIME. */
  r2Bucket: string;
  /** Ingestor poll interval in milliseconds. */
  pollIntervalMs: number;
  /** Directory where parsed attachment bytes are written. */
  attachmentDir: string;
  /** Reject any raw message larger than this many bytes. */
  maxMailBytes: number;
  /** Delete mails + attachment files older than this many days. */
  retentionDays: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export const config: Config = {
  port: num('PORT', 8787),
  databaseUrl: str('DATABASE_URL'),
  r2Endpoint: str('R2_ENDPOINT'),
  r2AccessKeyId: str('R2_ACCESS_KEY_ID'),
  r2SecretAccessKey: str('R2_SECRET_ACCESS_KEY'),
  r2Bucket: str('R2_BUCKET', 'mailhub-raw'),
  pollIntervalMs: num('POLL_INTERVAL_MS', 30_000),
  attachmentDir: str('ATTACHMENT_DIR', './data/attachments'),
  maxMailBytes: num('MAX_MAIL_BYTES', 27_262_976),
  retentionDays: num('RETENTION_DAYS', 7),
};

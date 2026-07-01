/**
 * MinIO/R2 access over the S3 API. Used by global-setup to create the bucket and
 * by the seed helper to drop raw `.eml` objects into `inbox/` exactly the way the
 * Cloudflare Worker does: key `inbox/<epochMs>-<uuid>.eml`, contentType
 * message/rfc822, and the sanitized envelope to/from in customMetadata.
 */
import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { R2_ACCESS_KEY_ID, R2_BUCKET, R2_ENDPOINT, R2_SECRET_ACCESS_KEY } from './env';

export const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/** Create the raw-mail bucket if it does not already exist (idempotent). */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
    return;
  } catch {
    // fall through to create
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: R2_BUCKET }));
  } catch (err) {
    // A concurrent create or "already owned" is fine.
    const name = (err as { name?: string }).name ?? '';
    if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(name)) throw err;
  }
}

/** Delete every object in the bucket (clean slate for a fresh run). */
export async function clearBucket(): Promise<void> {
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key }));
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}

/**
 * Drop a raw message into `inbox/` the way the Worker does. Returns the R2 key
 * (which also encodes the received epoch used by the portal's received_at).
 */
export async function putInboxObject(
  raw: Buffer,
  meta: { to: string; from: string },
): Promise<string> {
  const key = `inbox/${Date.now()}-${randomUUID()}.eml`;
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: raw,
      ContentType: 'message/rfc822',
      // The Worker sanitizes these to printable ASCII; our fixture addresses
      // already are, so pass them through unchanged.
      Metadata: { to: meta.to, from: meta.from },
    }),
  );
  return key;
}

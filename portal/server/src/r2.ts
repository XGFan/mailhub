/**
 * R2 access over the S3 API (plan §5.2 / §5.3). The portal uses a bucket-scoped
 * token with Get/List/Delete/Put; the Worker writes via its binding, not this
 * token. `region: "auto"` and path-style addressing keep this compatible with
 * both Cloudflare R2 and MinIO (local dev).
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from './config';

const INBOX_PREFIX = 'inbox/';
const DEAD_PREFIX = 'dead/';

export const s3 = new S3Client({
  region: 'auto',
  endpoint: config.r2Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

/** A pending inbox object. */
export interface InboxObject {
  key: string;
  size: number;
}

/**
 * List every object under `inbox/`, following ContinuationToken so a >100
 * backlog can never stall discovery (H4). ListObjectsV2 on R2 is strongly
 * consistent, so a delete-on-ingest loop keeps this returning only fresh mail.
 */
export async function listInbox(): Promise<InboxObject[]> {
  const objects: InboxObject[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.r2Bucket,
        Prefix: INBOX_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      // Skip the prefix "directory" placeholder if the store surfaces one.
      if (!obj.Key || obj.Key.endsWith('/')) continue;
      objects.push({ key: obj.Key, size: obj.Size ?? 0 });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/** Fetch an object's bytes plus its (lowercased) user metadata. */
export async function getObject(
  key: string,
): Promise<{ body: Buffer; metadata: Record<string, string>; contentLength: number }> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: config.r2Bucket, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return {
    body: Buffer.from(bytes),
    metadata: res.Metadata ?? {},
    contentLength: res.ContentLength ?? bytes.byteLength,
  };
}

/** Delete an inbox object (after a successful DB commit). */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.r2Bucket, Key: key }));
}

/**
 * Move a poison / oversized object out of `inbox/` to `dead/` (server-side
 * copy, then delete the original) so it can't loop forever (H4). The `dead/`
 * prefix is the only one an R2 lifecycle rule expires.
 */
export async function copyToDead(key: string): Promise<void> {
  const deadKey = key.startsWith(INBOX_PREFIX)
    ? DEAD_PREFIX + key.slice(INBOX_PREFIX.length)
    : DEAD_PREFIX + key;
  await s3.send(
    new CopyObjectCommand({
      Bucket: config.r2Bucket,
      CopySource: `${config.r2Bucket}/${key}`,
      Key: deadKey,
    }),
  );
  await deleteObject(key);
}

/** Readiness check: is the bucket reachable and are our creds valid? */
export async function headBucket(): Promise<void> {
  await s3.send(new HeadBucketCommand({ Bucket: config.r2Bucket }));
}

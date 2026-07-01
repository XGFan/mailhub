/**
 * MailHub Cloudflare Worker — inbound mail ingestor.
 *
 * Cloudflare Email Routing delivers each inbound message to `email()`. This
 * handler buffers the raw MIME into an ArrayBuffer and writes it to R2
 * (binding `RAW_MAIL`) under an `inbox/<epochMs>-<uuid>.eml` key with
 * sanitized envelope to/from in customMetadata — doing NO parsing (to stay
 * under the 10ms free CPU limit) and letting `put()` errors propagate so the
 * sending MTA retries.
 *
 * See the approved plan §5.1.
 */

/** Cloudflare bindings available to this Worker. */
export interface Bindings {
  /** R2 bucket that buffers raw inbound MIME (see wrangler.toml). */
  RAW_MAIL: R2Bucket;
}

/**
 * Sanitize an envelope address for use in R2 customMetadata. Metadata rides
 * along as HTTP headers, so a stray CR/LF (header injection) or non-ASCII
 * byte would make `put()` throw — strip anything outside printable ASCII and
 * cap the length so two fields stay well under the 8192-byte metadata limit.
 */
function san(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "").slice(0, 320);
}

/**
 * Handle one inbound message: buffer the raw MIME and write it to R2. Kept
 * as a standalone function so it's testable without a live Worker runtime.
 */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<void> {
  void ctx;

  const key = `inbox/${Date.now()}-${crypto.randomUUID()}.eml`;

  // message.raw is a length-unknown ReadableStream — R2 put() needs a sized
  // body, so buffer it fully first. This is I/O wait, not CPU time (AC2).
  const buf = await new Response(message.raw).arrayBuffer();

  // Do NOT catch errors here (H6): if put() rejects, let it propagate so
  // Email Routing reports a temp-failure and the sending MTA retries
  // (transport-layer at-least-once delivery).
  await env.RAW_MAIL.put(key, buf, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { to: san(message.to), from: san(message.from) },
  });
}

export default {
  email: handleEmail,
} satisfies ExportedHandler<Bindings>;

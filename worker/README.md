# @mailhub/worker — Cloudflare Worker inbound email handler

A lightweight Cloudflare Worker that receives email via Email Routing and buffers raw MIME to R2 for the portal backend to parse.

## What it does

1. **Email Routing trigger:** Cloudflare Email Routing routes inbound mail to this Worker
2. **Buffer to R2:** Reads the raw email into an ArrayBuffer and writes it to R2 bucket `mailhub-raw` under `inbox/<epochMs>-<uuid>.eml`
3. **Sanitize metadata:** Extracts envelope `to` and `from` addresses, sanitizes them (strips control chars, caps length), and stores as R2 custom metadata
4. **Error propagation:** If R2 `put()` fails, the error propagates back to Email Routing, which sends a temp-failure response to the sending MTA (at-least-once delivery semantics)

**No parsing:** The Worker does zero MIME parsing — it stays well under the 10ms free CPU limit.

## Setup

### Prerequisites

- **Cloudflare account** with a domain, Email Routing enabled, and R2 access
- **Wrangler** (`pnpm install` in this directory, then `pnpm deploy`)

### Deployment

```bash
cd worker

# Install dependencies (wrangler, TypeScript)
pnpm install

# Type-check
pnpm typecheck

# Local dev (requires wrangler.toml with R2 binding)
pnpm dev

# Deploy to Cloudflare
pnpm deploy
```

The output will show your Worker's URL.

### Configure Email Routing

In the Cloudflare dashboard:

1. Go to **Email > Email Routing** for your domain
2. Add a **catch-all rule:**
   - **Match:** `*` (all addresses)
   - **Route to:** Worker → select the `mailhub` Worker you just deployed
   - **Save**

Mail sent to any address on your domain will now flow to this Worker → R2.

## Configuration (wrangler.toml)

The Worker requires an R2 bucket binding:

```toml
[[r2_buckets]]
binding = "RAW_MAIL"
bucket_name = "mailhub-raw"
```

Ensure the bucket `mailhub-raw` exists in your R2 account. The Worker will write to `inbox/` prefix; you can optionally configure a lifecycle rule to auto-delete `dead/` (failed messages) after 30+ days.

## Development

### Local testing

Use `wrangler dev` with a mocked `ForwardableEmailMessage`:

```bash
pnpm test   # runs unit tests (see src/index.test.ts)
pnpm dev    # starts a local dev server (does not receive actual Email Routing)
```

Tests mock the R2 binding and assert:
- One `put()` call per email
- Metadata is sanitized (no CR/LF injection)
- Errors propagate (no swallowing)

### Monitoring

After deployment, use `wrangler tail` to see invocation logs and CPU time:

```bash
wrangler tail mailhub
```

Each invocation should show `<10 ms CPU` (I/O buffering is not counted toward CPU time).

## Architecture notes

**Why no parsing in the Worker?**
- Free Workers CPU limit is **10ms per invocation**
- MIME parsing (especially with postal-mime) takes 50–500ms depending on message complexity
- Buffering raw MIME into an ArrayBuffer takes ~1–2ms (I/O wait, not CPU)
- Portal backend has ample time (runs on k8s, no time limit) to parse in isolation

**Why R2 as the buffer?**
- **10 GB free storage:** enough for ~20 days of mail at 1,000 emails/day
- **Free egress:** portal pull-drains are free
- **Strongly consistent LIST:** portal can discover mail reliably via paginated `ListObjectsV2`
- **Alternative considered:** Cloudflare Queues (nice MQ semantics, but 10k ops/day limit is tighter than R2 Class A at high volume)

## Deployment phases

This Worker is complete as of Phase 1. Portal backend (Phase 2+) pulls from R2 and parses.

## See also

- **Portal backend:** `portal/server/`
- **Full plan:** [`.omc/plans/mailhub-cf-worker-portal-plan.md`](.omc/plans/mailhub-cf-worker-portal-plan.md)
- **Cloudflare Email Routing docs:** [https://developers.cloudflare.com/email-routing/](https://developers.cloudflare.com/email-routing/)
- **R2 docs:** [https://developers.cloudflare.com/r2/](https://developers.cloudflare.com/r2/)

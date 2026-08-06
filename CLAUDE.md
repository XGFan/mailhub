# MailHub — Claude Code Guide

## Overview

MailHub is a personal email archive system. A **Cloudflare Email Worker** ingests inbound mail via Email Routing and buffers raw MIME to R2. A **self-hosted Node/TS portal** (running on k3s) drains R2, parses mail with postal-mime into Postgres, and serves a React web UI to search and read your archive. **No authentication by default** — the portal runs cluster-internal only (ClusterIP + NetworkPolicy) behind tinyauth at the ingress; setting `API_KEYS` optionally gates `/api/*` behind an API key for programmatic clients.

## Monorepo Layout

**Workspace:** `pnpm-workspace.yaml` defines four packages:

| Package | Path | Purpose |
|---------|------|---------|
| `@mailhub/shared` | `shared/src/` | Type-only API contract (MailListItem, MailDetail, SearchResponse, etc.) |
| `@mailhub/worker` | `worker/src/` | Cloudflare Worker (Email Routing → R2 buffer, <10ms CPU, Wrangler + TS) |
| `@mailhub/portal-server` | `portal/server/src/` | REST API + singleton ingestor + auto-purge (Hono + Drizzle + pg + postal-mime, Node/TS) |
| `@mailhub/web` | `portal/web/src/` | Portal UI (React 19 + Vite + Tailwind v4 CSS-first + shadcn/ui) |

## Key Commands

**Type-check & test all packages:**
```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

**Portal server dev** (requires Postgres + MinIO via `portal/server/docker-compose.yml`):
```bash
pnpm --filter @mailhub/portal-server dev
```

**Portal web dev** (Vite, port 5173, proxies /api → localhost:8787):
```bash
pnpm --filter @mailhub/web dev
pnpm --filter @mailhub/web build
```

**Worker dev & deploy:**
```bash
cd worker
pnpm dev                    # local wrangler dev
pnpm deploy                 # wrangler deploy to Cloudflare
```

**E2E tests** (from repo root):
```bash
cd e2e && npm test
```

## Important Invariants

- **Worker stays lightweight:** No parsing in the Worker (stays <10ms CPU). Buffer raw MIME to R2; let the portal parse.
- **Idempotency anchor:** `r2_key` — the upsert `ON CONFLICT r2_key` deduplicates retried mail from MTAs.
- **Parsing isolation:** Portal runs postal-mime in a worker_thread (isolated subprocess) to sandbox untrusted MIME.
- **HTML safety:** Mail HTML is rendered in a sandboxed iframe with CSP blocking remote images.
- **Remote images:** Blocked by default (client-side opt-in only, never server-side fetch to avoid SSRF).
- **Sender display:** `fromAddr`/`fromName` are the header `From:` (human-meaningful). The SMTP envelope sender (`metadata.from`, an opaque bounce/return-path) is only a fallback when the header From is absent, and is stored separately as `envelope_from` (surfaced in the detail as Return-Path when it differs).
- **Open mail lives in the URL:** the reading pane's message is encoded as `#/mail/<id>` (client-side hash only — no server rewrite rules). A reload reopens it, links are shareable, and Back/Forward move between opened mails. On mobile the visible pane is derived from it, so browser Back leaves the reading pane exactly like the in-app Back button.
- **Retention:** Auto-purge after 7 days (configurable via `RETENTION_DAYS` env var). **Starred mail (`is_favorite = true`) is retention-exempt** — it survives past the cutoff until unstarred or explicitly deleted.
- **Attachment storage:** Uses PVC (`/data/attachments`) in k8s; size-capped at `MAX_MAIL_BYTES` (~26 MiB).
- **Block rules (拒收):** DB-backed rules (`block_rules`, address or domain incl. subdomains) drop matching mail **at portal ingest** (R2 object deleted, nothing archived). Not retroactive — **except** that blocking *from a message* in the web UI also deletes that one message (client-side `DELETE /api/mails/:id` after the rule is created; starred mail is skipped, matching its retention exemption). Not enforced in the Worker (it has no DB access and must stay lightweight). Matching target is the header `From:` with envelope fallback — same semantics as sender display.
- **API keys:** Optional `API_KEYS` env (comma-separated). When set, `/api/*` requires `X-API-Key` or `Authorization: Bearer` (timing-safe compare); `/healthz`/`/readyz`/static SPA stay open. When unset, zero behavior change. The web UI can store a key in localStorage (Settings) — it is never persisted server-side.
- **Ingest cadence (adaptive) & push signal:** The singleton ingestor polls R2 on an adaptive backoff ladder — after any pass that sees mail it re-checks in 5s, then relaxes 10s → 30s → `POLL_INTERVAL_MS` (idle ceiling, default 60s). A best-effort nudge from the Worker (`POST /api/signal`, gated by `SIGNAL_KEY`) triggers an immediate pass so new mail lands in ~1s (**Path B**); the poll is the safety net — a dropped signal just waits for the next poll (mail is buffered in R2, never lost). `SIGNAL_KEY` is **independent** of `API_KEYS`; unset hides the endpoint (404). The Worker reaches the portal over the existing frp edge (a tinyauth-free Ingress `mail-signal.test4x.com/api/signal`), not a new Cloudflare Tunnel.

## Tailwind v4 (CSS-First)

The web UI uses Tailwind v4 via `@tailwindcss/vite` plugin (not PostCSS). CSS is authored in `portal/web/src/index.css` with `@import "tailwindcss"` at the top (CSS-first approach). shadcn components are already wired for Tailwind 4; no additional configuration needed.

## Deployment

**Image:** `docker.test4x.com/xgfan/mailhub` (built by Woodpecker CI from root Dockerfile)

**Cluster:** k3s (default namespace), domain `mail.test4x.com`
- **Deployment strategy:** Singleton (Recreate for RWO PVC), auto-restart
- **Postgres:** In-cluster (least-privilege role `mailhub`, schema `mailhub`)
- **R2 storage:** Cloudflare (catch-all `@xgfan.com` + `@t4x.fun`, free egress)
- **External access:** tinyauth at ingress (LAN bypass for internal IPs)

**CI/CD:** Woodpecker (`.woodpecker.yaml`), push-mode GitOps — CI never touches the cluster:

1. `build` — image tagged `<sha8>` + `latest`, pushed to the registry.
2. `flux-bump` — writes that `<sha8>` into the app's manifest in the **infra repo** and pushes. *This step is the deployment*, so its failure must turn the pipeline red.
3. `trigger-flux` — webhook so Flux reconciles immediately instead of waiting for its 1-minute `GitRepository` poll (`failure: ignore` — a dropped webhook only costs latency).

Live pods run a concrete SHA; the `:latest` in the k8s manifest is template-only. **CI runs no tests** — cluster egress to `registry.npmjs.org` is ~1–3 KiB/s and `pnpm install` times out, so a compiling image is the only gate. Run `pnpm -r test` and the e2e suite locally before pushing.

**Manifests:** Separate infra repo (`k8s/apps/mailhub/`) — includes Deployment, Service (ClusterIP), Secret, PVC, NetworkPolicy, SOPS-encrypted secrets.

See [`docs/SETUP.md`](docs/SETUP.md) for Cloudflare setup, Email Routing, and k8s deployment details.

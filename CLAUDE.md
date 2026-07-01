# MailHub — Claude Code Guide

## Overview

MailHub is a personal email archive system. A **Cloudflare Email Worker** ingests inbound mail via Email Routing and buffers raw MIME to R2. A **self-hosted Node/TS portal** (running on k3s) drains R2, parses mail with postal-mime into Postgres, and serves a React web UI to search and read your archive. **No authentication** — the portal runs cluster-internal only (ClusterIP + NetworkPolicy) behind tinyauth at the ingress.

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
- **Retention:** Auto-purge after 7 days (configurable via `RETENTION_DAYS` env var).
- **Attachment storage:** Uses PVC (`/data/attachments`) in k8s; size-capped at `MAX_MAIL_BYTES` (~26 MiB).

## Tailwind v4 (CSS-First)

The web UI uses Tailwind v4 via `@tailwindcss/vite` plugin (not PostCSS). CSS is authored in `portal/web/src/index.css` with `@import "tailwindcss"` at the top (CSS-first approach). shadcn components are already wired for Tailwind 4; no additional configuration needed.

## Deployment

**Image:** `docker.test4x.com/xgfan/mailhub` (built by Woodpecker CI from root Dockerfile)

**Cluster:** k3s (default namespace), domain `mail.test4x.com`
- **Deployment strategy:** Singleton (Recreate for RWO PVC), auto-restart
- **Postgres:** In-cluster (least-privilege role `mailhub`, schema `mailhub`)
- **R2 storage:** Cloudflare (catch-all `@xgfan.com`, free egress)
- **External access:** tinyauth at ingress (LAN bypass for internal IPs)

**CI/CD:** Woodpecker (`.woodpecker.yaml`) builds Docker image and rolls via `kubectl set image` to prod.

**Manifests:** Separate infra repo (`k8s/apps/mailhub/`) — includes Deployment, Service (ClusterIP), Secret, PVC, NetworkPolicy, SOPS-encrypted secrets.

See [`docs/SETUP.md`](docs/SETUP.md) for Cloudflare setup, Email Routing, and k8s deployment details.

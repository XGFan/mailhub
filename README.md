# MailHub — Personal email system with Cloudflare Worker + self-hosted portal

A single-user email system: a **Cloudflare Worker** ingests inbound mail via Email Routing and buffers it in R2, and a **self-hosted portal** (running on your k8s cluster) parses the mail into Postgres and serves a quality web UI to read and search your archive.

> [!WARNING]
> **This portal has NO authentication, by design.** Anyone who can reach it can read every message — including password-reset links, magic links, and OTP codes. It must ship **cluster-internal only** (`Service: ClusterIP`, no `Ingress`/`LoadBalancer`) behind a `NetworkPolicy`. Reach it via `kubectl port-forward`, a VPN/Tailscale, or a private Cloudflare Access tunnel. **Never add a public Ingress — that makes your entire mail archive world-readable.**

## Architecture

```
Inbound mail
   │
   ▼
Cloudflare Email Routing ──► Worker email() handler        [FREE, no parsing, <10ms CPU]
                               ├─ buffer raw MIME into an ArrayBuffer
                               ├─ RAW_MAIL.put("inbox/<epochMs>-<uuid>.eml", buf,
                               │        { customMetadata: sanitized envelope to/from })
                               └─ let put() errors PROPAGATE → sender MTA retries (at-least-once)
                                          │
                                          ▼
                                    R2 bucket "mailhub-raw" 
                                    (10GB free, free egress, NO expiry on inbox/)
                                          ▲
   k8s Portal (Node/TS, SINGLETON ingestor + API) ─┘
     ├─ ingestor: poll R2 every 30s, paginated LIST → GET → size-cap → 
     │                parse in isolated worker → upsert(ON CONFLICT r2_key) → DELETE
     ├─ REST API: /api/mails (search), /api/mails/:id, /api/mails/:id/raw,
     │            /api/mails/:id/favorite (star), DELETE /api/mails/:id,
     │            /api/attachments/:id, /api/settings, /api/ingest/run
     └─ React + Tailwind + shadcn/ui  (responsive two-pane client, collapsible
        sidebar, star/delete actions) 
        ← existing k8s Postgres (least-privilege role, schema "mailhub")
```

## Confirmed decisions (from plan §3, §9, §10)

| Feature | Decision |
|---------|----------|
| **Authentication** | None — portal runs cluster-internal only (no public Ingress) |
| **Poll interval** | 30 seconds, plus manual "Fetch now" trigger |
| **Remote images** | Blocked by default, client-side opt-in (never server-side fetch) |
| **Mail retention** | Auto-purge after 7 days (configurable via `RETENTION_DAYS`); starred mail is retention-exempt |
| **Email Routing** | Dashboard-configured; receiving is free on Cloudflare's free tier |

## Repository layout

| Package | Path | What it is |
|---------|------|-----------|
| **@mailhub/shared** | `shared/src/` | Type-only API contract (MailListItem, MailDetail, SearchResponse, etc.) |
| **@mailhub/worker** | `worker/src/` | Cloudflare Worker: Email Routing → R2, TS + Wrangler |
| **@mailhub/portal-server** | `portal/server/src/` | Portal API: Hono + Drizzle + pg + postal-mime (Node/TS) |
| **@mailhub/web** | `portal/web/src/` | Portal UI: React + Vite + Tailwind + shadcn/ui |

## Prerequisites

- **Node.js** ≥ 20 (developed on v26)
- **pnpm** 11+ (`corepack enable` or install globally)
- **Docker** + **OrbStack** (for local integration: Postgres 16 + MinIO as R2 stand-in)
- **Cloudflare account** with Email Routing + R2 access (free tier sufficient)
- **k8s cluster** (for deployment; reuses existing Postgres)

## Quick start — development

### 1. Clone and install dependencies

```bash
git clone <repo>
cd mailhub
pnpm install
pnpm -r typecheck    # type-check all packages
pnpm -r build        # build packages with a build script
```

### 2. Local integration stack (Postgres + MinIO)

```bash
# Start Postgres 16 + MinIO (R2 stand-in) in Docker
docker compose -f portal/server/docker-compose.yml up -d

# Wait for services to be healthy, then create the MinIO bucket.
# Visit http://localhost:9001 (MinIO console)
#   Username: mailhub
#   Password: mailhub-secret
# Create a bucket named "mailhub-raw"
```

### 3. Portal server setup

```bash
cd portal/server

# Copy env template and fill in MinIO credentials
cp ../../.env.example .env
# Edit .env:
#   DATABASE_URL=postgres://mailhub:mailhub@localhost:5432/mailhub
#   R2_ENDPOINT=http://localhost:9000
#   R2_ACCESS_KEY_ID=mailhub
#   R2_SECRET_ACCESS_KEY=mailhub-secret
#   R2_BUCKET=mailhub-raw

# Apply database migrations
pnpm db:migrate

# Start the backend API (listens on port 8787)
pnpm dev
```

### 4. Portal web UI

In a separate terminal:

```bash
cd portal/web

# Start Vite dev server (port 5173, proxies /api to http://localhost:8787)
pnpm dev
```

Open http://localhost:5173 in your browser.

## Documentation

- **[`docs/API.md`](docs/API.md)** — REST API endpoint reference with request/response examples
- **[`docs/SETUP.md`](docs/SETUP.md)** — Cloudflare setup, Email Routing configuration, and k8s deployment
- **[`docs/COSTS.md`](docs/COSTS.md)** — Free-tier cost analysis and headroom calculations (AC9)
- **[`docs/SECURITY.md`](docs/SECURITY.md)** — Threat model, attack surface, and containment strategy
- **[`worker/README.md`](worker/README.md)** — Worker-specific development and deployment
- **[`portal/server/README.md`](portal/server/README.md)** — Portal API server setup, config, and running
- **[`portal/web/README.md`](portal/web/README.md)** — Portal web UI development and build

## Full design & acceptance criteria

See the approved plan: **[`.omc/plans/mailhub-cf-worker-portal-plan.md`](.omc/plans/mailhub-cf-worker-portal-plan.md)**

Includes:
- §1 Requirements summary
- §2 Architecture decision & alternatives
- §3 Threat model & security invariants
- §4 Acceptance criteria (AC1–AC15)
- §5 Component implementation details
- §6 Cost analysis (free-tier headroom)
- §7 Verification steps
- §8 Implementation phases

## Status

**Phases 0–4 complete**: Scaffold, Worker, R2 buffer, Portal backend (ingestor + API), Portal web, k8s deployment all implemented. Phase 5 (E2E tests + cost verification) in progress.

## Deployment

### Production environment

MailHub runs on a **homelab k3s cluster** (`mail.test4x.com`), with external access gated by **tinyauth** (LAN bypass for internal IPs).

**Image & registry:** Docker image `docker.test4x.com/xgfan/mailhub` is built by **Woodpecker CI** from the root `Dockerfile` (multi-stage: React web build → Node/TS runtime with tsx for inline parsing) and deployed to k3s via `kubectl set image`.

**Cluster resources:**
- **Deployment:** Singleton (Recreate strategy for RWO PVC), runs the portal server + ingestor + API in one process
- **Database:** Postgres in-cluster, least-privilege role `mailhub` (schema `mailhub`)
- **Storage:** 
  - **R2 (Cloudflare):** Buffers raw MIME, catch-all address `@xgfan.com`
  - **PVC:** RWO persistent volume (`/data/attachments`) for parsed attachments
- **Networking:** Service type `ClusterIP` (no public Ingress), NetworkPolicy restricts in-cluster access; reach it via `kubectl port-forward`, VPN, or Tailscale

**Deployment manifests:** Hosted in a separate infra repository (`k8s/apps/mailhub/`); includes Deployment, Service, Secret (SOPS-encrypted), PVC, NetworkPolicy. Secrets contain: Postgres `DATABASE_URL`, R2 credentials (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`), and bucket name.

**Environment variables:** See [`docs/SETUP.md`](docs/SETUP.md) for the full reference (e.g., `RETENTION_DAYS`, `MAX_MAIL_BYTES`, `POLL_INTERVAL_MS`).

### Cloudflare setup

Email Routing is configured to route catch-all (`*@yourdomain.com`) to the Worker, which buffers raw MIME in R2 (`mailhub-raw` bucket). See [`docs/SETUP.md`](docs/SETUP.md) for step-by-step Cloudflare + Email Routing + R2 setup.

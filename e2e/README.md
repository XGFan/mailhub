# MailHub full-stack E2E (`e2e/`)

Real browser end-to-end tests that drive the **whole portal** — built SPA served
by the `@mailhub/portal-server` backend (tsx, `:8787`), which ingests raw `.eml`
objects out of MinIO (the R2 stand-in) into Postgres. Nothing is mocked: mail is
seeded exactly the way the Cloudflare Worker does (S3 `PUT inbox/<epoch>-<uuid>.eml`
with envelope `to`/`from` in object metadata), pulled through the real ingestor,
and then asserted in Chromium.

This project is **self-contained** and is intentionally **not** a pnpm-workspace
member (it is absent from the root `pnpm-workspace.yaml`). It has its own
`package.json`, `node_modules`, and `package-lock.json`, and uses **npm** so it
never interferes with the monorepo's pnpm install.

## What it covers (plan ACs)

| Spec | ACs | Asserts |
|---|---|---|
| `00-ui-states` | AC12 | empty-inbox, loading skeleton, API-error states |
| `01-list-detail` | AC3, AC4 | seeded mail appears with decoded From/To/Subject/date; detail opens |
| `02-security-render` | AC6, AC6b | `iframe[sandbox=""]`; `<script>` never runs; inline `cid:` image renders; tracker gets **zero** hits by default; enabling remote images loads them client-side |
| `03-search` | AC5, AC12 | search by recipient / sender / subject (case-insensitive); no-results state |
| `04-attachments` | AC7 | `/api/attachments/:id` + raw `.eml` are forced downloads (`Content-Disposition: attachment`, `application/octet-stream`, `nosniff`) |
| `05-keyboard-responsive` | AC13 | ↑/↓ + Enter navigation; two-pane ≥1024px vs single-pane <1024px with Back |
| `06-favorites-delete` | — | star/unstar from the reading pane; the Starred list filter; delete via the confirm dialog |
| `07-sender-list` | — | header `From:` (not the envelope bounce address) is displayed, envelope surfaced as Return-Path; mail-list collapse/expand + resize (desktop), single-pane phone |

## Latest result

Run against the real stack (Postgres + MinIO + backend + built SPA, Chromium):
all assertions pass, including the AC6b opt-in remote-images test (remote images
load client-side when enabled). The process exits 0.

## Requirements

- Node ≥ 20, **pnpm** (to build the web SPA + run the backend), **npm** (for this project).
- **Docker** via OrbStack (Postgres + MinIO come up automatically).
- The monorepo dependencies installed (`pnpm install` at the repo root).

## Run

```bash
cd e2e
npm install
npx playwright install chromium
npm test              # or: npx playwright test
```

`npm test` orchestrates everything through Playwright's global setup:

1. recreates a clean Postgres + MinIO (`docker compose -p mailhub-e2e`, fresh volumes),
2. creates the `mailhub-raw` bucket,
3. runs the portal DB migrations (`pnpm --filter @mailhub/portal-server db:migrate`),
4. builds the SPA (`pnpm --filter @mailhub/web build` → `portal/web/dist`),
5. starts the out-of-band remote-image tracker,
6. starts the backend (`pnpm --filter @mailhub/portal-server start`) on `:8787`,
   which serves the SPA same-origin (Playwright `baseURL`).

Teardown stops the tracker and removes the docker stack.

> Teardown is clean: the backend now has a `pg` pool `error` handler
> (`portal/server/src/db/client.ts`), so dropping Postgres during teardown logs a
> single line instead of crashing. Use `E2E_KEEP_STACK=1` to leave the stack up.

### Ports (non-default, to avoid collisions)

| Service | Host port |
|---|---|
| Portal backend + SPA | `8787` |
| Postgres | `5433` |
| MinIO (S3 / console) | `9100` / `9101` |
| Remote-image tracker | `8123` |

### Useful env toggles (faster iteration / debugging)

- `E2E_SKIP_DOCKER=1` — reuse an already-running stack (skips down/up; also skips teardown).
- `E2E_SKIP_WEB_BUILD=1` — reuse an existing `portal/web/dist`.
- `E2E_REUSE_SERVER=1` — reuse an already-running backend on `:8787`.
- `E2E_KEEP_STACK=1` — leave Postgres/MinIO up after the run for inspection.

```bash
npx playwright test 03-search           # one file
npx playwright test --headed            # watch it drive the browser
npx playwright show-report              # HTML report
```

## AC6b remote-images — RESOLVED

An earlier run of this suite surfaced that "show remote images" was
non-functional (the sanitizer dropped remote `<img>` URLs, and the
response-header CSP was inherited into the `srcdoc` iframe and blocked images
regardless of the meta CSP). **Fixed:** the sanitizer now preserves remote
`http(s)` `<img>` URLs and the iframe CSP gates loading — default `img-src data:`
(zero remote requests, no tracking-pixel leak), opt-in widens to
`data: https: http:` (client-side only). `<script>` is still blocked by
`sandbox=""` in both modes. The `02-security-render` opt-in test is now a normal
passing assertion (no `test.fail()`).

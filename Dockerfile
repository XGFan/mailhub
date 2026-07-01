# syntax=docker/dockerfile:1
#
# MailHub portal image (plan §5.6). Builds the React SPA (portal/web) and
# ships the portal server (portal/server) — REST API + singleton ingestor +
# auto-purge, all in one process, run via `tsx` straight from source (the
# ingestor's isolated-parse worker_thread loads a .ts file at runtime, so tsx
# must be present in the image, not just used to build it).
#
# No app auth (by design — see README/plan §3): this image is meant to run
# ClusterIP-only behind a NetworkPolicy (see deploy/k8s). Never front it with
# a public Ingress.

FROM node:26-alpine AS base
# Pin pnpm to the workspace's packageManager version directly, instead of
# relying on corepack (avoids any ambiguity about corepack's bundling state
# across Node versions).
RUN npm install -g pnpm@11.9.0
WORKDIR /app

# -----------------------------------------------------------------------------
# web-builder — install + build only @mailhub/web (React/Vite/Tailwind SPA).
# Kept in its own install so the runner never carries vite/tailwind/
# lucide-react's node_modules (~60MB of build-only tooling, unused at
# runtime). pnpm --filter walks the dependency graph, so worker/'s heavy
# wrangler/miniflare/workerd devDependencies are never fetched either way.
# pnpm-workspace.yaml's allowBuilds already disables the esbuild/sharp
# postinstall scripts (their prebuilt binaries ship via optionalDependencies),
# so no extra --ignore-scripts handling is needed here.
# -----------------------------------------------------------------------------
FROM base AS web-builder
COPY . .
# `pnpm store prune` in the same layer as the install: otherwise the global
# content-addressable store (hardlinked into node_modules) gets committed to
# the layer as a second, un-deduped copy of every package (roughly doubling
# its apparent size).
RUN pnpm install --frozen-lockfile --filter "@mailhub/web..." \
      && pnpm store prune
RUN pnpm --filter @mailhub/web build

# -----------------------------------------------------------------------------
# runner — install only @mailhub/portal-server's own dependency graph
# (pnpm's node_modules symlinks are relative and self-contained under /app, so
# they survive being built directly in this stage), copy in the SPA built
# above, drop root, and run the server via tsx (the ingestor's isolated-parse
# worker_thread loads a .ts file at runtime, so tsx must ship in the image).
# -----------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=8787 \
    ATTACHMENT_DIR=/data/attachments

# Fixed UID/GID so k8s securityContext (runAsUser/fsGroup) can match exactly.
RUN addgroup -g 10001 -S mailhub \
    && adduser -u 10001 -S -G mailhub -h /home/mailhub mailhub \
    && mkdir -p /data/attachments /home/mailhub \
    && chown -R mailhub:mailhub /data /home/mailhub /app

# Own the source before installing (COPY --chown, not a post-hoc `chown -R` —
# the latter forces an overlayfs copy-up of every file into a new layer,
# roughly doubling image size for no reason) and install as the runtime user
# from the start so node_modules never needs a root->mailhub ownership pass.
COPY --chown=mailhub:mailhub . .
USER mailhub
ENV HOME=/home/mailhub
RUN pnpm install --frozen-lockfile --filter "@mailhub/portal-server..." \
      && pnpm store prune
COPY --from=web-builder --chown=mailhub:mailhub /app/portal/web/dist ./portal/web/dist

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# All runtime config (DATABASE_URL, R2_*, POLL_INTERVAL_MS, ATTACHMENT_DIR,
# MAX_MAIL_BYTES, RETENTION_DAYS, PORT) comes from the environment — see
# .env.example / deploy/k8s/secret.example.yaml.
CMD ["pnpm", "--filter", "@mailhub/portal-server", "start"]

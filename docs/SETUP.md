# MailHub Deployment & Setup Guide

This guide covers Cloudflare Worker setup, Email Routing configuration, and k8s deployment.

## Cloudflare Worker setup

### 1. Create the R2 bucket

In the Cloudflare dashboard:

1. Go to **Storage > R2** and create a bucket named `mailhub-raw`
2. Choose any region (data residency preference)
3. Leave all settings at default

### 2. Create an R2 API token (for the portal backend)

1. Go to **R2 > API Tokens** and click **Create API token**
2. **Token name:** `mailhub-portal` (or any descriptive name)
3. **Access level:** `Object Read/Write`
4. **Bucket scope:** Limit to `mailhub-raw` (essential for least-privilege)
5. **TTL:** Indefinite (or your preferred rotation schedule)

Save the credentials (Access Key ID, Secret Access Key). You'll need them for the portal's `.env`.

### 3. Deploy the Worker

```bash
cd worker

# Set up wrangler
pnpm install

# (optional) Create a wrangler.toml if not present, or verify the existing one has:
# [env.production]
# vars = { ENVIRONMENT = "production" }

# Deploy to Cloudflare
pnpm deploy
```

The output will show your Worker URL. Note the domain.

### 4. Configure Email Routing

In the Cloudflare dashboard, under your domain:

1. Go to **Email > Email Routing**
2. **Enable** Email Routing for your domain
3. Add a **catch-all rule**:
   - **Match:** `*` (catch all incoming mail to any address on your domain)
   - **Route to:** Select **Worker** and choose the `mailhub` Worker you just deployed
   - **Save**

Email Routing is free on Cloudflare; you only pay for Worker invocations, which are covered by the free tier.

Once configured, mail sent to any address on your domain (`anything@yourdomain.com`) will be routed to your Worker, buffered in R2, and polled by the portal.

---

## Portal backend deployment

### Local development (see [README.md](../README.md) for quickstart)

For production k8s deployment, follow the section below.

---

## Kubernetes deployment

### Prerequisites

- K8s cluster with **persistent storage** (RWO PVC for attachment files)
- **Existing Postgres** database + a dedicated least-privilege role (schema `mailhub`)
- **OrbStack** or similar to run Docker commands (for building the image)

### 1. Prepare the Postgres database

On your k8s Postgres instance, create the least-privilege role:

```sql
-- As a superuser:
CREATE ROLE mailhub WITH LOGIN PASSWORD 'a-strong-password';
CREATE SCHEMA mailhub;
GRANT USAGE ON SCHEMA mailhub TO mailhub;
GRANT CREATE ON SCHEMA mailhub TO mailhub;
-- Grant all privileges on future tables in the schema:
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA mailhub 
  GRANT ALL ON TABLES TO mailhub;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA mailhub 
  GRANT ALL ON SEQUENCES TO mailhub;
```

(Refer to `deploy/sql/role.sql` in the repository for the definitive script.)

Save the password — you'll use it in the k8s `Secret`.

### 2. Build and push the Docker image

The portal is a multi-stage build (React web → bundle into Node/TS backend):

```bash
# From the repo root:
docker build -f Dockerfile -t mailhub:v1 .
# Then push to your registry, or use docker load if running on the same host
```

### 3. Create the k8s manifests

Create or use the provided manifests in `deploy/k8s/` (adjust image tag and resource requests):

**Namespace (optional):**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: mailhub
```

**Secret** (stores Postgres URL and R2 credentials):
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mailhub-secrets
  namespace: mailhub
type: Opaque
stringData:
  database-url: "postgres://mailhub:STRONG-PASSWORD@postgres.default.svc.cluster.local:5432/mailhub"
  r2-endpoint: "https://xxxxx.r2.cloudflarestorage.com"
  r2-access-key-id: "YOUR-ACCESS-KEY-ID"
  r2-secret-access-key: "YOUR-SECRET-KEY"
  r2-bucket: "mailhub-raw"
```

**PersistentVolumeClaim** (for attachment storage, RWO):
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mailhub-attachments
  namespace: mailhub
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
```

**Deployment** (singleton, `Recreate` strategy for RWO PVC):
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mailhub
  namespace: mailhub
spec:
  replicas: 1
  strategy:
    type: Recreate  # Required for RWO PVC
  selector:
    matchLabels:
      app: mailhub
  template:
    metadata:
      labels:
        app: mailhub
    spec:
      containers:
      - name: mailhub
        image: mailhub:v1
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 8787
          name: http
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: mailhub-secrets
              key: database-url
        - name: R2_ENDPOINT
          valueFrom:
            secretKeyRef:
              name: mailhub-secrets
              key: r2-endpoint
        - name: R2_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: mailhub-secrets
              key: r2-access-key-id
        - name: R2_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: mailhub-secrets
              key: r2-secret-access-key
        - name: R2_BUCKET
          valueFrom:
            secretKeyRef:
              name: mailhub-secrets
              key: r2-bucket
        - name: POLL_INTERVAL_MS
          value: "60000"
        - name: ATTACHMENT_DIR
          value: "/data/attachments"
        - name: MAX_MAIL_BYTES
          value: "27262976"
        - name: RETENTION_DAYS
          value: "7"
        volumeMounts:
        - name: attachments
          mountPath: /data/attachments
        livenessProbe:
          httpGet:
            path: /healthz
            port: http
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /readyz
            port: http
          initialDelaySeconds: 5
          periodSeconds: 10
          # kubelet's default probe timeout is 1s; /readyz can touch R2 over the
          # public internet, so widen it to avoid false NotReady on a slow blip.
          timeoutSeconds: 5
      volumes:
      - name: attachments
        persistentVolumeClaim:
          claimName: mailhub-attachments
```

**Service** (ClusterIP only — no public Ingress):
```yaml
apiVersion: v1
kind: Service
metadata:
  name: mailhub
  namespace: mailhub
spec:
  type: ClusterIP
  selector:
    app: mailhub
  ports:
  - port: 80
    targetPort: http
    name: http
```

**NetworkPolicy** (restricts in-cluster access; adjust as needed):
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mailhub-restrict
  namespace: mailhub
spec:
  podSelector:
    matchLabels:
      app: mailhub
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: mailhub  # Allow from same namespace
    ports:
    - protocol: TCP
      port: 8787
```

### 4. Deploy to the cluster

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/secret.yaml
kubectl apply -f deploy/k8s/pvc.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
kubectl apply -f deploy/k8s/network-policy.yaml

# Verify the Pod is running:
kubectl get pods -n mailhub
kubectl logs -n mailhub -f deployment/mailhub
```

### 5. Port-forward for local access

```bash
kubectl port-forward -n mailhub svc/mailhub 8080:80
# Portal is now accessible at http://localhost:8080
```

### Access via VPN or Tailscale (recommended for production)

Instead of `kubectl port-forward`, use a VPN:
- **Tailscale:** Run Tailscale in your cluster; access the Service by its in-cluster DNS name
- **Personal VPN:** Set up a bastion host or IPSec tunnel to your cluster network

**Never expose the portal with a public Ingress or LoadBalancer** — there is no authentication.

---

## Environment variables (reference)

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (least-privilege role) |
| `R2_ENDPOINT` | Yes | — | R2 S3-compatible endpoint (e.g., `https://xxxxx.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` | Yes | — | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | Yes | — | R2 API token secret key |
| `R2_BUCKET` | No | `mailhub-raw` | R2 bucket name |
| `PORT` | No | `8787` | HTTP listen port |
| `POLL_INTERVAL_MS` | No | `60000` | Ingestor idle poll ceiling (ms) — top of the adaptive backoff ladder |
| `ATTACHMENT_DIR` | No | `./data/attachments` | Where attachment bytes are stored (PVC path in k8s) |
| `MAX_MAIL_BYTES` | No | `27262976` (~26 MiB) | Reject raw messages larger than this |
| `RETENTION_DAYS` | No | `7` | Auto-purge mail older than this many days |
| `API_KEYS` | No | — | Comma-separated keys gating `/api/*` (unset = open) |
| `SIGNAL_KEY` | No | — | Shared secret gating `POST /api/signal` (unset = hidden) |

---

## Database initialization

The portal runs Drizzle migrations on startup (best-effort; the API still comes up if the DB is briefly unavailable). Migrations include:

- `mails` table with `r2_key` unique constraint (idempotency anchor)
- `attachments` table with cascade delete
- `settings` table (single-row, client config)
- GIN indexes on `to_addr`, `from_addr`, `subject` (full-text search via `pg_trgm`)
- B-tree indexes on `date DESC`, `received_at DESC` (ordering)

If migrations fail, manually run:

```bash
pnpm --filter @mailhub/portal-server db:migrate
```

---

## R2 lifecycle policy (optional)

By default, the portal keeps the `inbox/` prefix empty (deletes after ingest). Optionally, configure an R2 lifecycle rule to auto-delete `dead/` (failed-parse bucket) after 30–90 days:

1. Go to **R2 > mailhub-raw > Settings > Lifecycle rules**
2. Add a rule:
   - **Prefix:** `dead/`
   - **Delete after:** 30 days (or your preference)

This prevents the dead-letter bucket from accumulating indefinitely.

---

## Monitoring & observability

The portal exposes:
- `/healthz` — liveness (always 200)
- `/readyz` — readiness: 200 when Postgres is reachable, 503 otherwise. R2 is probed too but reported non-fatally in `checks.r2` (see API.md).

For production, integrate these with your monitoring stack:
- **Metrics:** ingest lag, pending-object count/age, dead-letter count, parse failures
- **Alerts:** oldest pending mail age > some threshold (indicates stuck ingestor or R2 outage)

---

## Troubleshooting

**Deployment stuck in `CrashLoopBackOff`:**
- Check logs: `kubectl logs -n mailhub -f deployment/mailhub`
- Likely causes: bad `DATABASE_URL`, unreachable Postgres, bad R2 credentials

**Mail not appearing in the UI after 30 seconds:**
- Check `/readyz` — is `checks.r2` true? (R2 is reported there but no longer fails readiness.)
- Check the `dead/` bucket in R2 — is there a parse error?
- Manually trigger ingest: `POST /api/ingest/run` (via curl or the UI "Fetch now" button)

**Attachment storage growing too large:**
- Check PVC usage: `kubectl exec -n mailhub -it pod/mailhub-xxx -- df -h /data/attachments`
- Increase PVC size or lower `RETENTION_DAYS`

---

## Next steps

1. **Enable remote image tracking (optional):** Create a per-mail UI toggle or portal setting to fetch remote images client-side (never server-side to avoid SSRF)
2. **Scale the API (future):** Split the stateless API from the singleton ingestor using leader election or a separate ingestor deployment
3. **Backup attachments:** Configure S3 backups or a daily export of the Postgres schema

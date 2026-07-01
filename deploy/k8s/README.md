# MailHub k8s manifests

> [!WARNING]
> **⚠️ No Ingress by design.** The portal has no application authentication
> (see the repo README / plan §3) — anyone who can reach the Service reads
> your entire mail archive, including password-reset links, magic links, and
> OTP codes. These manifests deliberately ship **no `Ingress`**, and
> `deploy/lint.mjs` fails the build if one ever gets added.
>
> Access the portal via `kubectl port-forward`, a private VPN/Tailscale, or
> an optional Cloudflare Access tunnel — **never** put a public Ingress or a
> `LoadBalancer` Service in front of it.

## Contents

| File | Purpose |
| --- | --- |
| `namespace.yaml` | `mailhub` namespace |
| `deployment.yaml` | Singleton Deployment (`replicas: 1`, `strategy: Recreate` — see file comment for why) |
| `service.yaml` | `ClusterIP` Service — the only way in |
| `pvc.yaml` | RWO PVC for attachments (`ATTACHMENT_DIR`) |
| `networkpolicy.yaml` | Default-deny ingress to the pod except from a labeled source |
| `secret.example.yaml` | Template for `DATABASE_URL` + `R2_*` + runtime config — **not real values, do not apply as-is** |
| `kustomization.yaml` | Optional `kubectl apply -k deploy/k8s` bundle (excludes the secret template) |

## Deploy

1. Create the least-privilege DB role/database: run `deploy/sql/role.sql`
   against your existing Postgres cluster (as an admin).
2. Build and push the image (repo-root `Dockerfile`) to a registry your
   cluster can pull from, and update `deployment.yaml`'s `image:`.
3. Create the real Secret (do not commit it):
   ```bash
   kubectl create namespace mailhub
   kubectl create secret generic mailhub-secrets -n mailhub \
     --from-literal=DATABASE_URL='postgres://mailhub:<password>@<host>:5432/mailhub' \
     --from-literal=R2_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com' \
     --from-literal=R2_ACCESS_KEY_ID='<key>' \
     --from-literal=R2_SECRET_ACCESS_KEY='<secret>' \
     --from-literal=R2_BUCKET='mailhub-raw' \
     --from-literal=PORT='8787' \
     --from-literal=POLL_INTERVAL_MS='30000' \
     --from-literal=ATTACHMENT_DIR='/data/attachments' \
     --from-literal=MAX_MAIL_BYTES='27262976' \
     --from-literal=RETENTION_DAYS='7'
   ```
   Prefer etcd encryption or SealedSecrets/an external-secrets operator over
   plain `Secret` objects where your cluster supports it (plan §3 invariant 4).
4. Label whatever namespace/network path you'll actually reach the portal
   from so `networkpolicy.yaml` allows it (see that file's comments).
5. `kubectl apply -k deploy/k8s` (or apply the individual files, minus
   `secret.example.yaml`).
6. Verify: `node deploy/lint.mjs` before every apply (also runnable as
   `npm run lint --prefix deploy`) — fails the build if a public-exposure
   resource (`Ingress` / `LoadBalancer`) ever sneaks in.

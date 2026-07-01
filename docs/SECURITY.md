# MailHub Security & Threat Model

## Threat Model (from plan §3)

**Single-user personal email system.** The archive holds:
- Password-reset links
- Magic links for account recovery
- 2FA/OTP codes
- Sensitive correspondence

**Attack surface:** An attacker who can **read** your mail archive gains access to password-reset tokens, 2FA codes, and potentially compromises every account tied to your email address.

**Your choice:** **No application authentication.** This means:
- Anyone who can reach the portal can read all mail
- Containment relies on **network-level isolation** (cluster-internal deployment, no public Ingress)
- Every message in your archive is considered **sensitive**

---

## Hard Invariants (must hold before shipping)

### 1. No public Ingress by default

**Requirement:** The portal ships **cluster-internal only** — `Service: ClusterIP`, no `Ingress` or `LoadBalancer` manifest.

**Why:** With no app auth, a public Ingress makes your entire archive world-readable.

**Enforcement:**
- k8s manifests in `deploy/k8s/` define only `Service: ClusterIP`
- A lint test asserts no `Ingress` or `LoadBalancer` exists
- Access is via `kubectl port-forward`, VPN, Tailscale, or a private Cloudflare Access tunnel

**Never add a public Ingress. That makes your mail archive world-readable.**

### 2. Remote content is blocked by default

**Requirement:** HTML mail rendering does not fetch remote resources (images, tracking pixels) by default.

**Why:** Fetching a remote image leaks your IP address (and mail reader behavior) to the sender or a tracker.

**Implementation:**
- Server sanitization (§ "HTML sanitization" below) removes `<script>`, `<style>`, `<form>`, inline `url()`, etc.
- The **iframe CSP** (`img-src data:`) — not URL stripping — is what blocks remote images by default: the sanitizer **preserves** the remote `<img src="http(s)://...">` URL, but the reading-pane iframe's CSP stops the browser from ever requesting it, so no network hit / IP leak occurs. Keeping the URL is what makes the opt-in below possible.
- Remote CSS `url()` is stripped (all inline CSS is removed)
- Inline `cid:` images (from the email) are converted to `data:` URIs and embedded
- **Portal setting** (`showRemoteImages`, `/api/settings`) can opt-in to fetch remote images **client-side only** (never server-side):
  - When enabled, the iframe CSP widens to `img-src data: https: http:`, so `<img src="http(s)://...">` renders in the browser
  - Browser leaks the reader's IP (same as opening the email in Gmail), but no server-side SSRF
  - Per-mail one-off "load images" toggle also available

### 3. Attachments are never executable in-origin

**Requirement:** Attachments download forced (never inline), with `nosniff` header.

**Why:** Inline SVG or HTML can execute JavaScript in the origin context.

**Implementation:**
- All attachments served with `Content-Type: application/octet-stream` (never the original MIME type)
- `Content-Disposition: attachment; filename="..."` forces download
- `X-Content-Type-Options: nosniff` prevents browser MIME-sniffing
- Inline SVG and HTML are never served inline (always download)
- Inline raster images (PNG, JPEG) from the email's HTML are extracted and converted to `data:` URIs
- Attachment filenames are sanitized (CR/LF/null stripped, non-ASCII converted)

### 4. Least privilege

**Requirement:** Dedicated, narrowly-scoped credentials at every layer.

**Implementation:**
- **Postgres:** Dedicated `mailhub` role, limited to the `mailhub` schema (see `deploy/sql/role.sql`)
- **R2 API token:** Scoped to `Get`/`List`/`Delete`/`Put` on the single bucket `mailhub-raw` only (not account-wide)
- **Worker:** No explicit credentials (uses R2 binding, which is scoped by Cloudflare's runtime)
- **Secrets:** Encrypted at rest (k8s etcd encryption, SealedSecrets, or similar); mounted as files, not environment variables (where possible)
- **RBAC:** k8s deployment runs as non-root, restricted ServiceAccount

### 5. No server-side fetch of attacker URLs

**Requirement:** No SSRF surface (server never fetches attacker-controlled URLs).

**Why:** An SSRF endpoint can be exploited to probe internal infrastructure (RFC 1918 addresses, `169.254.169.254` metadata, etc.).

**Implementation:**
- Worker does not forward requests or fetch URLs
- `postal-mime` parser does not fetch URLs
- Remote image rendering is **client-side only** (user's browser, not the server)
- No remote-image proxy endpoint on the backend

---

## Security hardening details

### HTML sanitization

The server sanitizes HTML **before** rendering it to the client (defense in depth):

**Libraries:** `sanitize-html` (server-side, Node.js native — no DOM/fetch surface)

**Stripping rules:**
- **Tags removed:** `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<base>`, `<link>`, `<meta>`
- **Link (`<a>`) schemes allowed:** `https`, `mailto` only (`http` and `javascript:` are dropped from links)
- **Image (`<img>`) schemes allowed:** `https`, `http`, `cid` (inline image references), `data` (embedded images). Remote `http(s)` URLs are **kept** so they can be loaded client-side on opt-in; the default block is enforced by the iframe CSP, not by removing the URL. `javascript:`, `vbscript:`, `data:text/html` and protocol-relative `//host` are still dropped.
- **Attributes:** `style`, `onerror`, `onload`, etc. stripped (event handlers removed)
- **CSS `url()`:** All `url()` expressions removed (they can reference remote resources or javascript:)

**Result:** Sanitized HTML is safe to render in a sandboxed `<iframe>`.

### Client-side rendering (iframe sandboxing)

The frontend renders sanitized HTML in a **sandboxed `<iframe>`** with CSP:

```html
<iframe
  sandbox=""
  srcdoc="<html><head><meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\"></head><body><!-- sanitized HTML --></body></html>"
  referrerpolicy="no-referrer"
></iframe>
```

**Sandbox restrictions:**
- `allow-same-origin` is NOT set (sandboxed frame cannot access parent window or cookies)
- `allow-scripts` is NOT set (inline scripts cannot execute)
- `allow-top-navigation` is NOT set (frame cannot navigate parent)

**CSP inside the iframe:**
- `default-src 'none'` — blocks all by default
- `img-src data:` — allows embedded `data:` URIs (inline images)
- `style-src 'unsafe-inline'` — allows inline `<style>` tags (necessary for email formatting)
- Remote `https://` images are blocked by default (see "remote content blocked" above)

**Result:** Even if sanitization misses something, the sandbox + CSP prevent script execution.

### Attachment storage path safety

**Requirement:** Attachments are stored under `ATTACHMENT_DIR` with server-generated UUID paths, never at user-provided paths.

**Implementation:**
```typescript
// Pseudo-code from the ingestor
const attachmentPath = path.join(ATTACHMENT_DIR, uuid.v4()); // e.g., /data/attachments/550e8400-e29b...
// Write attachment bytes to this path
// Always validate: path.resolve(attachmentPath) must start with ATTACHMENT_DIR
const resolved = path.resolve(attachmentPath);
if (!resolved.startsWith(ATTACHMENT_DIR + path.sep)) {
  throw new Error('path traversal prevented');
}
```

**Why:** Filenames like `../../etc/passwd` or `../../../root/.ssh/id_rsa` cannot escape the attachment directory.

### Parsing isolation & DoS protection

**Requirement:** Malicious MIME cannot crash or hang the portal.

**Implementation:**
- **Isolated parse:** Email parsing runs in a **separate `worker_thread` / child process** with:
  - **Memory limit:** `--max-old-space-size=256` (or configurable)
  - **Timeout:** 5 seconds (configurable)
  - **Killed on timeout:** Process is forcefully terminated; mail moves to `dead/` bucket (no poison loop)
- **Size cap:** Messages larger than `MAX_MAIL_BYTES` (~26 MiB) are rejected before parsing
- **No parser fetch:** `postal-mime` (the MIME library) does not fetch URLs or make network calls

**Why:** A crafted MIME bomb (deeply nested multipart, huge headers) cannot make the ingestor unresponsive.

### Search validation & SQL injection prevention

**Requirement:** User searches cannot execute arbitrary SQL.

**Implementation:**
- **Parameterized queries:** All searches use Drizzle ORM's parameterized query builder (no raw SQL)
- **Field validation:** The `field` parameter is validated against an enum (`{all, to, from, subject}`) before use
- **LIKE escaping:** The query substring has LIKE metacharacters (`%`, `_`) escaped, so users can search for literal `%` without regex behavior
- **Limit validation:** `page` and `pageSize` are parsed as integers and bounded (1–1,000,000 pages, 1–100 items/page)

**Example (Drizzle):**
```typescript
const where = and(
  or(
    ilike(mails.toAddr, `%${escapeLike(q)}%`),
    ilike(mails.fromAddr, `%${escapeLike(q)}%`),
    ilike(mails.subject, `%${escapeLike(q)}%`),
  ),
  eq(mails.isSpam, includeSpam ? false : true),
);
const results = db.select().from(mails).where(where);
```

### Response headers

All responses carry security headers (set globally in the middleware):

```
Content-Security-Policy: default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

**Why:**
- **CSP:** Prevents XSS — `default-src 'self'` keeps scripts first-party (no inline/remote JS). `img-src` and `style-src` are relaxed because the reading-pane iframe uses `srcdoc`, which **inherits** this policy (intersected with its own `<meta>` CSP); they must permit inline `data:` images and inline reading-pane CSS or the iframe's meta CSP could never gate remote images. Remote-image gating still happens in that meta CSP (default `img-src data:` blocks remote by intersection; opt-in widens it). Untrusted mail is confined to the sandboxed iframe, so the relaxed `img-src` is not a tracking vector for the app itself.
- **X-Frame-Options:** Prevents clickjacking (the entire app cannot be framed by another origin)
- **X-Content-Type-Options:** Prevents MIME-sniffing attacks
- **Referrer-Policy:** Doesn't leak the portal URL to external links

### Least-privilege Postgres role

The portal connects to Postgres as a dedicated role with minimal permissions:

```sql
CREATE ROLE mailhub WITH LOGIN PASSWORD 'strong-password';
CREATE SCHEMA mailhub;
GRANT USAGE ON SCHEMA mailhub TO mailhub;
GRANT CREATE ON SCHEMA mailhub TO mailhub;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA mailhub 
  GRANT ALL ON TABLES TO mailhub;
```

**Scope:** The `mailhub` role can only:
- Create and manage tables in the `mailhub` schema
- Cannot access other schemas
- Cannot create users or roles
- Cannot access system tables

### R2 bucket-scoped credentials

The portal's R2 API token is scoped to:

```
Get, List, Delete, Put on bucket "mailhub-raw" only
```

**Cannot:**
- Access other buckets
- Create/delete buckets
- List IAM tokens or accounts
- Perform account-level operations

**Rotation:** Store in a k8s Secret; rotate the token on leak. The Worker uses its R2 **binding** (platform-managed, no explicit credentials needed).

---

## Email authentication (SPF/DKIM/DMARC)

The portal extracts the `Authentication-Results` header from each mail (set by Cloudflare's Email Routing) to flag likely spam:

```
Authentication-Results: example.com; spf=pass; dkim=pass; dmarc=pass
```

**Spam flagging:** If any check fails, the mail is marked `is_spam = true`. The UI hides spam by default with a toggle.

**Why:** SPF/DKIM/DMARC are industry-standard checks; a failed check indicates the mail may be spoofed.

**Limitations:** These checks are not foolproof (phishing can still pass all checks if the sender is compromised).

---

## Idempotency & integrity

**Requirement:** Reprocessing the same mail twice (crash between store and delete in the ingestor) does not create duplicate rows.

**Implementation:** The `r2_key` (R2 object key) is a **UNIQUE constraint** in Postgres. On reprocess:

```sql
INSERT INTO mails (r2_key, ...) VALUES ('inbox/1688...-uuid.eml', ...)
  ON CONFLICT (r2_key) DO NOTHING;
```

Only the first insert succeeds; duplicates are silently skipped.

**Why:** The ingestor may crash between writing the DB row and deleting the R2 object. Idempotency guarantees exactly-once semantics.

---

## Known limitations

1. **No app-level auth:** Every message is readable to anyone with network access. Mitigated by cluster-internal deployment only.
2. **Email header spoofing:** Headers like `From`, `To`, `Subject` can be spoofed by the sender. Mitigated by displaying the `Authentication-Results` header and using `toAddr` (envelope recipient) as the search anchor.
3. **Email parsing bugs:** Complex MIME structures (especially older, malformed emails) may not parse correctly. Failed parses move to the `dead/` bucket (visible in R2 console, not surfaced in the UI).
4. **PVC encryption at rest:** Attachments are stored on disk; the PVC is unencrypted by default. Mitigated by encrypting the PVC using your cluster's etcd encryption or a LUKS/dm-crypt layer.
5. **Metadata leaks:** The `Authentication-Results` header (SPF/DKIM/DMARC) may reveal sender infrastructure. Not a practical risk for a personal archive.

---

## Deployment checklist

Before shipping to production:

- [ ] **NetworkPolicy deployed** restricting access to the mailhub namespace
- [ ] **Service is `ClusterIP` only** (no Ingress or LoadBalancer manifest)
- [ ] **R2 API token is bucket-scoped** (not account-wide)
- [ ] **Postgres role is schema-scoped** (not superuser or account-wide)
- [ ] **PVC encryption enabled** (or document that attachments are unencrypted)
- [ ] **Secrets are encrypted at rest** (etcd encryption or SealedSecrets)
- [ ] **Monitoring alerts configured** for ingest lag and R2 errors
- [ ] **Access method documented** (VPN, Tailscale, port-forward, etc.)
- [ ] **`RETENTION_DAYS` configured** (default 7 days is reasonable)
- [ ] **Backup strategy in place** (export Postgres schema weekly or similar)

---

## Incident response

**If compromised (attacker has read access):**

1. Assume all mail is leaked. Contact your account providers (change passwords, enable new 2FA tokens).
2. Rotate Postgres password and R2 API token immediately.
3. Review access logs (k8s audit logs, Cloudflare WAF logs) to determine attack window.
4. Redeploy the portal with new credentials.
5. Consider purging the mail archive and starting fresh (if older mail retention is not critical).

**If Worker is compromised (e.g., due to Wrangler config leak):**

1. Redeploy the Worker with a clean build.
2. Rotate R2 bucket (delete `mailhub-raw`, create a new bucket).
3. Update portal's R2 credentials.

---

## Further reading

- **Approved plan:** [`.omc/plans/mailhub-cf-worker-portal-plan.md`](.omc/plans/mailhub-cf-worker-portal-plan.md) (§3 Threat Model)
- **OWASP Top 10:** [https://owasp.org/www-project-top-ten/](https://owasp.org/www-project-top-ten/)
- **CWE-79 (XSS):** Mitigated by sanitization + iframe sandbox + CSP
- **CWE-22 (Path traversal):** Mitigated by UUID storage paths + validation
- **CWE-89 (SQL injection):** Mitigated by parameterized queries
- **CWE-918 (SSRF):** Mitigated by blocking server-side remote fetches

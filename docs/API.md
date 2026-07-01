# MailHub REST API Reference

Base URL: `http://localhost:8787` (or your portal's internal address)

All responses carry these security headers:
- `Content-Security-Policy: default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

## Health & readiness

### GET `/healthz`
Liveness probe (always returns 200).

**Response:**
```json
{ "ok": true }
```

---

### GET `/readyz`
Readiness probe: checks Postgres + R2 connectivity.

**Response:**
```json
{
  "ok": true,
  "checks": {
    "db": true,
    "r2": true
  }
}
```

Status code is **200** if all checks pass, **503** otherwise.

---

## Mail search & listing

### GET `/api/mails`

Search or list mail with pagination and optional filtering.

**Query parameters:**
| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `q` | string | (empty) | Free-text substring; case-insensitive; LIKE wildcards (`%`/`_`) are escaped |
| `field` | `'all'` \| `'to'` \| `'from'` \| `'subject'` | `'all'` | Which field to search; `'all'` ORs across to/from/subject |
| `page` | integer | 1 | 1-based page number |
| `pageSize` | integer | 50 | Items per page; bounded to max 100 |
| `includeSpam` | boolean | false | Include messages marked as spam (via SPF/DKIM/DMARC check) |

**Response:**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "fromAddr": "alice@example.com",
      "fromName": "Alice Smith",
      "toAddr": "me@mydomain.com",
      "subject": "Meeting tomorrow at 3pm",
      "snippet": "Hi, can we confirm the meeting tomorrow? I'd like to…",
      "date": "2026-07-01T14:30:00.000Z",
      "receivedAt": "2026-07-01T14:32:15.123Z",
      "hasAttachments": true,
      "isSpam": false
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 127
}
```

**Notes:**
- Results ordered by `date DESC` (parsed header date), falling back to `receivedAt DESC` if header date is missing
- `date` may be null (unparseable or absent); `receivedAt` is always present
- `toAddr` is the **envelope recipient** (what the address actually received) — authoritative for searches
- `snippet` is the first ~140 characters of the text body, HTML-stripped and whitespace-collapsed
- Rate limited to 30 requests per 10 seconds per client

**Errors:**
- **400** — invalid query parameters (e.g., `field` not in enum, `pageSize` > 100)
- **429** — rate limited

---

## Mail detail

### GET `/api/mails/:id`

Fetch full mail detail: headers, sanitized HTML, text body, and all attachments.

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "fromAddr": "alice@example.com",
  "fromName": "Alice Smith",
  "toAddr": "me@mydomain.com",
  "subject": "Meeting tomorrow at 3pm",
  "snippet": "Hi, can we confirm the meeting tomorrow?",
  "date": "2026-07-01T14:30:00.000Z",
  "receivedAt": "2026-07-01T14:32:15.123Z",
  "hasAttachments": true,
  "isSpam": false,
  "htmlSanitized": "<p>Hi, can we confirm the meeting tomorrow? I'd like to…</p>",
  "textBody": "Hi, can we confirm the meeting tomorrow? I'd like to…",
  "authResults": "spf=pass smtp.mfrom=alice@example.com dkim=pass dmarc=pass",
  "attachments": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "filename": "agenda.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 102400,
      "isInline": false
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440002",
      "filename": "logo.png",
      "mimeType": "image/png",
      "sizeBytes": 51200,
      "isInline": true
    }
  ]
}
```

**Notes:**
- `htmlSanitized` is server-sanitized (scripts/styles/forms/event-handlers removed); remote `<img>` URLs are **retained** but not fetched by default — the client renders this in an `<iframe sandbox>` whose CSP (`img-src data:`) blocks remote images until the reader opts in (`showRemoteImages`)
- `textBody` is the plain-text alternative (or null)
- `date` may be null
- `authResults` contains the raw `Authentication-Results` header (SPF/DKIM/DMARC) if present
- Inline attachments (`isInline: true`) use `content-id` values to link into the HTML body as `cid:` URIs (converted to `data:` by the frontend)

**Errors:**
- **404** — mail not found

---

### GET `/api/mails/:id/raw`

Download the original raw `.eml` (RFC 5322 message).

**Response:** Binary octet-stream with `Content-Disposition: attachment`

**Headers:**
```
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="mail-<id>.eml"
X-Content-Type-Options: nosniff
```

**Errors:**
- **404** — mail or raw file not found

---

## Attachments

### GET `/api/attachments/:id`

Download an attachment. Always forced-download (never inline), even for images and PDFs.

**Response:** Binary octet-stream with forced-download headers

**Headers:**
```
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="<original-filename>"
X-Content-Type-Options: nosniff
```

**Notes:**
- SVG files are always downloaded (never rendered inline)
- Inline images (from the email's HTML, `cid:` references) are not served via this endpoint; they are converted to `data:` URIs by the server and embedded in the sanitized HTML
- Filename is validated and percent-encoded for safety

**Errors:**
- **404** — attachment not found

---

## Ingest control

### POST `/api/ingest/run`

Manually trigger an ingest pass to pull pending mail from R2 immediately (instead of waiting for the next 30-second poll cycle).

**Response:**
```json
{
  "started": true,
  "alreadyRunning": false,
  "processed": 5
}
```

**Fields:**
- `started` — whether this call initiated a new pass
- `alreadyRunning` — true if a pass was already in flight (call was debounced/skipped)
- `processed` — number of messages processed (only when known)

**Notes:**
- Debounced: rapid calls will not spawn multiple concurrent ingest passes
- Rate limited to 3 requests per 5 seconds per client (burst capacity 3, refill at 0.2/sec)
- Returns **429** if rate limited (in which case the call is not queued)

**Errors:**
- **429** — rate limited

---

## Settings

### GET `/api/settings`

Fetch client-configurable portal settings.

**Response:**
```json
{
  "showRemoteImages": false
}
```

**Fields:**
- `showRemoteImages` — if true, remote images in HTML mail load client-side (never server-side); if false, remote images are blocked by default

---

### PUT `/api/settings`

Update portal settings.

**Request body:**
```json
{
  "showRemoteImages": true
}
```

**Response:**
```json
{
  "showRemoteImages": true
}
```

**Errors:**
- **400** — invalid JSON or missing/wrong type for `showRemoteImages`

---

## Error responses

All errors follow this format:

```json
{
  "error": "error_code",
  "message": "optional human-readable message"
}
```

Common error codes:
- `not_found` — resource not found (404)
- `invalid_query` — bad search parameters (400)
- `invalid_json` — malformed JSON body (400)
- `invalid_body` — wrong fields or types (400)
- `rate_limited` — too many requests (429)

---

## Notes on search validation

- `q` parameter: the substring and field-value are compared via case-insensitive `ILIKE`. LIKE wildcards (`%` and `_`) are escaped so the user can search for literal `%` or `_` without regex behavior.
- `field` parameter: validated against the enum `{all, to, from, subject}`. Invalid values reject with **400**.
- `page` and `pageSize`: parsed as integers, bounded to reasonable ranges (1–1M pages, 1–100 items/page). Out-of-range values reject with **400**.
- All parameters are parameterized using Drizzle ORM — no SQL injection.

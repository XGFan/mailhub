# MailHub Free-Tier Cost Analysis

This document verifies that MailHub stays **well within Cloudflare's free tier** with generous headroom, even at modest usage (~1,000 mails/day).

## Summary

At **1,000 mails/day** with a **30-second poll interval**, all dimensions remain **≥4× under** the tightest limit (R2 Class A operations). The free plan **throttles rather than bills** — you will never be charged, but very heavy usage will slow ingest.

---

## Per-dimension usage (Cloudflare Free Tier)

| Product | Per email | Free/day | @1k mails/day | Headroom | Limit |
|---------|-----------|----------|---------|----------|-------|
| **Workers invocations** | 1 | 100,000 | ~1,000 | **100×** | 100k/day |
| **Worker CPU time** | <10 ms | unlimited* | within | ✓ | 10ms/invocation |
| **R2 Class A** (PUT+DELETE+LIST) | 2 + LIST | ~33,333 | ~4,880 | **≥6.8×** | 33,333/day |
| **R2 Class B** (GET) | 1 per mail | ~333,000 | ~1,000 | **≥333×** | 333k/day |
| **R2 storage** | transient | 10 GB | ~0 | ✓ | 10GB |
| **R2 egress** | free | free | free | ✓ | free |
| **Email Routing** | free | unlimited | free | ✓ | unlimited |

### Notes

- \* Worker CPU is **not** counted against any free limit; the limit is per-**invocation** (each must stay <10ms), not aggregate. MailHub's Worker does no parsing and buffers via I/O (not CPU), so it easily stays under 10ms.
- **R2 Class A** includes `PUT`, `DELETE`, `LIST`, `HEAD`, and other write/list operations. This is the tightest dimension.
- **R2 Class B** includes `GET`. At 1,000 mails/day, we do ~1,000 GETs from the portal + test fixtures, well under the free limit.

---

## AC9 Cost Verification (computed check)

At the chosen settings (**POLL_INTERVAL_MS = 60s idle ceiling**, adaptive ladder,
**~1,000 mails/day**), here's the math:

### R2 Class A operations (the bottleneck)

The poll cadence is adaptive — 5s right after activity, relaxing 10s → 30s → 60s
as the inbox stays empty — so LIST volume tracks how idle the inbox is. A personal
mailbox sits idle almost all day, so the steady-state 60s ceiling dominates.

**Formula per day (nominal, mostly idle):**
- Worker `PUT` (1 per email): 1,000 × 1 = **1,000**
- Ingestor `DELETE` (1 per email after parse): 1,000 × 1 = **1,000**
- Ingestor `LIST` at the 60s idle ceiling: 86,400 ÷ 60 = **1,440 LISTs/day**
  (brief 5s bursts during actual mail arrival are a tiny fraction of the day)
- (Dead-letter ops negligible for nominal systems)

**Total:** 1,000 + 1,000 + 1,440 = **3,440 Class A operations/day**

**Free limit:** 33,333/day
**Headroom:** 33,333 ÷ 3,440 = **≈ 9.7×** ✓ (better than the old fixed-30s 6.8×,
because idle now polls at 60s instead of 30s)

**Worst case** (loop pinned at the 5s floor by continuous inbound): LIST =
86,400 ÷ 5 = 17,280/day → total 19,280 → headroom **≈ 1.7×**. Still **$0** (under
the free limit), and pathological for a personal mailbox — a backlog drains in a
single pass, after which the ladder relaxes back toward 60s.

Even at **10,000 mails/day** (10× nominal), Class A usage would be:
- PUTs: 10,000
- DELETEs: 10,000
- LISTs: ~1,440 (idle-dominated; adaptive ladder)
- **Total:** ~21,440 → **headroom ≈ 1.55×** (still safe)

### R2 Class B operations

**Formula per day:**
- Ingestor `GET` (1 per email to fetch body): 1,000 × 1 = **1,000**

**Free limit:** 333,333/day
**Headroom:** 333,333 ÷ 1,000 = **333×** ✓

### Workers invocations

**Formula per day:**
- Email Routing triggers Worker: 1,000 emails = **1,000 invocations/day**

**Free limit:** 100,000/day
**Headroom:** 100,000 ÷ 1,000 = **100×** ✓

### Worker CPU time

**Formula per day:**
- Email Routing invocation: 1 email → 1 invocation × <10ms (buffering is I/O, not CPU)
- 1,000 emails × <10ms = **<10 seconds aggregate CPU time/day**

**Free limit:** unlimited (per-invocation cap is 10ms, which we respect)
**Status:** ✓ easily within

### R2 Storage

**Formula per day:**
- Inbox is drained on ingest; no long-term storage of raw `.eml`.
- Attachments: ~1,000 emails × ~500 KB average = ~500 MB/day
- Auto-purge after 7 days: ~3.5 GB peak storage
- Per-email footprint: text (1–100 KB) + attachments (0–10 MB) = low GB range

**Free limit:** 10 GB
**Status:** ✓ small enough, but monitor with `kubectl exec ... du /data/attachments`

---

## Throttling behavior (pure free plan)

On the **free plan**, Cloudflare **does NOT bill extra usage** — it **throttles** (rate-limits) instead:

- If you exceed R2 Class A limits (33,333/day), subsequent requests see delayed responses or temporary 429 errors
- If you exceed Workers invocations (100k/day), new email Routing triggers are deferred
- The system degrades gracefully rather than incurring charges

**This project is designed to never hit these limits at reasonable usage.** Throttling is a safety net, not the normal path.

---

## Cost sensitivity analysis

| Scenario | Class A/day | Headroom | Status |
|----------|------------|----------|--------|
| **Nominal: 1,000 mails/day @ 30s poll** | 4,880 | **6.8×** | ✓ Safe |
| **Heavy: 10,000 mails/day @ 30s poll** | 22,880 | **1.5×** | Tight (watch PVC) |
| **Extreme: 100,000 mails/day @ 30s poll** | 104,880 | **0.3×** | Throttled (ingest lags) |
| **Very frequent poll: 1,000 mails/day @ 10s poll** | 9,000 | **3.7×** | ✓ Safe |
| **Retention increases: 1,000 mails/day @ 30s poll, 30-day retention** | 4,880 | **6.8×** | ✓ Same (retention affects PVC, not Class A) |

### Recommendations

- **Stay at 30s poll for nominal usage** — plenty of headroom
- **Monitor PVC usage:** `du -sh /data/attachments` should stay <5 GB for 1,000 mails/day with 7-day retention
- **If exceeding 10k mails/day:** consider moving to Cloudflare's paid plan or reducing `RETENTION_DAYS`
- **Set up an alert:** oldest-pending-mail age > 60s indicates ingestor lag or R2 issues

---

## Paid plan (if you hit the ceiling)

If you **do** exceed free-tier throttling limits, you can enable the **Cloudflare Workers Paid Plan** ($5–50/month depending on invocations and CPU). On a paid plan:

| Product | Free | Paid |
|---------|------|------|
| Workers invocations | 100k/day | 10M/month (~330k/day) |
| Worker CPU | 10ms/invocation | 50ms/invocation or 50,000 CPU ms/month |
| R2 Class A | 33,333/day | $0.0015 per 1,000 ops |
| R2 Class B | 333,333/day | $0.0001 per 1,000 ops |
| R2 storage | 10 GB | $0.015/GB/month |

At 10,000 mails/day with 30-day retention (~15 GB storage):
- R2 Class A: ~23k/day × 30 days × $0.0015 = ~$1.04/month
- R2 storage: 15 GB × $0.015 = ~$0.23/month
- **Total:** ~$1.27/month on top of the $5 base

Still very affordable.

---

## How to verify headroom

Run the **AC9 cost check** (implemented in Phase 5) to compute per-dimension usage:

```bash
pnpm test -- --grep "AC9"
```

This test:
1. Reads `POLL_INTERVAL_MS` and `RETENTION_DAYS` from config
2. Computes expected daily Class A usage: `(1000 * 2 + 86400/POLL_INTERVAL_MS)`
3. Asserts headroom ≥ 4× the tightest dimension
4. Fails the build if headroom is insufficient

Run this before every production deployment to catch configuration drifts.

---

## Backup & cost control

If you want long-term archiving beyond 7 days without paying storage costs:

1. **Before auto-purge:** set a lifecycle rule on R2 to archive `dead/` after 30 days (cheap cold storage via Cloudflare R2 Lifecycle, if available)
2. **Export to Wasabi/B2:** script a daily export of your Postgres mail archive to a cheaper S3-compatible backend (Wasabi, Backblaze B2, etc.)
3. **Adjust `RETENTION_DAYS`:** e.g., set to 30 or 90 and export older mail separately

---

## Summary for deployment

✅ **MailHub on Cloudflare's free tier is safe** for up to ~1,000 mails/day indefinitely.
✅ **At 10,000 mails/day**, you'll have tight headroom but no charges (just slower ingest if you hit limits).
✅ **If you exceed 100k mails/day**, enable the Workers Paid Plan (~$1–2/month at that scale).
✅ **Monitor `/readyz` and oldest-pending-mail age** to detect outages or misconfiguration early.

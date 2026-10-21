# VELORA — Production Readiness Gate

Date: 2026-10-12, updated 2026-10-13 (staging closure pass).
Scope: cart, checkout, order lifecycle, DB integrity (0013–0019),
notification retry, refunds. No business features added in this pass except
two disclosed race guards. No production exists; nothing was deployed; no
live Stripe operations were performed (all provider behavior via mocks/fixtures).

## 1. Executive decision

- **Staging: GO, conditional on §6 setup** — suite green, procedures
  documented (`docs/staging.md`), failure paths exercised with mocks.
  Staging itself is not yet provisioned, so this is readiness-to-stage.
- **Production: NO-GO until the checklist in §6 is signed off.** Blocking
  gaps are operational (secrets, SMTP, cron runtime, alerts, backups), not
  code defects: five Critical items, all outside the repository.

## 2. Verified findings and evidence

### Phase 1 — migrations & integrity (all commands actually run)

- Journal `idx 0–19` continuous, `breakpoints: true` everywhere; `pnpm db:migrate`
  exits 0 with nothing pending. Runner wraps pending migrations in ONE
  transaction (verified in `drizzle-orm/pg-core/dialect.js` + observed: 0016's
  first failure rolled back its own `DELETE`s). Consequence: `CONCURRENTLY`
  can never run in this migrator — large-table index work must go out-of-band.
- Re-ran declared-vs-live extraction post-0018: **0 missing FKs (42/42 live),
  0 missing uniques/indexes.** 5 partial predicates verified byte-correct
  (`ACTIVE` carts ×2, default address, primary image, low-stock pending set).
- 0018 repeatability: `IF NOT EXISTS` + catalog-guarded `DO` blocks; dry-run
  85/85 statements clean in a rolled-back txn; live re-run is a no-op.
  Rollback = `DROP INDEX/CONSTRAINT IF EXISTS` (headers list each object).
- 0019 matches worker queries exactly: `order_notifications_retry_idx
  (status, next_retry_at)` serves the due-scan + ordering; claim-by-`id`
  uses the pkey.
- 0016 data scope (production warning): `ORD-TEST-%` deletes match synthetic
  fixtures only, but the orphan sweep (`…WHERE order_id NOT IN (SELECT id
  FROM orders)`) WOULD delete real orphans in production. Gate: run the
  orphan scans in §3 first; proceed only at zero (or reviewed) orphans.
- Pre-existing suites were repaired for the enforced net (unique order
  numbers, FK-safe teardown order, synthetic `test-user`), not weakened:
  assertions unchanged or strengthened (delta-based).
- Shared-DB test harness hardened: per-file pools capped (`max: 3`; 26
  workers oversubscribed stock `max_connections = 100` and caused cascading
  timeouts), and the cron-auth test no longer executes the live expiry job
  against other suites' fixtures (it pins auth + response shape with
  `batchSize: 0`; worker semantics have dedicated tests).

### Phase 2 — remediation data (see `docs/db-integrity.md` + §3 runbook)

- 37 FKs landed `NOT VALID` (5 predated); new writes enforced (proven: 23503
  on violating inserts); orphans grandfathered (379 movement / 153 items /
  318 addresses / 331 histories / 195 webhook links / 1 profile — all test
  residue with sampled ids on file, preserved per policy).
- **Rehearsal 2026-10-13:** `VALIDATE` promoted 2 clean constraints in dev
  (`payments_order_id_orders_id_fk`, `cart_user_id_user_id_fk`); the gate
  correctly rejects orphaned ones (`order_items_order_id` names the
  offending key). State now: 7 validated / 35 NOT VALID pending orphan review.
- 10 uniques added after zero-duplicate scans; 8 CHECKs were already present.
- Redundant-but-declared index pairs exist (e.g. `orders_user_id_idx`
  covered by `orders_user_created_idx`; `coupons_code_idx` duplicates the
  unique) — Low, schema-faithful, no action.
- `banners.status` physically maps to `is_active`; migration uses physical
  names (a naive `status` DDL fails — proven in dry-run).

### Phase 3 — notifications (code-traced, tests green)

- Claim = single `UPDATE…RETURNING` on due-`QUEUED` or lease-expired
  `SENDING` (lease 10 min, `updated_at` refreshed on claim): exactly one
  worker wins (tested concurrently, 1 send).
- Backoff 1m/5m/15m/1h/6h, max 5 attempts → `FAILED` with 500-char message
  prefix (no bodies/secrets/PII beyond recipient+order snapshot).
- No temp/permanent classification: every send error retries to exhaustion
  (only missing-context short-circuits to `FAILED`). Accepted: simpler,
  slightly slower on hard bounces.
- Endpoint 401s without `CRON_SECRET` (tested both branches).
- **Duplicate case (documented, not fixable over SMTP): success-then-crash
  before `SENT` re-sends after lease expiry.** Mitigations in place: short
  lease, idempotent-safe content, stored provider `messageId` for
  reconciliation. Exactly-once is NOT claimed.
- Gap: `notification-retry` had NO schedule in `vercel.json` (only
  expire-reservations `*/5` and low-stock `*/10`) — worker existed but would
  never run. **Closed in repo**: schedule `*/5 * * * *` added (valid JSON,
  same syntax as existing entries); runtime execution still unverified
  (High → Medium, pending first staging cron 200s).

### Phase 5 — optional product enhancements (code + tests, staged cron unverified)

| # | Item | Verified behavior |
|---|---|---|
| T-5.1 | Abandonment recovery queue | 0037 `cart_recovery_emails` applied + verified in psql (journal 38/38); unique `(cart_id, stage)` claim; stage ladder gated on prior stage SENT; FAILED terminal (no repeats to a bouncing mailbox); 7-day per-user cap suppressing NEW cycles only; DB-epoch-seconds freshness (no DB/Node clock crossing); CAS dispatch + claim/lease/backoff reusing the auth-email machinery; hourly `0 * * * *` cron entry (`CRON_SECRET` POST) — **runtime cron unverified until first staging 200** |
| T-5.2 | Order invoice PDF | Pure pdf-lib renderer (WinAnsi sanitizer), ownership-scoped via `getOrderDetail` (wrong owner → 404 semantics), session+UUID route, `private, no-store`; unit 3/3; statutory invoice fields deliberately absent (D22 legal/provider gate) |
| T-5.3 | Search facets | `getSearchFacets` under `productsListing` tag / revalidate 60; counts computed under other-filters-minus-own; totalCount under all filters (consistency asserted against `searchProducts.totalCount`); derived-table rating bands (Postgres 42803); integration 5/5 |
| T-5.4 | Review re-moderation | Any non-self status transition (incl. re-open from approved/rejected) allowed per product decision; content stays immutable; audit columns on real transitions only; 17/17 across flipped suites |
| T-5.5 | Display currency (foundation) | `DISPLAY_CURRENCY_RATES` off by default (pure USD, selector hidden); configured → cookie-driven card-price conversion with exact decimal half-up rounding; cart/checkout/invoices/emails stay USD (D23); unit 10/10 |

### Phase 4 — payment/refund matrix (code + tests)

| # | Scenario | Verified behavior |
|---|---|---|
| 1 | Successful card payment | Intent created outside txs; webhook finalizes once; duplicate finalize converges (existing tests) |
| 2 | Duplicate webhook | `webhook_events` COMPLETED skip; finalize idempotent replays |
| 3 | Payment after cancellation | `finalizeOrderPayment` throws; stock untouched (tested) |
| 4 | Concurrent refunds | Payment-row lock + PENDING replay + twin-follow; 1 Stripe call (tested) |
| 5 | Partial then partial | `PARTIALLY_REFUNDED` → `REFUNDED`; cap enforced under lock (tested) |
| 6 | Stripe timeout after processing | Stripe idempotency key dedupes money; local replays PENDING/twin-follows; webhook reconcile converges books (reasoned; timeout path covered by design, 10s poll untested — Low gap) |
| 7 | Refund stays pending | Bounded twin-follow → PENDING return; FAILED rows never block fresh attempts (tested) |
| 8 | Refund fails then retried | FAILED recorded, order untouched, fresh attempt stages anew (tested) |
| 9 | `charge.refunded` vs local finish | TxB convergence guard cancels the duplicate local row instead of double-counting (implemented + tested via admin-retry twin; mid-flight interleave code-reviewed, timing-untestable — disclosed) |
| 10 | Inconsistent webhook amount | Over-report logged as error, recorded as nothing; under-report converges idempotently (tested) |
| 11 | Missing/invalid credentials | Blocked pre-tx (tested); Stripe errors → FAILED + sanitized message (tested); missing webhook secret → route 500s for Stripe to retry (existing) |
| 12 | Admin retries submitted refund | Converges onto original via Stripe replay (tested, `supersededBy`) |

Money cannot exceed captured (lock + cap + deterministic keys); Stripe never
runs inside lock-holding txs; reconciliation never calls Stripe; audit rows
carry actor/amount/reason/outcome; `refund_issued` mail fires only on success
(charge-reconciled refunds do NOT notify — minor gap noted); FAILED stays
visible in `refunds` + error logs.

Two minimal race guards were added during this gate (disclosed, tested):
TxB convergence on Stripe-replayed/reconciled money; twin-following was
pre-existing. A stuck-`PENDING` row can remain if a twin dies mid-flight
after Stripe succeeded without webhook reconciliation — visible in `refunds`,
retryable, never double-charged. No business features added.

## 3. Database remediation runbook

Preconditions: maintenance window scheduled (locks are brief but FK adds take
`SHARE ROW EXCLUSIVE`); backup taken AND restore rehearsed (no backup
evidence exists in-repo — owner must confirm platform-level PITR first);
`pnpm db:migrate` rehearsed on a staging clone; approver named.

1. Read-only diagnostics: per-FK orphan scan
   `SELECT count(*) FROM <child> c LEFT JOIN <parent> p ON p.<pcol>=c.<ccol>
   WHERE c.<ccol> IS NOT NULL AND p.<pcol> IS NULL;`
   duplicate scans per unique (`GROUP BY … HAVING count(*)>1`); full lists in
   `docs/db-integrity.md`.
2. Human review of every orphan row (dev baseline: 1227 test-residue rows
   across 6 tables — production must read zero or reviewed).
3. Repair: delete dead child rows explicitly (never parents, never
   backfilled fakes); re-run scans to zero.
4. Execute: `pnpm db:migrate` (0018 idempotent; 0019 additive). Large tables:
   build plain indexes `CONCURRENTLY` out-of-band first, then let the
   migration no-op them.
5. Promote: `ALTER TABLE <child> VALIDATE CONSTRAINT <fk>;` one per FK
   (online; reads/writes continue).
6. Post-verify: convalidated=true count = 42; app smoke (checkout, webhook
   replay, refund dry-run in test mode); full test suite against staging.
7. Recovery: migration txn is atomic per run (verified rollback behavior);
   constraint drops are data-safe (`DROP … IF EXISTS`); data repair has no
   rollback except the pre-step backup — hence step 1.

## 4. Notification guarantees (summary)

At-least-once, bounded (5 tries, ~7h window), crash-recoverable via lease,
deduplicated by claim. Known duplicate case: crash between SMTP acceptance
and `SENT` marking (lease-bound resend). No silent loss: exhaustion lands in
`FAILED` with error prefix + error log + job summary counts.

## 5. Deployment prerequisites & approvals

- [ ] `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` set (approve: payments owner)
- [ ] Real SMTP + verified sender identity (approve: platform owner)
- [ ] `CRON_SECRET` set; schedules added for BOTH jobs incl. notification-retry (approve: platform owner)
- [ ] DB backup/restore proven; orphan scans at zero; FKs validated (approve: DBA)
- [ ] Alerting wired: `notificationRetryExhausted`, `reconcileRefundEvent/exceeds-captured`, webhook 5xx rate, `orderEmailFailed` burst, `checkAndCreateLowStockAlert` backlog (approve: on-call lead)
- [ ] Returns flow defined (refunds never restock automatically)

## 6. Rollback & incident response

- Deploy rollback: previous build (stateless); migrations roll forward-only —
  constraint/index removal via documented `DROP … IF EXISTS`; data repair
  relies on the pre-step backup.
- Duplicate-charge suspicion: sum `refunds(COMPLETED)` vs Stripe dashboard
  by `provider_refund_id`; local `supersededBy`/CANCELLED rows explain
  converged duplicates; never refund again to "fix" — reconcile first.
- Webhook flood: dedup by `(provider, providerEventId)`; replays are safe.
- Reservation stuck: expiry job + `handleCheckoutExpiration` idempotent;
  COD orders (`checkoutExpiresAt NULL`) never auto-expire by design.

## 7. Outstanding risks

- **Critical**: no Stripe/SMTP/cron secrets configured anywhere verifiable;
  orphans unvalidated (35 FKs NOT VALID);
  0016 orphan sweep unsafe to blindly rerun against prod data.
- **High**: no alerting/monitoring config in repo; no restore drill (dump
  verified readable, 299 objects — restore target unavailable here);
  expiry/retry jobs inoperable without `CRON_SECRET` (fail-closed 401, silent).
- **Medium**: SMTP exactly-once impossible (lease-bound duplicates);
  `charge`-reconciled refunds don't notify; dev `.env` holds a real-looking
  SMTP password (rotate on principle); enforced `restrict` FKs make admin
  deletes of referenced brands/products fail closed with a generic message
  (correct per schema; UX copy could name the blocker); notification-retry
  schedule configured in repo but runtime 200s unverified.
- **Low**: redundant index pairs (write overhead); refund twin-poll timeout
  path untested; `product_variant`/`banners` physical-name mapping footgun
  for future DDL.

## 8. Evidence separation

- **Locally verified**: everything in §2–§4 (commands run, DB queried,
  352/352 tests green twice, typecheck/lint/build). Staging procedures in
  `docs/staging.md` are validated to the extent possible without a staging
  target: migration replay script exists, `pg_dump` archive verified
  readable, env validation fail-closed paths tested.
- **Inferred**: production table sizes/locks (dev tables tiny); Stripe
  idempotency semantics (SDK contract + keyed mock, no live calls).
- **Unverifiable from repo**: any production secret, schedule, backup,
  alert, restore, Stripe test-mode run, or SMTP delivery — all claimed
  absent, none claimed present. Staging cron 200s, restore drill, and live
  test-mode payments await a provisioned staging environment.

## 9. Human sign-off checklist

Each line needs a named owner + date. Nothing below may be pre-checked.

- [ ] Staging database provisioned isolated from production (owner: DBA)
- [ ] `pnpm db:migrate` green on staging; journal current with the migration chain (38/38 as of this writing — 0000–0037; 0036 = products listing partial index T-4.5, 0037 = cart recovery queue T-5.1) (owner: DBA)
- [ ] All staging env vars set per `docs/staging.md` §2, values never committed (owner: platform)
- [ ] Stripe test-mode: intent created, webhook verified, duplicate + invalid-signature + cancel-late + refund flows exercised (owner: payments)
- [ ] SMTP sandbox verified: all 8 notification types delivered to staging inbox (owner: platform)
- [ ] Cron 200s observed for all 5 configured jobs (expire-reservations, deliver-low-stock-alerts, notification-retry, sync-banners, auth-email-retry; see `vercel.json`); unauthorized probes 401 (owner: platform)
- [ ] `GET /api/health` observed 200 with `checks.database.status = "up"` and 404-free; uptime monitor pointed at it (owner: platform)
- [ ] Backup archive produced + restore drill green on isolated target (owner: DBA)
- [ ] 8 alerts wired with owners/runbooks; on-call acknowledges test pages (owner: on-call lead)
- [ ] Orphan scans at zero (or reviewed); FKs validated; `VALIDATE` log attached (owner: DBA)
- [ ] Returns-policy decisions 1–9 signed (owner: product)
- [ ] Full suite + typecheck + lint + build recorded against the release commit (owner: engineering lead)

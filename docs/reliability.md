# VELORA — Production Reliability (Phases 1–4)

## Phase 1 — database integrity (evidence in `docs/db-integrity.md`)

- 41 FKs declared, 36 missing live → all added `NOT VALID` in `0018`
  (new writes enforced immediately; orphans grandfathered for review).
- 10 missing uniques (zero-violation scans) + 35 missing plain indexes added.
- 8 CHECKs already present. `banners.status`/`product_variant.status` map to
  physical `is_active` — migration uses physical names.
- Orphans (test residue, untouched): 379 movement, 153 items, 318 addresses,
  331 histories, 195 webhook links, 1 profile. Preflight + repair + `VALIDATE`
  procedure documented; no disposable DB available (no `CREATEDB`), so 0018
  was dry-run statement-by-statement in a rolled-back transaction (85/85).
- One-off dev cleanup (documented in-report): synthetic `ORD-TEST-*`,
  `ORD-PAID-001`, and `order-res-*` leftovers from interrupted runs that
  blocked newly-enforced uniques. Production data: nonexistent/untouched.

## Phase 2 — durable notifications

States: `QUEUED → SENDING → SENT | QUEUED(retry) | FAILED` (`0019` adds
`attempts`, `next_retry_at`, `last_error`, `provider_message_id`).
- Claim is one atomic `UPDATE…RETURNING` (due QUEUED or lease-expired
  SENDING, lease 10 min default) — concurrent workers serialize; crashed
  workers' rows are reaped by lease.
- Bounded retries (default 5) with backoff 1m/5m/15m/1h/6h; exhaustion →
  `FAILED` with sanitized error (message prefix only, no secrets/bodies).
- SMTP strictly outside transactions; failure never rolls back order state.
- Endpoint `POST /api/internal/jobs/notification-retry` uses the existing
  `CRON_SECRET` bearer pattern (401 otherwise).
- Guarantee: at-least-once with idempotent-safe content — exactly-once email
  is NOT claimed (SMTP has no idempotency; a timeout after acceptance can
  duplicate). Claim-lease keeps the window to crashed-worker cases only.
- Visibility: job JSON summary (`sent/scheduled/failed/skipped`), error logs
  on exhaustion, `SELECT … WHERE status='FAILED'` for the dead-letter view.

## Phase 3 — refunds

Implemented minimal admin workflow (`modules/payments/.../request-refund.ts`):
- COMPLETED Stripe payments only; cumulative cap enforced under a
  payment-row lock (BR-007); partials supported (`PARTIALLY_REFUNDED`).
- Duplicates: identical in-flight PENDING row is followed (poll, bounded),
  never re-minted — a concurrent-duplicate test caught and fixed a real
  double-Stripe-call bug. Stripe idempotency keys backstop races.
- Stripe runs outside transactions; `PENDING → COMPLETED|FAILED` after;
  audit rows (`refund_issued`, `refund_reconciled`) on every path.
- Webhook `charge.refunded` reconciles by converging local COMPLETED totals
  to provider `amount_refunded` (idempotent); over-reports are logged as
  errors and recorded as nothing.
- Full refunds mirror `COMPLETED → REFUNDED` onto the `payments` row
  (conditional on `COMPLETED`, so concurrent twins converge); partials leave
  it `COMPLETED`. The terminal payment guard plus an order-level paid check
  therefore reject stale failure events after any refund, and the remaining
  cap stays enforced for legacy rows refunded before this mirror existed.
- Webhook event state changes are scoped by `(provider, provider_event_id)`
  to match the table's unique key.
- Inventory: NEVER restocked by refunds (explicit rule, also in the customer
  email). Verified returns use `restockReturn` as a separate authorized step.
- Blockers remaining: live `STRIPE_SECRET_KEY` required (calls blocked
  without it — safe default); no return-merchandise flow; no partial-capture
  handling (full-capture model only).

## Phase 4 — observability

All signals flow through the existing structured logger with module/action
correlation: transition rejections (actions), expiry failures (job),
reconciliation anomalies (`reconcileRefundEvent` over-report is an error),
retry exhaustion (job), constraint violations (action error names), refund
failures (command + action). No secrets/cookies/payment credentials in logs
(only safe prefixes). Job endpoints return machine-readable summaries;
no new health endpoints were warranted.

## Production steps requiring humans

1. Review/repair orphans (`docs/db-integrity.md` queries), then `VALIDATE`
   each FK; provision `CONCURRENTLY` indexes on large tables out-of-band.
2. Set `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` to enable live
   card payments, refunds, and webhook verification.
3. Schedule cron: expire-reservations + notification-retry with `CRON_SECRET`.
4. Configure real SMTP (current `.env` points at a placeholder).
5. Decide the returns flow before promising restocks; monitor `FAILED`
   notifications and `exceeds-captured` errors.

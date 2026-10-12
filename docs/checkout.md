# VELORA — Checkout & Order Creation (FR-08 / FR-09)

## Checkout validation

`placeOrder` revalidates every cart line against live data (`resolveCatalogEntry`):
existence, variant + product `ACTIVE`, quantity within `[1, 99]`, availability,
current list price, and the best active promotion. Any blocker aborts with
`CartConflictError` carrying a structured snapshot — quantities are never
silently reduced and totals never silently changed.

Price-change policy: the order always prices from the live catalog, never from
`priceAtAddition`. If the cart changed between validation and creation, Tx1
re-reads the cart and aborts (`CartConflictError`) instead of ordering stale
lines. Promotion changes behave the same way: expired promotions simply drop
out of the totals and the pre-checkout warning names them. Stock TOCTOU
between validation and reservation is closed by the atomic reservation step;
a loss there compensates (below) instead of overselling.

## Price and promotion calculation

- Unit price: variant `priceOverride`, else product `basePrice` (reused).
- Best active promotion per product adjusts the unit price (reused schema,
  no duplicated engine; `endsAt = NULL` is open-ended).
- Coupon (`FR-12.02`, locked `FOR UPDATE` in Tx1): active, in-window, under
  `usageLimit`, subtotal over `minimumOrderAmount`; `PERCENTAGE` capped by
  `maximumDiscountAmount`, `FIXED` capped at subtotal. Usage is consumed in
  Tx1 (`usageCount + 1`, `couponUsages` row) and rolled back on compensation.
  Gap: the schema has no per-user limit column, so that SRS rule is unenforced.
- Shipping (server-authoritative enum; no shipping table exists):
  `STANDARD` 4.99 (free when discounted subtotal **strictly exceeds** 75.00,
  BR-018), `EXPRESS` 12.99.
- Tax: explicitly `0.00` — no jurisdiction rules exist; `TAX_RATE_BPS` is the
  hook. Total follows BR-002 exactly, all in integer cents.

## Order creation and snapshot semantics

Tx1 (one transaction) inserts: order (`PENDING`/`PENDING`, `VEL-YYYYMMDD-XXXX`
with collision retry, idempotency key + input hash), items (`PENDING`
reservation, frozen name/sku/qty/unit/discount/total), both address snapshots
(from verified saved addresses or validated inline input — inline addresses
are never saved to the book), `PENDING` payment row, initial history, coupon
usage — and flips the cart `ACTIVE → CONVERTED`.

## Inventory reservation transaction boundaries

`reserveOrderInventory` owns its transaction and cannot nest, so the flow is
explicitly **two-phase**, not one atomic transaction:

1. Tx1 creates the order graph (above).
2. `reserveOrderInventory(orderId)` runs in its own transaction (reused as-is).
3. On shortage: compensation reuses `cancelOrder` (releases, cancels,
   histories) plus a tx that reactivates the cart (`CONVERTED → ACTIVE`) and
   rolls back coupon usage. The failed order stays `CANCELLED` for audit; the
   customer retries with a **fresh** key. Partial holds are impossible
   (all-or-nothing check before mutation; PENDING items otherwise).

## Idempotency behavior

- Client sends one uuid key per attempt; `(user_id, idempotency_key)` is
  unique. Same key + same input → same order returned (`replayed: true`).
- Same key + different input → `409 IdempotencyConflictError` (hash-bound).
- Concurrent same-key checkouts: one Tx1 wins; losers replay the winner (or
  see `CART_CONSUMED` and replay on retry). Concurrent different-key
  checkouts: cart conversion lets exactly one through.
- Button disabling is UX only; correctness is server-side.
- Stripe-side idempotency (`checkout-{orderId}`) prevents duplicate intents
  on payment retries.

## Payment initialization and webhook integration

Runs outside all inventory locks. `card`: creates (or retrieves) a Stripe
PaymentIntent for the server total, stores it on the payment row — the same
`providerPaymentId` the existing webhook route uses — and returns the client
secret. `cod`: marks the row, no external call, `checkoutExpiresAt = NULL`
so the expiry job (which only picks dated expiries) never auto-cancels COD;
release follows admin fulfillment/cancellation. Without `STRIPE_SECRET_KEY`
the order stands reserved and the client gets `configurationMissing` to retry
later. Only verified webhooks move money state (`finalizeOrderPayment` /
`handlePaymentFailureWebhook`, reused unchanged); late payments against
cancelled/expired orders are rejected, never fulfilled.

## Failure recovery and compensation

| Event | Handling (all idempotent) |
|---|---|
| Reservation shortage | Compensate (cancel + reactivate cart + coupon rollback) → `409` + fresh key for retry |
| Payment init failure | Order stays `PENDING` + reserved until TTL; `retryPayment` resumes idempotently |
| Payment failure webhook | Release + `CANCELLED`/`FAILED` (reused) |
| Reservation expiry | `handleCheckoutExpiration` → `CANCELLED`/`EXPIRED` (reused job) |
| Late payment after cancel/expiry | `finalizeOrderPayment` throws; no fulfillment without reservation |
| Customer cancel | `cancelOrderAction` (ownership-checked) → `cancelOrder` (reused) |

## Order state transitions

`PENDING → PROCESSING → SHIPPED → DELIVERED`, `PENDING → CANCELLED`
(all reused; no new states). Payment: `PENDING → COMPLETED|FAILED`,
COD stays `PENDING` until fulfillment. Reservations: `PENDING → RESERVED →
COMMITTED|RELEASED`.

## Required environment variables

None new. Reused: `RESERVATION_EXPIRY_MINUTES` (default 30),
`STRIPE_SECRET_KEY` (card payments; absent = structured degradation),
`STRIPE_WEBHOOK_SECRET` (existing route).

## Deployment / migration requirements

- `0015_order_checkout_idempotency` — `idempotency_key` (backfilled random)
  + `checkout_hash` + unique `(user_id, idempotency_key)`.
- `0016_reconcile_declared_indexes` — creates declared-but-missing indexes;
  removes synthetic `ORD-TEST-*` fixtures blocking two uniques and sweeps
  orphaned child rows (this environment was provisioned without FKs/indexes).
- Known drift (follow-up): the environment lacks most FK constraints declared
  in migration 0000 (no cascades run here); a dedicated FK-reconciliation
  migration is recommended. Test suites must keep fixture cleanup scoped —
  unscoped deletes/row counts race across parallel workers in the shared DB.
- Guest checkout is unsupported by design (`orders.user_id NOT NULL`);
  checkout requires an authenticated session.

## Follow-up work

Per-user coupon limits (no schema column), regional tax, shipping-method
table/carrier rates, Stripe Elements confirmation UI (client secret is
returned; live confirmation needs publishable key + Elements), admin
fulfillment flow for COD, FK reconciliation migration.

# VELORA — Checkout & Order Creation (FR-08 / FR-09)

## Sequential pipeline

Checkout runs seven strictly ordered stages; every stage is enforced
server-side regardless of client validation, and each step gates on the
previous one in the UI (the server is the authority in all cases):

1. **Cart integrity** — authenticated customer only (guest checkout remains
   unsupported: `orders.user_id` is `NOT NULL`). The active cart is loaded
   from the database, ownership verified, and every line revalidated
   (existence, `ACTIVE` variant + product, quantity limits, live price, live
   stock). Blockers abort with actionable `CartConflictError`. Nothing
   client-supplied (prices, stock, discounts, totals) is trusted, and opening
   checkout never reserves inventory.
2. **Shipping address** — saved id (ownership verified against the customer
   profile, missing and foreign ids answered identically per BR-008) or
   Zod-validated inline input. Inline addresses are snapshotted, never saved
   to the book (no duplicate records).
3. **Billing address** — saved, inline, or `sameAsShipping`, in which case the
   server derives billing from the already-validated shipping snapshot. The
   flag alone is never trusted; the resolved destination is what persists.
4. **Shipping method & rates** — method id only crosses the boundary; the
   server quotes destination eligibility, weight limits (when weight is
   known), and the fee schedule. See “Shipping configuration” below.
5. **Tax, coupons, promotions** — coupon validated under a locked row in Tx1
   (never consumed by previews); promotions adjust unit prices first (BR-009
   stacking: promo → unit price, then at most one coupon on the discounted
   merchandise subtotal — the schema and engine accept exactly one coupon
   code, so double-couponing is structurally impossible).
6. **Order review** — `previewCheckout` recalculates the full breakdown from
   live data with zero side effects (no order, payment, reservation, or coupon
   consumption). The UI renders this preview and echoes `totalCents` back.
7. **Placement & payment** — `placeOrder` recomputes everything inside Tx1
   and aborts with `TotalChangedError` (nothing persisted) when the echoed
   total differs, forcing explicit reconfirmation against a fresh preview.
   Stripe is initialized from the persisted authoritative total only.

## Financial formulas and rounding

All money math runs on exact decimal intermediates (`decimal.js`) and lands
on integer minor units:

```text
Subtotal       = Σ(quantityᵢ × unitPriceᵢ)          (exact integer sums)
DiscountAmount = PromotionDiscount + CouponDiscount (coupon ≤ subtotal)
TaxableBase    = Subtotal − DiscountAmount + TaxableShipping   (≥ 0)
TaxAmount      = round_half_up(TaxableBase × TaxRate)
TotalAmount    = Subtotal − DiscountAmount + ShippingAmount + TaxAmount
```

- `TaxableShipping` is the fee portion inside the base (0 unless the method
  rule and the jurisdiction both tax shipping); `ShippingAmount` is the full
  fee charged. Both are snapshotted separately.
- Rounding policy: `ROUND_HALF_UP`, applied exactly once per computed
  aggregate involving division (per-unit promotion prices, coupon discount,
  tax). Line totals and subtotals are exact sums of minor-unit integers and
  are never re-rounded. Engine version is frozen per order
  (`pricing_policy_version`: `"1"` legacy rows, `"2"` decimal engine).
- Stored amounts are aggregates as named (`subtotal`, `discount_amount`,
  `shipping_amount`, `tax_amount`, `total_amount`; per-line `unit_price`,
  `discount_amount`, `total_amount`); the Stripe charge amount is the
  persisted `totalAmount` converted once to minor units — they agree exactly.
- Historical rows are never repriced: old orders keep their frozen snapshot
  (and policy `"1"`); corrections require an authorized workflow, not edits.

## Decimal implementation and currencies

- `decimal.js@10.6.0` (direct dependency) backs `modules/checkout/domain/money.ts`
  (exact major↔minor conversion with overflow/NaN guards) and
  `modules/checkout/domain/calculation.ts` (the deterministic, dependency-free
  engine: no React, DB, or Stripe access).
- Supported currencies: `USD` (2 minor units) only. Anything else is rejected
  (`Unsupported currency`) instead of assuming 2 decimals; multi-minor-unit
  support is a config addition, not a code change.
- Bounds: every input must be a safe non-negative integer in minor units;
  coupon ≤ subtotal, taxable shipping ≤ shipping, totals ≤ `MAX_SAFE_INTEGER`;
  violations throw before any write.

## Coupon and promotion stacking policy (explicit)

1. Product promotions adjust the effective unit price first.
2. At most one coupon applies, computed on the discounted merchandise
   subtotal only — never on shipping or tax.
3. The same promotion is applied once per line (deterministic
   best-promotion selection — lowest effective price, id tie-break — in
   `modules/promotions/domain/promotion-rules.ts`; see `docs/promotions.md`); coupon usage is locked (`FOR UPDATE`), consumed in Tx1, and
   rolled back on compensation. Concurrent checkouts for the last usage
   serialize: exactly one wins.
4. Discounts can never drive the merchandise base negative (coupon capped at
   the effective subtotal + engine guard). Note on stacked reporting: the
   persisted `discount_amount` is the informational sum of promotion savings
   (already embedded in effective unit prices) plus the coupon figure, so it
   can exceed the effective subtotal when both apply — the charged total is
   unaffected because promotions never double-count (unit prices are already
   net). Line-level promotion ids plus the `couponusages` row preserve the
   full allocation for audit.

Resolved: `coupons.per_user_limit` exists (migration 0022) and is enforced
transactionally in `validateCouponForCheckout` alongside the global limit —
see `docs/coupons.md`. Remaining gap: none on per-user accounting.

## Shipping configuration and rate computation

- Methods `STANDARD` (4.99, free when discounted subtotal strictly exceeds
  75.00 per BR-018) and `EXPRESS` (12.99); adding a method is a code change.
- `SHIPPING_RULES` adds per-method regions (`"*"` = worldwide; otherwise ISO
  alpha-2 allowlist), optional `maxWeightGrams`, and a `taxable` flag.
  Default rules serve all destinations with no weight limits — deliberately
  permissive, fully restrictable without code changes elsewhere.
- Weight comes from authoritative `product_variant.weight_grams` (nullable,
  non-negative CHECK, safe-integer guarded at quote time). Missing weight is
  a defined outcome: limits skipped, surfaced in the preview
  (`weightKnown: false`), never guessed.
- Unsupported destinations/methods fail closed (`UnsupportedDestinationError`
  / `ShippingMethodError` → structured `SHIPPING_INVALID`, no silent fallback).
- To enable live checkout with real policy: approve region allowlists, weight
  limits, fees, and each method's taxability; backfill variant weights.
  No carrier integration exists or is claimed.

## Tax jurisdiction configuration and open legal items

- `TAX_JURISDICTIONS` is intentionally empty: with no approved table,
  `resolveTaxRule` returns explicit `UNCONFIGURED` (0 bps) rather than an
  invented legal rate. Checkout proceeds exactly as before, but the snapshot
  (`tax_jurisdiction`, `tax_rate_bps`, `taxable_base`) and the UI record that
  no jurisdiction applied.
- Enabling tax: approve (country → rate bps, shipping taxability) rows and
  append them; merchandise-vs-shipping distinction and exemptions then work
  per jurisdiction. Until then, treating any destination as taxed is a
  business/legal decision, not an engineering default — fail-safe is
  proceed-at-zero with full visibility.

## Order snapshot semantics

Tx1 persists: lines (variant, qty, frozen regular/effective unit prices,
promotion discount/total, `promotion_id` + `promotion_name` snapshot
— plain reference, no FK so snapshots survive promotion deletion), order
aggregates, `shipping_method`, `tax_jurisdiction`/`tax_rate_bps`/`taxable_base`,
`pricingPolicyVersion`, both address snapshots, payment row, history row,
coupon usage. Pre-policy rows keep NULLs (unknown, never fabricated).

## Price-change confirmation behavior

Preview totals are displayed, never charged. Coupon handling in preview
distinguishes error classes: coupon-domain failures surface as
`couponValid: false` with the coupon message (usage never consumed), while
infrastructure failures (connection loss, lock timeouts) rethrow so the
preview fails loudly instead of showing a total that placement would reject.
Placement with a matching
`expectedTotalCents` proceeds; any drift (price, stock, shipping, tax,
promotions, coupon) aborts pre-commit with `TOTAL_CHANGED`, and the UI shows
the fresh breakdown with an explicit confirm control that re-places against
the latest preview. Idempotency keys are unchanged by confirmation (same
inputs → same key → replay safe).

## Payment amount consistency

Stripe `PaymentIntent.amount` is built from the persisted order total in
minor units with order-scoped idempotency (`checkout-{orderId}`); retries
retrieve rather than recreate. Webhook dedup + finalization unchanged.

## Payment processing

Supported methods: cards and wallets through Stripe, plus Cash on Delivery.
`initializeOrderPayment` re-reads the persisted order total and currency and
rejects any caller-supplied figure that disagrees with storage — the
persisted row is authoritative, function arguments are not.

- **Cards & wallets.** Intents are created with `automatic_payment_methods`
  (`enabled: true`, redirects off), so Stripe offers every method the
  account enables — cards plus Apple Pay / Google Pay on supported devices —
  with no per-wallet code. The checkout confirmation step renders a Stripe
  Elements form (lazy-loaded `stripe.js`, Payment Element) only when the
  server has issued a client secret; only the publishable key and client
  secret enter the browser. Confirmation redirects to the order page while
  the verified webhook finalizes — the UI never marks payment complete.
  Prerequisites: live `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`, wallet
  methods enabled in the Stripe dashboard, HTTPS + registered domain for
  Apple Pay. None of this is verifiable without those credentials.
- **Cash on Delivery.** No Stripe intent is ever created for COD orders;
  creation and shipment never mark them paid. Cash is recorded exclusively
  through the staff/admin `collectCodPayment` operation, which requires a
  `SHIPPED`/`DELIVERED` order with a `PENDING` COD payment, is idempotent on
  replay, writes a `payment_collected` audit row, and never invokes Stripe
  code paths. COD orders can ship straight from `PENDING` (card orders must
  pass through `PROCESSING` via verified payment).
- **State machine.** `modules/payments/domain/payment-transitions.ts` is the
  single authority (`PENDING → COMPLETED|FAILED`, `COMPLETED → REFUNDED`,
  `FAILED`/`REFUNDED` terminal). Webhook handlers enforce terminal guards so
  stale failure events can never downgrade captured money. A full refund
  additionally flips the `payments` row to `REFUNDED` (partials keep
  `COMPLETED`); the pre-mirror cap check remains as the backstop for legacy
  rows. Late verified payments against cancelled/expired orders are rejected
  loudly (failed webhook event, safe to leave for operator review) — never
  fulfilled without stock.
- **Webhook validation.** Signature verified against the raw body before any
  processing (400 on missing/invalid); `payment_intent.succeeded` carries
  the event's amount/currency into finalization, which re-checks them
  against persisted records post-lock — mismatches abort before mutation
  (FAILED event, retried by Stripe, surfaced in logs).

## Migration and deployment requirements

- `0020_checkout_financial_snapshot` (additive, nullable; policy default
  `"1"`; weight CHECK): `orders.{shipping_method, tax_jurisdiction,
  tax_rate_bps, taxable_base, pricing_policy_version}`,
  `order_items.promotion_id`, `product_variant.weight_grams`.
- New dependency `decimal.js@10.6.0` (MIT, zero dependencies).
- No env changes. No Stripe/API changes.

## Development setup and test fixtures

- Unit tests (`tests/unit/checkout/`): pure domain math, no DB —
  `money.test.ts`, `calculation.test.ts` (incl. half-up boundaries,
  fractional percentages, taxable-base flooring), `shipping-tax.test.ts`
  (regions, weight limits incl. overflow guard, jurisdiction matching),
  `pricing.test.ts` (legacy pinned wrappers), `checkout-schemas.test.ts`
  (client money fields rejected).
- Integration tests run against the shared dev database with per-file
  `SFX`-scoped fixtures and FK-ordered cleanup: `checkout.test.ts`
  (pipeline, idempotency, compensation, webhooks),
  `checkout-totals.test.ts` (preview↔placement agreement, confirmation,
  coupon race), `checkout-hardening.test.ts` (error classification,
  full-discount flooring, cross-customer rejection).
- No production data, live payments, or real emails are ever used; Stripe
  and SMTP remain mocked/absent in tests.

## Known limitations and operational prerequisites

- Single supported currency (USD); single coupon per order. Per-user limits
  are enforced (migration 0022, `docs/coupons.md`).
- No approved shipping regions/fees beyond the documented defaults; variant
  weights unpopulated (limits dormant).
- No approved tax jurisdictions (explicit zero-rate fallback; needs legal sign-off).
- Guest checkout unsupported; shared-DB parallel test runs can flake
  unrelated suites (documented rerun discipline; scoped fixtures/cleanup).
  The full suite is green serially and at bounded parallelism; on
  memory-constrained machines prefer `pnpm vitest run --maxWorkers=2`.

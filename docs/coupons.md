# VELORA — Promotional Coupons & Vouchers (FR-12)

Single-coupon engine: at most one coupon per order, product promotions apply
first (unit prices), then the coupon applies to the discounted merchandise
subtotal. The engine never double-counts and stacking is structurally
impossible (one `couponCode` field end to end).

## Schema

- `coupons`: `code` (normalized uppercase, unique), `type`
  (PERCENTAGE|FIXED), `value` (major-unit numeric, >0; percentage ≤100),
  `minimum_order_amount` (≥0), `maximum_discount_amount` (≥0,
  percentage-only), `usage_limit` / `per_user_limit` (nullable, ≥0),
  `usage_count` (≥0), `starts_at` / `expires_at` (ordered when both set),
  `is_active`, timestamps. Code alphabet: `A–Z0–9-_`, 3–32 chars, enforced
  by CHECK plus application normalization.
- `couponusages`: one row per redemption with `coupon_id`, `user_id`,
  `order_id`, `discount_amount`, plus an immutable snapshot (`code`, `type`,
  `value` as applied). Unique `(coupon_id, order_id)` — retries can never
  duplicate redemption records. Pre-policy rows keep NULL snapshots
  ("unknown", never fabricated).
- Migration `0022_coupon_limits_and_snapshots` (additive, idempotent,
  validated on empty tables — zero legacy violations).

## Validation (`validateCouponForCheckout`)

One consistent `now` per call; single clock for the window. Order: exists →
active → window → global limit → **per-user limit** (live usage rows for
this user) → minimum subtotal (exact-decimal) → discount > 0. Currency is
the checkout currency (USD-only policy); misconfigured terms fail as
expected business errors, never internals. The coupon row is locked
(`FOR UPDATE`), so the check and the later consume in the same Tx1 are
atomic against concurrent checkouts.

## Calculation (exact decimal, half-up once)

- Percentage: `subtotal × value/100`, capped by `maximumDiscountAmount`.
- Fixed: `min(value, subtotal)`.
- Never negative, never above subtotal; engine re-checks `coupon ≤ subtotal`.
- Total: `subtotal − promo − coupon + shipping + tax`; tax base follows the
  configured policy (coupon reduces the merchandise base).

## Redemption point & capacity policy

**Usage is consumed at order creation** (Tx1: order + usage row + counter,
one transaction) and **released when the order can never be paid**:
customer/staff cancel, payment failure (lifecycle + webhook), checkout
expiry, and reservation-failure compensation — all via guarded
`releaseCouponUsageForOrder` (deletes the order's rows, decrements each
coupon by exactly the deleted count clamped at zero; idempotent, in-tx).
Failed payments, cancelled checkouts, and expired reservations therefore
never burn global or per-user capacity, and retries can't oversubscribe or
free phantom capacity. Duplicate submissions replay the winner's order
(idempotency key) without re-consuming.

## Snapshots & history

`couponusages` freezes code/type/value/discount per order; `orders` freezes
totals. Renaming, editing, or deactivating a coupon never touches past
orders (tested). Payment init and refunds read the persisted total only.
A `usageLimit` below consumed usage is rejected on edit (deactivate
instead).

## Admin (`/admin/coupons`)

`requireAdmin` (ADMIN/STAFF) on every mutation and read; customers cannot
reach coupon management. Searchable/paginated list with derived statuses
(ACTIVE/SCHEDULED/EXPIRED/EXHAUSTED/INACTIVE from one clock), create/edit
forms with server-side Zod + domain validation, duplicate-code conflicts as
domain errors, two-step deactivation confirm, per-coupon redemption history
(order links, no PII beyond order association). Datetimes entered and
rendered as UTC (matches the DB wall convention). No payment secrets or
usage history leak to checkout: preview exposes only validity + discount.

## Checkout integration

UI applies/removes one code; preview validates server-side without
consuming; placement revalidates under lock and aborts on drift
(`TotalChangedError` → reconfirm). A coupon deactivated/expired/exhausted
between preview and placement fails placement as `CouponInvalidError`
(tested) — the customer reconfirms without it. No inventory moves on
preview/apply.

## Tests

- Unit: code normalization, status derivation, decimal term validation,
  action guards.
- Integration (`tests/integration/coupons/`): admin CRUD + conflicts +
  validation, list/search/pagination/status, usage history, sequential and
  concurrent per-user/global caps, idempotent resubmission, release on
  cancel/failure/expiry (+ repeat-release clamp), mid-flight
  deactivation/expiry, snapshot immutability, payment-from-snapshot.

## Limitations

- USD only; one coupon per order; no product/category-scoped coupons.
- Usage rows for still-PENDING (unpaid, unexpired) orders hold capacity
  until the order resolves — by design (prevents oversubscription).
- No rate limiting on coupon preview beyond existing infrastructure; no
  live-payment verification performed.

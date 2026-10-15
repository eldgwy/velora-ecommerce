# VELORA — Product Promotions & Flash Sales

Automatic product-level discounts applied to the unit price before coupons.
One promotion per unit; coupons stack after (single coupon per order).

## Schema

- `promotions`: `name`, `description`, `type` (PERCENTAGE|FIXED), `value`
  (major-unit numeric, >0; percentage ≤100), `starts_at` (NOT NULL — missing
  means "active from creation"), `ends_at` (NULL = open-ended flash sale
  that never expires by time), `is_active`, timestamps.
- `promotion_products`: (promotion, product) mappings, unique per pair.
  Mappings are product-level; every ACTIVE variant of a mapped product is
  eligible at its own list price (variant override else product base).
- Migration `0023`: CHECKs on values/windows + `order_items`
  `regular_unit_price` / `promotion_name` snapshot columns (nullable; legacy
  rows keep NULL = unknown). Legacy audit: zero violations, no dup mappings.
- `order_items` already froze effective `unit_price`, promo `discount_amount`,
  and `promotion_id`; the new columns complete the line's self-explanation.

## Eligibility (server-side, one clock per operation)

Active flag + `startsAt <= now <= endsAt` (NULL ends = open) + product
mapped + variant/product ACTIVE and purchasable + valid terms. No scheduler
toggles state: windows are evaluated live at each pricing call, so future
sales stay dark and expired/deactivated ones vanish without a job. Frontend
timers/badges are display hints only.

## Selection & math (centralized, exact)

`modules/promotions/domain/promotion-rules.ts` is the single authority used
by cart, checkout, preview, and storefront display:

- Math: exact decimal, half-up once; percentage on the unit price, fixed
  capped at the unit price; never negative; invalid terms yield no discount.
- Overlaps: lowest effective unit price wins; ties break by promotion id
  ascending (stable regardless of DB row order); zero-saving candidates
  never apply (no badge without a lower price).
- Engine invariant per line: `discount ≤ list`, `effective == list − saving`
  (`calculation.ts`), so a 100%-off line (saving == list, effective zero) is
  legal and anything inconsistent fails loudly.

Order of operations: list → promo → merchandise subtotal → coupon on that
subtotal → shipping/tax per configured policy → total. Tax base follows the
jurisdiction rules (promo + coupon reduce the merchandise base).

## Snapshots & history

Each `order_items` row freezes regular price, effective price, discount,
promotion id + name, quantity, and line total. Payment init and refunds read
persisted totals only. Editing, renaming, deactivating, unmapping, or
deleting a promotion never touches past orders (tested). Idempotent
replacement replays the winner's order without re-discounting. A promotion
dying between preview and placement trips the existing `expectedTotalCents`
confirmation (`TotalChangedError` → customer reconfirms, tested).

## Storefront display

`getVariantPromotionViews` (detail/VariantSelector) and
`getProductPromotionSummaries` (grids) batch mappings + prices — no
per-card/per-variant queries. `PromotionPrice` is presentational only
(props in, no math). Badges render only when the price is actually lower,
with the promo name and UTC end date. Marketing-home sections still use
static constants (not catalog data) and are untouched.

## Cache behavior

Display data rides the existing 60 s tagged caches (`productsListing`).
Every promotion mutation (create/update/activate/map/unmap) invalidates the
affected products' caches; commands degrade gracefully outside Server
Actions (tests/jobs), where the time window bounds staleness. Checkout and
cart pricing never read these caches — always authoritative.

## Admin (`/admin/promotions`)

`requireAdmin` on all reads/mutations. List (search, status filter,
pagination, product counts), create/edit with server-side Zod + domain
validation (duplicate mappings → domain conflicts), two-step deactivation,
detail with mapping manager (search + map/unmap) — no raw DB errors leak.
Datetimes entered/rendered as UTC.

## Tests

- Unit: exact math incl. fractional-cent cases, tie-break determinism,
  windows, action guards.
- Integration: admin CRUD/validation/mapping/list/detail + invalidation
  call; windows/eligibility/unmapped; overlap lowest-wins + id tie-break;
  100%-off clamp; preview↔placement agreement; mid-flight expiry via
  confirmation; replay idempotency; coupon-on-promo-subtotal; snapshot
  freeze across edit/rename/unmap/deactivate.
- Regression: full suite green (cart, checkout, coupon, order, payment,
  refund, inventory included).

## Limitations

- Product-level mappings only (no per-variant or category-wide promos).
- `starts_at` NOT NULL (admin blank start = now); USD only; one coupon.
- Storefront prices refresh within the 60 s cache window after edits.
- No live-payment verification performed.

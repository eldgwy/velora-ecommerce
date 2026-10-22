# VELORA — Executive Dashboard & Order Fulfillment

## Metric definitions

All revenue metrics aggregate **persisted snapshots** with exact-decimal
math (SQL `numeric` sums, Decimal.js division) — never repriced, never
binary floating point.

- **Qualifying population:** orders with status PROCESSING, SHIPPED, or
  DELIVERED (paid or COD-fulfilled flow). PENDING, CANCELLED, failed, and
  unpaid orders are excluded from every revenue metric.
- **GMV:** `SUM(total_amount)` over qualifying USD orders in the period
  (post-discount order totals as charged).
- **Net revenue:** GMV minus COMPLETED refunds recorded in the period
  against qualifying orders (refunds on excluded orders never reduce net).
- **Total orders:** count of the qualifying USD population in the period.
- **AOV:** GMV ÷ order count, half-up to cents; null (shown as "—") when
  empty — never a fake zero.
- **Inventory alerts:** open low-stock alerts (PENDING + PROCESSING) via
  the established `low_stock_alerts` rules — no invented thresholds.
- **Sales velocity:** daily GMV buckets (UTC-day walls, matching the stored
  timestamp convention so session timezone cannot shift boundaries),
  ascending, no gap-filling; days without qualifying orders have no bucket.
- **Order status distribution:** counts EVERY order placed in the period
  (including PENDING and CANCELLED) grouped by the persisted lifecycle
  status — an operational volume view, separate from the revenue
  population above.
- **Payment status distribution:** counts orders in the period by the
  persisted `payment_status` snapshot on orders (no payment secrets).
- **Top-selling products:** ranks by GROSS UNITS SOLD on qualifying USD
  orders in the period, grouped by persisted `order_items.sku` snapshot
  with `MAX(product_name)` as the label; net sales is the SUM of the
  persisted line totals. Refunds never retro-adjust units (their revenue
  impact is already in net revenue); deterministic sku tie-break;
  cancelled, pending, failed, and non-USD orders never contribute.
- **Currency:** USD-only system. Non-USD rows in range are counted
  (`excludedNonUsdOrders`) and excluded — never converted.
- **Periods:** half-open `[from, to)` UTC days, max 90 days; invalid or
  inverted ranges reject loudly.
- **Dashboard period selector:** `?range=` presets — `today` (the current
  UTC day), `7d`, `30d` (default), `90d` (the maximum) — each ending at
  tomorrow's UTC wall so "today" is always complete. An explicit
  `?from=&to=` custom window (YYYY-MM-DD, the existing convention) always
  takes precedence over a preset; a one-sided or malformed custom window
  falls back to the 30-day default instead of extrapolating. The selected
  preset ONLY supplies bounds — all filters validate against the same
  business rules listed above.

## Freshness and caching

The dataset computes live per page load (`force-dynamic` admin pages) and
is labeled "refreshed on load" — near-real-time, not cached real-time.
There are no order cache tags to invalidate; fulfillment uses
`router.refresh()`. Fulfillment decisions never read dashboard caches.

## Fulfillment

- Grid: server-side status/payment/customer/order-number/date filters with
  deterministic pagination; customer names joined (no N+1, no extra PII).
- Single and batch shipment both execute the existing `shipOrder`
  lifecycle per order (row locks, audit rows, notifications) — no parallel
  state machine. Batch: max 50, sequential, per-order success/failure
  results, explicit confirm step, retries safe via idempotent replays.
- Manifest (`/admin/orders/manifest`): PROCESSING/SHIPPED selections only;
  ineligible ids reported with reasons. Snapshot addresses, line items,
  notes; no payment secrets or credentials. Print stylesheet isolates
  manifests with page breaks; `robots: noindex`.

## Permissions

`requireAdmin` (ADMIN/STAFF) on every page, query action, batch mutation,
and manifest request; proxy enforces `/admin/*`. Actor identity from the
session; all ids/filters/dates validated server-side.

## Tests

- Unit: range validation/normalization.
- Integration: GMV/net/AOV/count populations (incl. EUR exclusion),
  empty-range nulls, velocity buckets/order, alert math, grid filters
  (independent + combined + deterministic), field allowlist, batch mixed
  outcomes + limits + auth, manifest inclusion/exclusion/privacy + auth.
- Regression: full suite green.

## Limitations and open decisions

- No previous-period comparison (deferred: needs a second reliable range
  fetch — straightforward follow-up, not claimed).
- No tracking numbers/carrier integration (none exists; manifest is a
  packing manifest, not a label).
- Batch cap of 50 is a documented proposal, not a business-approved
  policy — see code comment.
- Single currency; refunds attributed by creation date.


## Dashboard pagination (T-? admin consistency upgrade)

- `shared/components/ui/pagination.tsx` renders the numbered pagination
  used by every admin list page: Previous/Next plus directly selectable
  page numbers with bounded ellipses (at most 7 numbers + 2 ellipses for
  any page count) and a "Page x of y" indicator. The active page carries
  `aria-current="page"`; Previous is disabled on page 1, Next on the last
  page. Pure server-rendered links — no client JS, preserves all existing
  query parameters via the page's `buildHref`.
- `parsePageParam` is the single sanitizer for `?page=`: non-numeric,
  non-integer, zero, and negative values decode to page 1; absurd values
  clamp to a bounded ceiling (100,000). Out-of-range pages render an empty
  list with the real page indicator instead of breaking.
- URL convention: `page` is additive; pages keep their existing
  `status`/`q`/`from`/`to`-style parameters untouched. Filter forms submit
  without `page`, naturally resetting to page 1.
- Routes by shape (audited):
  - Server-paginated + numbered UI: orders, products (new `listAdminProducts`
    service query), inventory, customers, reviews, questions, coupons,
    promotions, collections, banners.
  - Numbered pagination, hierarchical slicing: categories — pages are
    contiguous runs of ROOT categories, each rendered together with its
    complete subtree so a family can never split across a page boundary
    (`pageCategoriesByRoot`). Categories are a bounded navigation
    structure, so the tree is built once per request and sliced by root
    by design; orphans stay visible on every page they occur on.
  - Numbered pagination via the shared service-level query:
    brands (`listAdminBrands`, name ASC with id tie-breaker, page size 20).
  - No pagination (by design): the dashboard, and the order manifest
    tool.
- Service-level requirements: filter/sort first, then `LIMIT/OFFSET`, an
  exact `COUNT` over the same filtered population for totalPages, and a
  deterministic `ORDER BY` with a unique tie-breaker (e.g. products: 
  `created_at DESC, id DESC`). Page size stays 20 per admin page unless a
  page documents otherwise; page size is clamped server-side (max 100).

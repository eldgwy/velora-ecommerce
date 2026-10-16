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
- **Currency:** USD-only system. Non-USD rows in range are counted
  (`excludedNonUsdOrders`) and excluded — never converted.
- **Periods:** half-open `[from, to)` UTC days, max 90 days; invalid or
  inverted ranges reject loudly.

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

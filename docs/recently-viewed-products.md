# VELORA — Recently Viewed Products & Browsing History

Customers revisit previously viewed products from product pages and a
dedicated account page. No analytics subsystem, no behavioral tracking.

## Audit findings

No view-tracking, history, or browser-storage utilities existed. Reused:
`getProductById` eligibility, session/admin guards, wishlist query patterns
(single-join detail, batched membership), account page conventions,
`WishlistToggle` interaction patterns, migration/journal conventions.

## Persistence strategy

- **Authenticated:** `product_view_history` — one row per (customer,
  product) with the most recent view time. Repeat views upsert in place
  (unique constraint arbitrates races); rows beyond 20 per customer prune
  on write. Product deletion cascades (never stale); account deletion
  cascades (no orphaned tracking).
- **Guests:** bounded browser-local id list (`velora_recently_viewed`,
  20 entries, ids + timestamps only). Details always resolve server-side;
  stored metadata is never trusted. No cookies, no server rows, no PII.
- **What is stored:** product ids + view timestamps (server), same in
  browser storage (guest). Never prices, stock, images, IPs, or fingerprints.

## Data model and constraints

`product_view_history(id, user_id → user cascade, product_id → products
cascade, viewed_at)`, unique `(user_id, product_id)`, index
`(user_id, viewed_at)` for recency ordering. Migration `0026` (forward-only,
idempotent, applied, journaled `idx: 26`). New table — no legacy data.

## Recording rules

A view records only on a valid product detail page for an existing ACTIVE
product (admin previews and DRAFT products rejected). Mount-once recorder:
authenticated visitors persist via session identity (fire-and-forget, never
blocks SSR, failures swallowed); guests append locally (deduped, capped,
corrupt storage → empty history, never an error). Upsert idempotency makes
StrictMode double-mounts and retries harmless.

## History limit and retention

20 entries everywhere (server prune-on-write, guest cap, resolver cap).
No scheduler: the bound is enforced at write time. Guest storage persists
until merge or manual browser clearing.

## Account isolation and privacy

Every server predicate scopes to the session author — cross-account reads,
updates, deletes, and clears are structurally impossible (tested). Guest
storage clears after a successful merge, so shared devices never re-merge
into another account. Sign-in merge re-validates every id server-side,
preserves guest timestamps (clamped, never regressing fresher server
recency), caps at 20, and is idempotent.

## Cache and performance safeguards

History is per-user dynamic data: account/queue pages are `force-dynamic`;
mutations `revalidatePath` only the history page plus `router.refresh()`.
Detail rendering never waits on history writes; resolution is 2–3 batched
queries (no N+1); personalized data never enters shared caches. No new
cache layer.

## Migration details

`0026_product_view_history.sql` (CREATE TABLE/INDEX IF NOT EXISTS;
reverse: drop table). Journal `idx: 26`. Applied cleanly to the dev
database.

## Tests and known limitations

- Unit: guest payload parsing (malformed/dedupe/cap/never-throws),
  prepend/refresh, action guards (10 tests).
- Integration: record/refresh/dedupe, concurrent repeats, invalid-product
  rejection, limit pruning + deterministic order, remove/clear isolation,
  merge (validation, idempotency, recency preservation), guest resolution,
  session-scoped merge (17 tests).
- Limitations: no "clear guest history" UI affordance beyond per-item
  remove (storage clears on merge); listing cards don't surface history;
  no cross-device sync for guests; driver cannot bind `Date` in raw SQL
  (ISO walls used — same convention as the coupon list query).

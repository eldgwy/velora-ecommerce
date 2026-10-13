# VELORA — Customer Wishlist (FR-07)

## Storage

One persistent `wishlist` row per customer (`wishlist_user_id_unique`);
items in `wishlist_items` keyed by the exact unique index
`wishlist_items_wishlist_product_unique`. Both tables, constraints, and
indexes already existed live and match the Drizzle declarations, so no
migration was required (verified column-by-column against
`information_schema`).

## Rules

- Authenticated customers only; identity comes exclusively from the verified
  server session. Guests receive a sign-in prompt with a return path — no
  guest persistence.
- Inputs are product ids only (Zod uuid). No wishlist/item/user ids cross the
  boundary, so there is nothing to forge into another customer's data; every
  statement is additionally scoped to the caller's wishlist row.
- Eligibility reuses the storefront rule (`getProductById`: `ACTIVE` status
  plus effective category visibility). DRAFT/ARCHIVE/missing products are
  rejected on add; rows saved before archival stay listed (flagged by live
  `status`) so the customer can remove them; deleted products vanish via the
  cascade and are never shown stale.
- Duplicate adds are idempotent (`onConflictDoNothing` on the unique index —
  race-safe, no read-modify-write); removal of absent items returns
  `{ removed: false }`.
- Moving to the bag delegates to the cart lifecycle (`addItemToCart` with the
  first `ACTIVE` variant); the save is removed only after the cart write
  succeeds. A wishlist never reserves inventory, locks prices, or recalculates
  totals. Prices/availability on the page are live catalog reads with an
  explicit may-change notice.

## Consistency

- Wishlist reads are a single joined query (no N+1); membership for grids is
  one batched query (`getSavedProductIds`).
- Mutations call `revalidatePath("/account/wishlist")`; toggles call
  `router.refresh()` after settling. No shared cache tags (per-user dynamic).
- No clear-wishlist operation (out of scope); no cart/checkout/inventory/
  payment code was touched.

## Follow-up work

- Home showcase cards use static data with decorative hearts (out of scope).
- No wishlist count badge in the navbar; no share/compare features.

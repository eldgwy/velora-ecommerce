# VELORA — Curated Marketing Collections

Named, ordered product edits (Trending Now, Summer Essentials, Editor's
Picks) with cover images, publication control, and storefront routes.

## Data model

- `collections`: name (1–120), unique URL-safe slug (lowercase
  alphanumerics + single dashes, 3–64, normalized application-side),
  description (≤2000), `image` (provider-uploaded HTTPS URL), `isActive`
  (default false — nothing is public until published), `sortOrder`
  (collection display order), timestamps.
- `collection_products`: (collection, product) mappings with dense
  `sortOrder` positions 0..n-1, unique per pair, cascade on collection
  delete, restrict on product delete.
- Migrations `0027` (CHECKs) + `0028` (the declared mapping unique index,
  found missing live and reconciled — zero duplicate pairs at authorship).
  Both forward-only, idempotent, applied, journaled (`idx: 27, 28`).

## Operations

- Create (slug derived from name unless overridden; races → domain
  conflict), update, publish/unpublish — all `requireAdmin`, all validated
  server-side (Zod + domain), actor from the session.
- Mapping: append lands at end (`max+1`); duplicates → domain conflict;
  removal collapses positions densely in-transaction; reorder takes an
  explicit array that must equal the mapped set exactly (no missing,
  extra, or foreign ids) and writes dense positions in one transaction.
- Cover images reuse the Cloudinary signed-upload flow (folder
  `velora/collections/{id}`, JPEG/PNG/WebP ≤10 MB); only the secure URL
  persists. No new storage infrastructure.

## Storefront

- Routes `/collections` (published index, admin order) and
  `/collections/[slug]` (header + ordered cards) — wiring the previously
  dead Hero/Promotion/Footer links. Metadata per collection; `notFound()`
  for missing/unpublished slugs; empty states for bare collections.
- Public queries exclude unpublished collections and non-ACTIVE products
  in the data-access layer. Cards reuse the shared `ProductCard`
  (extracted from the products page — identical markup, wishlist, promo
  pricing) with batched wishlist state + promotion summaries.
- Display prices resolve per product through canonical catalog data (no
  frozen snapshots in mappings); checkout still prices authoritatively.

## Cache behavior

New tags `collections:list` + `collection:{slug}`; every mutation
(create/update/publish/map/unmap/reorder) invalidates the list and the
affected slug. Commands degrade gracefully outside Server Actions (tests),
where the route revalidate window bounds staleness. No product/checkout
caches are touched.

## Tests

- Unit: slug normalization/validation, field validation, action guards.
- Integration: CRUD, slug conflicts (incl. 3-way concurrent race),
  activation, append/dedupe/dense reorder/remove, invalid reorder
  rejection, rollback integrity, public filtering, ordered cards,
  archive-dropout, unpublish hiding, admin search/filter/pagination.
- Regression: full suite green (products listing refactor covered by
  existing listing tests).

## Limitations

- Cover is a single image (no mobile variant — responsive delivery via
  the image component + object-cover).
- No scheduled publishing (windows are `isActive` only, unlike
  promotions); no collection-level analytics; no drag-and-drop reorder
  (up/down + explicit save).
- `sortOrder` gaps are normalized on read path (`?? index`).

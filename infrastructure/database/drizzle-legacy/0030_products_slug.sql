-- 0030_products_slug
-- GP-05 (T-1.9): give every product a stable, URL-safe public identifier.
--
-- Additive, executed as one transaction:
-- 1. Add nullable `products.slug`.
-- 2. Backfill deterministically: slugified `name` (lowercased, [a-z0-9]
--    runs folded to '-', trimmed, clipped to 64 chars, 'product' when the
--    base ends up empty) plus the lowercase 8-hex tail of the product id.
--    The id suffix makes the value unique by construction, so the same
--    input always yields the same slug on every database and no collision
--    remediation pass is needed.
-- 3. SET NOT NULL only after the backfill has touched every row.
-- 4. Unique index `products_slug_unique_idx` enforces the contract in the
--    database, not just in code.
--
-- Legacy product-UUID URLs keep resolving: getProductBySlug matches the
-- slug column OR the id column (documented compatibility contract).
--
-- Rollback (reverse):
--   DROP INDEX IF EXISTS "products_slug_unique_idx";
--   ALTER TABLE "products" ALTER COLUMN "slug" DROP NOT NULL;
--   ALTER TABLE "products" DROP COLUMN IF EXISTS "slug";

ALTER TABLE "products" ADD COLUMN "slug" text;
--> statement-breakpoint
UPDATE "products"
SET "slug" =
  coalesce(
    nullif(
      btrim(
        left(
          btrim(lower(regexp_replace(btrim("name"), '[^A-Za-z0-9]+', '-', 'gi')), '-'),
          64
        ),
        '-'
      ),
      ''
    ),
    'product'
  ) || '-' || lower(right("id"::text, 8));
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_unique_idx" ON "products" ("slug");

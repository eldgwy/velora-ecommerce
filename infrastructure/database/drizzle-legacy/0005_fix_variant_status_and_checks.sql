-- Fix product_variant status column name typo: is_acitve -> is_active
ALTER TABLE "product_variant" RENAME COLUMN "is_acitve" TO "is_active";

-- Add check constraint: products.base_price > 0
ALTER TABLE "products" ADD CONSTRAINT "products_base_price_positive" CHECK ("base_price" > 0);

-- Add check constraint: products.compare_price IS NULL OR compare_price >= base_price
ALTER TABLE "products" ADD CONSTRAINT "products_compare_price_valid" CHECK ("compare_price" IS NULL OR "compare_price" >= "base_price");

-- Add check constraint: product_variant.price_override IS NULL OR price_override > 0
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_price_override_positive" CHECK ("price_override" IS NULL OR "price_override" > 0);

-- Update indexes that reference the old column name
DROP INDEX IF EXISTS "product_variant_status_idx";
DROP INDEX IF EXISTS "product_variant_product_status_idx";

CREATE INDEX "product_variant_status_idx" ON "product_variant" USING btree ("is_active");
CREATE INDEX "product_variant_product_status_idx" ON "product_variant" USING btree ("product_id", "is_active");
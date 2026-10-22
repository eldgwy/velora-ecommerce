-- 0018_reconcile_missing_constraints
-- Phase 1 reliability audit: reconcile declared-but-absent constraints.
--
-- Evidence (verified 2026-10-12 against the live development database;
-- full per-constraint report in docs/db-integrity.md):
--   * 36 of 41 declared foreign keys are absent (only account/session/
--     addresses/low_stock_alerts/order_notifications have them).
--   * 10 declared unique indexes are absent; duplicate scans returned zero
--     violations for all of them, so plain CREATE UNIQUE INDEX is safe here.
--   * 35 declared plain indexes are absent.
--   * All 8 declared CHECK constraints are present — nothing to do.
--   * Orphaned child rows exist (test residue; see docs/db-integrity.md).
--     Per policy no data is deleted or repaired by this migration.
--
-- Safety design:
--   * Uniques/indexes use IF NOT EXISTS and were preflighted violation-free.
--   * Every FK is added NOT VALID: only a brief SHARE ROW EXCLUSIVE lock, no
--     table scan, existing rows (including known orphans) do not block the
--     migration. New writes are validated immediately.
--   * Follow-up: after reviewing/repairing orphans with the preflight
--     queries in docs/db-integrity.md, run
--       ALTER TABLE <child> VALIDATE CONSTRAINT <name>;
--     VALIDATE takes a SHARE UPDATE EXCLUSIVE lock (reads/writes continue)
--     and promotes the constraint to full enforcement.
--   * Production note: on large tables prefer CREATE INDEX CONCURRENTLY
--     out-of-band for the plain indexes; it cannot run inside the
--     migrator's transaction.
--
-- Rollback (reverse): DROP INDEX IF EXISTS for each index below, and
--   ALTER TABLE <child> DROP CONSTRAINT IF EXISTS <fk> for each FK.

-- ================= A. Missing unique indexes (preflighted: no duplicates) ===

CREATE UNIQUE INDEX IF NOT EXISTS "brand_slug_unique"
  ON "brand" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_unique"
  ON "categories" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collections_slug_unique"
  ON "collections" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_images_public_id_unique"
  ON "product_images" USING btree ("public_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_images_url_unique"
  ON "product_images" USING btree ("url");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_images_product_primary_unique"
  ON "product_images" USING btree ("product_id") WHERE is_primary = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_option_product_name_unique"
  ON "product_option" USING btree ("product_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_user_product_unique"
  ON "reviews" USING btree ("user_id", "product_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wishlist_user_id_unique"
  ON "wishlist" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wishlist_items_wishlist_product_unique"
  ON "wishlist_items" USING btree ("wishlist_id", "product_id");
--> statement-breakpoint

-- ================= B. Missing plain indexes =================

CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" USING btree ("identifier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_parent_id_idx" ON "categories" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_is_active_idx" ON "categories" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_parent_active_idx" ON "categories" USING btree ("parent_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_name_idx" ON "brand" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_category_id_idx" ON "products" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_brand_id_idx" ON "products" USING btree ("brand_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_status_idx" ON "products" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_created_at_idx" ON "products" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_category_status_idx" ON "products" USING btree ("category_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_brand_status_idx" ON "products" USING btree ("brand_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_product_id_idx" ON "product_images" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_product_sort_idx" ON "product_images" USING btree ("product_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_option_product_id_idx" ON "product_option" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_option_value_option_id_idx" ON "product_option_value" USING btree ("option_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variant_option_value_option_value_idx" ON "variant_option_value" USING btree ("option_value_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_product_id_idx" ON "reviews" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_user_id_idx" ON "reviews" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_status_idx" ON "reviews" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_created_at_idx" ON "reviews" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_product_status_idx" ON "reviews" USING btree ("product_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_images_review_id_idx" ON "review_images" USING btree ("review_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_images_review_sort_idx" ON "review_images" USING btree ("review_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wishlist_items_wishlist_id_idx" ON "wishlist_items" USING btree ("wishlist_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wishlist_items_product_id_idx" ON "wishlist_items" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_is_active_idx" ON "collections" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_sort_order_idx" ON "collections" USING btree ("sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_active_sort_idx" ON "collections" USING btree ("is_active", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_products_collection_id_idx" ON "collection_products" USING btree ("collection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_products_product_id_idx" ON "collection_products" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_products_collection_sort_idx" ON "collection_products" USING btree ("collection_id", "sort_order");
--> statement-breakpoint
-- NOTE: `banners.status` is mapped to the physical `is_active` column
-- (see schema/marketing.ts), so the index columns below use `is_active`.
CREATE INDEX IF NOT EXISTS "banners_status_idx" ON "banners" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "banners_sort_order_idx" ON "banners" USING btree ("sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "banners_starts_ends_idx" ON "banners" USING btree ("starts_at", "ends_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "banners_status_sort_idx" ON "banners" USING btree ("is_active", "sort_order");
--> statement-breakpoint

-- ================= C. Missing foreign keys (all NOT VALID) =================
--> statement-breakpoint
-- Each ADD is guarded by a catalog check so the migration is safely re-runnable
--> statement-breakpoint
-- (Postgres has no IF NOT EXISTS for ADD CONSTRAINT).
--> statement-breakpoint
-- Preflight pattern for each (run before VALIDATE, review orphans first):
--   SELECT count(*) FROM <child> c LEFT JOIN <parent> p
--     ON p.<pcol> = c.<ccol> WHERE c.<ccol> IS NOT NULL AND p.<pcol> IS NULL;
-- customer_profile.user_id -> user.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_profile_user_id_user_id_fk') THEN
    ALTER TABLE "customer_profile"
  ADD CONSTRAINT "customer_profile_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- addresses.customer_id -> customer_profile.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'addresses_customer_id_customer_profile_id_fk') THEN
    ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_customer_id_customer_profile_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- categories.parent_id -> categories.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_parent_id_categories_id_fk') THEN
    ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parent_id_categories_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- products.category_id -> categories.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_category_id_categories_id_fk') THEN
    ALTER TABLE "products"
  ADD CONSTRAINT "products_category_id_categories_id_fk"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- products.brand_id -> brand.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_brand_id_brand_id_fk') THEN
    ALTER TABLE "products"
  ADD CONSTRAINT "products_brand_id_brand_id_fk"
  FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- product_images.product_id -> products.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_images_product_id_products_id_fk') THEN
    ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- product_variant.product_id -> products.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variant_product_id_products_id_fk') THEN
    ALTER TABLE "product_variant"
  ADD CONSTRAINT "product_variant_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- product_option.product_id -> products.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_product_id_products_id_fk') THEN
    ALTER TABLE "product_option"
  ADD CONSTRAINT "product_option_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- product_option_value.option_id -> product_option.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_value_option_id_product_option_id_fk') THEN
    ALTER TABLE "product_option_value"
  ADD CONSTRAINT "product_option_value_option_id_product_option_id_fk"
  FOREIGN KEY ("option_id") REFERENCES "product_option"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- variant_option_value.variant_id -> product_variant.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_option_value_variant_id_product_variant_id_fk') THEN
    ALTER TABLE "variant_option_value"
  ADD CONSTRAINT "variant_option_value_variant_id_product_variant_id_fk"
  FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- variant_option_value.option_value_id -> product_option_value.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_option_value_option_value_id_product_option_value_id_fk') THEN
    ALTER TABLE "variant_option_value"
  ADD CONSTRAINT "variant_option_value_option_value_id_product_option_value_id_fk"
  FOREIGN KEY ("option_value_id") REFERENCES "product_option_value"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- inventory.variant_id -> product_variant.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_variant_id_product_variant_id_fk') THEN
    ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_variant_id_product_variant_id_fk"
  FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- inventory_movement.inventory_id -> inventory.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movement_inventory_id_inventory_id_fk') THEN
    ALTER TABLE "inventory_movement"
  ADD CONSTRAINT "inventory_movement_inventory_id_inventory_id_fk"
  FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- cart.user_id -> user.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_user_id_user_id_fk') THEN
    ALTER TABLE "cart"
  ADD CONSTRAINT "cart_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- cart_items.cart_id -> cart.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_id_cart_id_fk') THEN
    ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_cart_id_cart_id_fk"
  FOREIGN KEY ("cart_id") REFERENCES "cart"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- cart_items.variant_id -> product_variant.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_variant_id_product_variant_id_fk') THEN
    ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_variant_id_product_variant_id_fk"
  FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- orders.user_id -> user.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_user_id_user_id_fk') THEN
    ALTER TABLE "orders"
  ADD CONSTRAINT "orders_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- order_items.order_id -> orders.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_id_orders_id_fk') THEN
    ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- order_items.variant_id -> product_variant.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_id_product_variant_id_fk') THEN
    ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_variant_id_product_variant_id_fk"
  FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- order_addresses.order_id -> orders.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_addresses_order_id_orders_id_fk') THEN
    ALTER TABLE "order_addresses"
  ADD CONSTRAINT "order_addresses_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- order_status_histories.order_id -> orders.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_status_histories_order_id_orders_id_fk') THEN
    ALTER TABLE "order_status_histories"
  ADD CONSTRAINT "order_status_histories_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- payments.order_id -> orders.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_order_id_orders_id_fk') THEN
    ALTER TABLE "payments"
  ADD CONSTRAINT "payments_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- refunds.payment_id -> payments.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_payment_id_payments_id_fk') THEN
    ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- webhook_events.order_id -> orders.id ON DELETE SET NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_events_order_id_orders_id_fk') THEN
    ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE set null NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- webhook_events.payment_id -> payments.id ON DELETE SET NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_events_payment_id_payments_id_fk') THEN
    ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE set null NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- reviews.product_id -> products.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_product_id_products_id_fk') THEN
    ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- reviews.user_id -> user.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_user_id_user_id_fk') THEN
    ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- review_images.review_id -> reviews.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_images_review_id_reviews_id_fk') THEN
    ALTER TABLE "review_images"
  ADD CONSTRAINT "review_images_review_id_reviews_id_fk"
  FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- promotion_products.promotion_id -> promotions.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_products_promotion_id_promotions_id_fk') THEN
    ALTER TABLE "promotion_products"
  ADD CONSTRAINT "promotion_products_promotion_id_promotions_id_fk"
  FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- promotion_products.product_id -> products.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_products_product_id_products_id_fk') THEN
    ALTER TABLE "promotion_products"
  ADD CONSTRAINT "promotion_products_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- collection_products.collection_id -> collections.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_products_collection_id_collections_id_fk') THEN
    ALTER TABLE "collection_products"
  ADD CONSTRAINT "collection_products_collection_id_collections_id_fk"
  FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- collection_products.product_id -> products.id ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_products_product_id_products_id_fk') THEN
    ALTER TABLE "collection_products"
  ADD CONSTRAINT "collection_products_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE restrict NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- wishlist.user_id -> user.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_user_id_user_id_fk') THEN
    ALTER TABLE "wishlist"
  ADD CONSTRAINT "wishlist_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- wishlist_items.wishlist_id -> wishlist.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_items_wishlist_id_wishlist_id_fk') THEN
    ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_wishlist_id_wishlist_id_fk"
  FOREIGN KEY ("wishlist_id") REFERENCES "wishlist"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- wishlist_items.product_id -> products.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_items_product_id_products_id_fk') THEN
    ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- couponusages.coupon_id -> coupons.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'couponusages_coupon_id_coupons_id_fk') THEN
    ALTER TABLE "couponusages"
  ADD CONSTRAINT "couponusages_coupon_id_coupons_id_fk"
  FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE cascade NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- couponusages.user_id -> user.id ON DELETE SET NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'couponusages_user_id_user_id_fk') THEN
    ALTER TABLE "couponusages"
  ADD CONSTRAINT "couponusages_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE set null NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- couponusages.order_id -> orders.id ON DELETE SET NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'couponusages_order_id_orders_id_fk') THEN
    ALTER TABLE "couponusages"
  ADD CONSTRAINT "couponusages_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE set null NOT VALID;
  END IF;
END $$;

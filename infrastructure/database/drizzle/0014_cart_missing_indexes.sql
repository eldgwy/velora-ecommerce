-- 0014_cart_missing_indexes
-- Reconcile the database with the declared Drizzle schema for the cart
-- domain. Migration 0000 declares these indexes, but environments
-- provisioned before they were applied (e.g. via `db:push` from an older
-- schema state) are missing them — notably the (cart_id, variant_id)
-- uniqueness constraint that concurrent cart writes rely on as the final
-- backstop alongside application-level locking.
--
-- All statements are IF NOT EXISTS: safe to apply whether or not the
-- indexes already exist. No data is rewritten.
--
-- Rollback (reverse):
--   DROP INDEX IF EXISTS "cart_user_created_idx";
--   DROP INDEX IF EXISTS "cart_user_status_idx";
--   DROP INDEX IF EXISTS "cart_status_idx";
--   DROP INDEX IF EXISTS "cart_user_id_idx";
--   DROP INDEX IF EXISTS "cart_items_variant_id_idx";
--   DROP INDEX IF EXISTS "cart_items_cart_id_idx";
--   DROP INDEX IF EXISTS "cart_items_cart_variant_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_variant_unique"
  ON "cart_items" USING btree ("cart_id", "variant_id");

CREATE INDEX IF NOT EXISTS "cart_items_cart_id_idx"
  ON "cart_items" USING btree ("cart_id");

CREATE INDEX IF NOT EXISTS "cart_items_variant_id_idx"
  ON "cart_items" USING btree ("variant_id");

CREATE INDEX IF NOT EXISTS "cart_user_id_idx"
  ON "cart" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "cart_status_idx"
  ON "cart" USING btree ("status");

CREATE INDEX IF NOT EXISTS "cart_user_status_idx"
  ON "cart" USING btree ("user_id", "status");

CREATE INDEX IF NOT EXISTS "cart_user_created_idx"
  ON "cart" USING btree ("user_id", "created_at");

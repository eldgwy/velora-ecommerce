-- 0013_cart_guest_and_constraints
-- FR-06 shopping cart lifecycle: server-side guest carts, single-active-cart
-- invariant, and positive-quantity enforcement.
--
-- Guest storage strategy: server-side guest `cart` rows owned by an opaque
-- `guest_id` token. The signed guest cookie carries ONLY that identifier —
-- never prices, quantities, or items. All business data stays in Postgres so
-- the existing transactional merge, uniqueness, and inventory checks apply
-- uniformly to guest and authenticated carts.
--
-- Changes (all additive, no data rewritten):
--   1. `cart.user_id` becomes nullable so guest rows can exist without an
--      owner. Every cart must still have exactly one owner (see 4).
--   2. `cart.guest_id` holds the opaque guest token (server-generated UUID).
--   3. Partial unique `cart_user_active_unique` enforces at most one ACTIVE
--      cart per authenticated user, even under concurrent initialization.
--   4. Partial unique `cart_guest_active_unique` enforces at most one ACTIVE
--      cart per guest token (NULL guest_ids never conflict).
--   5. `cart_owner_check` requires user_id OR guest_id on every row.
--   6. `cart_items_quantity_positive` enforces BR-017 (quantity >= 1).
--      Quantity zero is represented by deleting the row.
--
-- Existing `cart` data is empty (0 rows), so the new constraints apply cleanly.
--
-- Rollback (reverse):
--   ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_quantity_positive";
--   ALTER TABLE "cart" DROP CONSTRAINT IF EXISTS "cart_owner_check";
--   DROP INDEX IF EXISTS "cart_guest_active_unique";
--   DROP INDEX IF EXISTS "cart_user_active_unique";
--   DROP INDEX IF EXISTS "cart_guest_id_idx";
--   ALTER TABLE "cart" DROP COLUMN IF EXISTS "guest_id";
--   ALTER TABLE "cart" ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "cart" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "cart" ADD COLUMN IF NOT EXISTS "guest_id" text;

CREATE INDEX IF NOT EXISTS "cart_guest_id_idx" ON "cart" USING btree ("guest_id");

CREATE UNIQUE INDEX IF NOT EXISTS "cart_user_active_unique"
  ON "cart" USING btree ("user_id") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "cart_guest_active_unique"
  ON "cart" USING btree ("guest_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "cart"
  ADD CONSTRAINT "cart_owner_check"
  CHECK ("user_id" IS NOT NULL OR "guest_id" IS NOT NULL);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_positive"
  CHECK ("quantity" >= 1);

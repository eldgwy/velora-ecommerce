-- 0007_inventory_invariants
-- FR-05 Phase 2 (DB enforcement) + Phase 4 (checkout expiration TTL).
--
-- Inventory availability rule, mirrored from services/inventory.service.ts:
--   available = quantity - reserved_quantity  >= 0
--   quantity      >= 0
--   reserved_quantity >= 0
--   reserved_quantity <= quantity
-- These CHECKs are defense-in-depth alongside the app-level FOR UPDATE locks and
-- reject any write that would break availability. Existing `inventory` data is
-- clean (0 rows, 0 violations), so the constraints are safe to append.
--
-- `orders.checkout_expires_at` is the TTL field the Phase 4 expiration job uses
-- to find AUTHORIZED reservations that have held stock past the checkout window.
--
-- Rollback (reverse):
--   ALTER TABLE "inventory"
--     DROP CONSTRAINT IF EXISTS "inventory_reserved_le_quantity",
--     DROP CONSTRAINT IF EXISTS "inventory_reserved_non_negative",
--     DROP CONSTRAINT IF EXISTS "inventory_quantity_non_negative";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "checkout_expires_at";

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_quantity_non_negative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "inventory_reserved_non_negative" CHECK ("reserved_quantity" >= 0),
  ADD CONSTRAINT "inventory_reserved_le_quantity" CHECK ("reserved_quantity" <= "quantity");

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "checkout_expires_at" timestamp;

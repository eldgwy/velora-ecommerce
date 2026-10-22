-- 0008_order_reservation_status
-- Add reservation status tracking to order_items for atomic order-linked inventory reservations.
--
-- The reservation lifecycle states:
--   PENDING     - Order created, reservation not yet attempted
--   RESERVED    - Stock successfully reserved for this order item
--   RELEASED    - Reservation released (order cancelled/expired)
--   COMMITTED   - Reservation converted to sale (order fulfilled/shipped)
--
-- Idempotency: A reservation request for an order with RESERVED items is a no-op.
-- Concurrency: Inventory rows are locked in deterministic variant_id order.

CREATE TYPE order_reservation_status AS ENUM (
  'PENDING',
  'RESERVED',
  'RELEASED',
  'COMMITTED'
);

ALTER TABLE "order_items"
  ADD COLUMN "reservation_status" order_reservation_status
  NOT NULL DEFAULT 'PENDING';

CREATE INDEX "order_items_reservation_status_idx"
  ON "order_items" ("reservation_status");

-- Rollback:
-- DROP INDEX IF EXISTS "order_items_reservation_status_idx";
-- ALTER TABLE "order_items" DROP COLUMN IF EXISTS "reservation_status";
-- DROP TYPE IF EXISTS order_reservation_status;
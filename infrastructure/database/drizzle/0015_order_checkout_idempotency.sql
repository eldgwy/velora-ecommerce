-- 0015_order_checkout_idempotency
-- FR-08/FR-09 checkout idempotency: stable client-supplied idempotency keys
-- with database-level protection against duplicate payable orders.
--
--   1. `orders.idempotency_key` — uuid supplied by the caller per checkout
--      attempt. Retries reuse the same key and receive the original order
--      instead of creating a second one (double-clicks, browser retries,
--      timeouts after commit, simultaneous submissions).
--   2. Unique `(user_id, idempotency_key)` — scope is per user, and
--      concurrent Tx1 inserts with the same key collide here so only one
--      order wins.
--   3. `orders.checkout_hash` — sha256 of the canonical checkout input. When
--      a key is reused with DIFFERENT inputs the server returns 409 instead
--      of silently returning a mismatched order.
--
-- Backfill: existing orders predate idempotency. They receive a fresh random
-- key each (uuidv7-ish via gen_random_uuid) so the NOT NULL constraint
-- applies cleanly; those keys are never reused by clients.
--
-- Rollback (reverse):
--   DROP INDEX IF EXISTS "orders_user_idempotency_unique";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "checkout_hash";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "idempotency_key";

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;

UPDATE "orders"
  SET "idempotency_key" = gen_random_uuid()::text
  WHERE "idempotency_key" IS NULL;

ALTER TABLE "orders"
  ALTER COLUMN "idempotency_key" SET NOT NULL;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "checkout_hash" text;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_idempotency_unique"
  ON "orders" USING btree ("user_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "orders_idempotency_key_idx"
  ON "orders" USING btree ("idempotency_key");

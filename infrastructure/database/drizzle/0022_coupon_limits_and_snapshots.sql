-- 0022_coupon_limits_and_snapshots
-- Promotional coupon hardening (FR-12 follow-up):
--
-- 1. `coupons.per_user_limit` (nullable): maximum successful redemptions
--    per authenticated user, enforced transactionally in checkout.
-- 2. `couponusages` redemption snapshot: `code`, `type`, `value` as applied,
--    so historical orders keep explaining their discount after the coupon
--    is renamed, edited, or deactivated. Pre-policy rows keep NULLs
--    ("unknown", never fabricated).
-- 3. `couponusages` unique (coupon_id, order_id): retries and replays can
--    never duplicate redemption records.
-- 4. `coupons` CHECKs: positive values, percentage ≤ 100, non-negative
--    minimum/maximum amounts and limits, ordered validity windows,
--    non-negative usage counts, code length 3–32 (codes are normalized
--    uppercase by the application).
--
-- Legacy audit (empty tables at authorship; zero violations on every check):
-- no percentage > 100, no non-positive values, no inverted windows, no
-- duplicate (coupon, order) pairs, no out-of-range code lengths — every
-- constraint below validates immediately.
--
-- All statements are idempotent and additive. No data rewritten, no counters
-- reset, no history fabricated.
--
-- Rollback (reverse):
--   DROP INDEX IF EXISTS "couponusages_coupon_order_unique";
--   ALTER TABLE "couponusages"
--     DROP COLUMN IF EXISTS "code",
--     DROP COLUMN IF EXISTS "type",
--     DROP COLUMN IF EXISTS "value";
--   ALTER TABLE "coupons" DROP COLUMN IF EXISTS "per_user_limit";
--   (CHECKs) ALTER TABLE "coupons"
--     DROP CONSTRAINT IF EXISTS "coupons_value_positive",
--     DROP CONSTRAINT IF EXISTS "coupons_percentage_bounded",
--     DROP CONSTRAINT IF EXISTS "coupons_minimum_non_negative",
--     DROP CONSTRAINT IF EXISTS "coupons_max_discount_non_negative",
--     DROP CONSTRAINT IF EXISTS "coupons_window_ordered",
--     DROP CONSTRAINT IF EXISTS "coupons_usage_limit_non_negative",
--     DROP CONSTRAINT IF EXISTS "coupons_per_user_limit_non_negative",
--     DROP CONSTRAINT IF EXISTS "coupons_usage_count_non_negative",
--     DROP CONSTRAINT IF EXISTS "coupons_code_length";

ALTER TABLE "coupons"
  ADD COLUMN IF NOT EXISTS "per_user_limit" integer;
--> statement-breakpoint
ALTER TABLE "couponusages"
  ADD COLUMN IF NOT EXISTS "code" text;
--> statement-breakpoint
ALTER TABLE "couponusages"
  ADD COLUMN IF NOT EXISTS "type" "coupon_type";
--> statement-breakpoint
ALTER TABLE "couponusages"
  ADD COLUMN IF NOT EXISTS "value" numeric;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "couponusages_coupon_order_unique"
  ON "couponusages" USING btree ("coupon_id", "order_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_value_positive'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_value_positive" CHECK ("value" > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_percentage_bounded'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_percentage_bounded"
      CHECK ("type" <> 'PERCENTAGE' OR "value" <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_minimum_non_negative'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_minimum_non_negative"
      CHECK ("minimum_order_amount" IS NULL OR "minimum_order_amount" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_max_discount_non_negative'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_max_discount_non_negative"
      CHECK ("maximum_discount_amount" IS NULL OR "maximum_discount_amount" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_window_ordered'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_window_ordered"
      CHECK ("starts_at" IS NULL OR "expires_at" IS NULL OR "expires_at" > "starts_at");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_usage_limit_non_negative'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_usage_limit_non_negative"
      CHECK ("usage_limit" IS NULL OR "usage_limit" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_per_user_limit_non_negative'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_per_user_limit_non_negative"
      CHECK ("per_user_limit" IS NULL OR "per_user_limit" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_usage_count_non_negative'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_usage_count_non_negative"
      CHECK ("usage_count" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_code_length'
  ) THEN
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_code_length"
      CHECK (char_length("code") BETWEEN 3 AND 32);
  END IF;
END $$;

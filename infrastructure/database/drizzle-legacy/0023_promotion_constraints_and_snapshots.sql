-- 0023_promotion_constraints_and_snapshots
-- Product promotions hardening:
--
-- 1. `promotions` CHECKs: positive values, percentage ≤ 100, ordered
--    validity windows (`endsAt > startsAt` when both set; NULL `ends_at`
--    remains a defined open-ended promotion).
-- 2. `order_items` snapshot columns: `regular_unit_price` (authoritative
--    list price before the promotion) and `promotion_name` (historical
--    description of the applied promotion). Both nullable: the 153 legacy
--    rows keep NULLs ("unknown", never fabricated). New orders populate
--    them alongside the existing `unit_price` (effective), `discount_amount`
--    (promo saving), and `promotion_id`.
--
-- Legacy audit (zero violations on every check): no percentage > 100, no
-- non-positive values, no inverted windows, no duplicate product mappings —
-- every constraint below validates immediately. No data rewritten.
--
-- Rollback (reverse):
--   ALTER TABLE "order_items"
--     DROP COLUMN IF EXISTS "regular_unit_price",
--     DROP COLUMN IF EXISTS "promotion_name";
--   ALTER TABLE "promotions"
--     DROP CONSTRAINT IF EXISTS "promotions_value_positive",
--     DROP CONSTRAINT IF EXISTS "promotions_percentage_bounded",
--     DROP CONSTRAINT IF EXISTS "promotions_window_ordered";

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "regular_unit_price" numeric;
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "promotion_name" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotions_value_positive'
  ) THEN
    ALTER TABLE "promotions"
      ADD CONSTRAINT "promotions_value_positive" CHECK ("value" > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotions_percentage_bounded'
  ) THEN
    ALTER TABLE "promotions"
      ADD CONSTRAINT "promotions_percentage_bounded"
      CHECK ("type" <> 'PERCENTAGE' OR "value" <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotions_window_ordered'
  ) THEN
    ALTER TABLE "promotions"
      ADD CONSTRAINT "promotions_window_ordered"
      CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
  END IF;
END $$;

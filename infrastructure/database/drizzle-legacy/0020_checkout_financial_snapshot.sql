-- 0020_checkout_financial_snapshot
-- FR-08 financial snapshot gaps: persist everything needed to reproduce and
-- explain the charged amount without repricing from mutable catalog data.
--
--   orders.shipping_method      selected method id (was derivable nowhere)
--   orders.tax_jurisdiction     resolved jurisdiction id, or UNCONFIGURED
--   orders.tax_rate_bps         applied rate in basis points
--   orders.taxable_base         merchandise-after-coupon + taxable shipping
--   orders.pricing_policy_version  engine version ("1" legacy, "2" decimal)
--   order_items.promotion_id    promotion applied to the line, if any
--                               (nullable UUID, deliberately NO foreign key:
--                               promotions are deletable; the snapshot must
--                               survive them)
--   product_variant.weight_grams  authoritative per-unit weight for shipping
--                               (nullable: unknown weight is a defined input
--                               meaning "limits skipped", never guessed)
--
-- All additive and nullable except the policy default. Historical rows keep
-- NULL jurisdiction/method/promotion (pre-policy) and version "1" — no
-- values are fabricated for old orders. No data rewritten, no backfill.
--
-- Rollback (reverse):
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_method";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "tax_jurisdiction";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "tax_rate_bps";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "taxable_base";
--   ALTER TABLE "orders" DROP COLUMN IF EXISTS "pricing_policy_version";
--   ALTER TABLE "order_items" DROP COLUMN IF EXISTS "promotion_id";
--   ALTER TABLE "product_variant" DROP COLUMN IF EXISTS "weight_grams";

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "shipping_method" text;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "tax_jurisdiction" text;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "tax_rate_bps" integer;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "taxable_base" numeric;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "pricing_policy_version" text NOT NULL DEFAULT '1';
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "promotion_id" uuid;

ALTER TABLE "product_variant"
  ADD COLUMN IF NOT EXISTS "weight_grams" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variant_weight_non_negative'
  ) THEN
    ALTER TABLE "product_variant"
      ADD CONSTRAINT "product_variant_weight_non_negative"
      CHECK ("weight_grams" IS NULL OR "weight_grams" >= 0);
  END IF;
END $$;

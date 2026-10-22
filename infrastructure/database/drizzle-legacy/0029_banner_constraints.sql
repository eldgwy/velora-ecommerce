-- 0029_banner_constraints
-- Hero banner hardening:
--
-- 1. `banners.title` and `banners.image` become NOT NULL: every banner
--    needs a headline and a desktop image to render.
-- 2. CHECKs: title 1–120, subtitle ≤300, sortOrder ≥ 0, ordered validity
--    window (`endsAt > startsAt` when both set; NULL ends stay open-ended).
--
-- Legacy audit (empty table at authorship; zero violations on every
-- check): every constraint below validates immediately. No data rewritten.
--
-- Rollback (reverse):
--   ALTER TABLE "banners" ALTER COLUMN "title" DROP NOT NULL;
--   ALTER TABLE "banners" ALTER COLUMN "image" DROP NOT NULL;
--   ALTER TABLE "banners"
--     DROP CONSTRAINT IF EXISTS "banners_title_length",
--     DROP CONSTRAINT IF EXISTS "banners_subtitle_length",
--     DROP CONSTRAINT IF EXISTS "banners_sort_order_non_negative",
--     DROP CONSTRAINT IF EXISTS "banners_window_ordered";

ALTER TABLE "banners" ALTER COLUMN "title" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "banners" ALTER COLUMN "image" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'banners_title_length'
  ) THEN
    ALTER TABLE "banners"
      ADD CONSTRAINT "banners_title_length"
      CHECK (char_length("title") BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'banners_subtitle_length'
  ) THEN
    ALTER TABLE "banners"
      ADD CONSTRAINT "banners_subtitle_length"
      CHECK ("subtitle" IS NULL OR char_length("subtitle") <= 300);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'banners_sort_order_non_negative'
  ) THEN
    ALTER TABLE "banners"
      ADD CONSTRAINT "banners_sort_order_non_negative"
      CHECK ("sort_order" IS NULL OR "sort_order" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'banners_window_ordered'
  ) THEN
    ALTER TABLE "banners"
      ADD CONSTRAINT "banners_window_ordered"
      CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
  END IF;
END $$;

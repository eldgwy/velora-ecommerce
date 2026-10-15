-- 0024_review_integrity_and_verified_buyer
-- Product reviews hardening:
--
-- 1. `reviews.is_verified_buyer` (NOT NULL DEFAULT false): set at
--    submission from a server-side delivered-order check; the public badge
--    renders only for APPROVED + verified rows.
-- 2. `reviews.rating` CHECK 1–5: the application validates first; the
--    database is the backstop.
-- 3. `reviews.status` DEFAULT 'pending': new rows moderate from PENDING.
-- 4. Length CHECKs: title ≤ 120, content ≤ 5000 (application limits match).
--
-- Legacy audit (empty tables at authorship; zero violations on every
-- check): no out-of-range ratings, no NULL statuses, no over-length text —
-- every constraint below validates immediately. No data rewritten.
--
-- Rollback (reverse):
--   ALTER TABLE "reviews" DROP COLUMN IF EXISTS "is_verified_buyer";
--   ALTER TABLE "reviews" ALTER COLUMN "status" DROP DEFAULT;
--   ALTER TABLE "reviews"
--     DROP CONSTRAINT IF EXISTS "reviews_rating_range",
--     DROP CONSTRAINT IF EXISTS "reviews_title_length",
--     DROP CONSTRAINT IF EXISTS "reviews_content_length";

ALTER TABLE "reviews"
  ADD COLUMN IF NOT EXISTS "is_verified_buyer" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "reviews"
  ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_rating_range'
  ) THEN
    ALTER TABLE "reviews"
      ADD CONSTRAINT "reviews_rating_range"
      CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_title_length'
  ) THEN
    ALTER TABLE "reviews"
      ADD CONSTRAINT "reviews_title_length"
      CHECK ("title" IS NULL OR char_length("title") BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_content_length'
  ) THEN
    ALTER TABLE "reviews"
      ADD CONSTRAINT "reviews_content_length"
      CHECK ("content" IS NULL OR char_length("content") BETWEEN 1 AND 5000);
  END IF;
END $$;

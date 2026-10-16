-- 0027_collection_constraints
-- Curated marketing collections hardening:
--
-- 1. `collections` CHECKs: non-empty name (≤120), URL-safe slug
--    (lowercase alphanumerics + single dashes, 3–64 chars), description
--    ≤2000 chars. Slugs normalize application-side; the database is the
--    backstop.
--
-- Legacy audit (empty tables at authorship; zero violations on every
-- check): no blank names, no malformed slugs, no over-length text — every
-- constraint below validates immediately. No data rewritten.
--
-- Rollback (reverse):
--   ALTER TABLE "collections"
--     DROP CONSTRAINT IF EXISTS "collections_name_length",
--     DROP CONSTRAINT IF EXISTS "collections_slug_format",
--     DROP CONSTRAINT IF EXISTS "collections_description_length";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collections_name_length'
  ) THEN
    ALTER TABLE "collections"
      ADD CONSTRAINT "collections_name_length"
      CHECK (char_length("name") BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collections_slug_format'
  ) THEN
    ALTER TABLE "collections"
      ADD CONSTRAINT "collections_slug_format"
      CHECK (
        char_length("slug") BETWEEN 3 AND 64
        AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collections_description_length'
  ) THEN
    ALTER TABLE "collections"
      ADD CONSTRAINT "collections_description_length"
      CHECK ("description" IS NULL OR char_length("description") <= 2000);
  END IF;
END $$;

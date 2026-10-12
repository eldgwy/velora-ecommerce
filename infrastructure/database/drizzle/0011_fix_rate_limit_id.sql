-- 0011_fix_rate_limit_id
-- Add missing `id` column to rate_limit table to match Better Auth's expected schema.
-- Better Auth's schema generator always includes an `id` primary key column.
-- The previous migration (0003) created rate_limit with `key` as primary key,
-- which caused a schema mismatch error: "Missing columns: rateLimit.id"

ALTER TABLE "rate_limit"
  ADD COLUMN "id" text DEFAULT gen_random_uuid() NOT NULL;

-- Drop the old primary key constraint on `key`
ALTER TABLE "rate_limit" DROP CONSTRAINT "rate_limit_pkey";

-- Add new primary key on `id`
ALTER TABLE "rate_limit" ADD PRIMARY KEY ("id");

-- Keep `key` as unique (required by Better Auth for rate limit lookups)
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_key_unique" ON "rate_limit" ("key");

-- Rollback:
-- DROP INDEX IF EXISTS "rate_limit_key_unique";
-- ALTER TABLE "rate_limit" DROP CONSTRAINT "rate_limit_pkey";
-- ALTER TABLE "rate_limit" ADD PRIMARY KEY ("key");
-- ALTER TABLE "rate_limit" DROP COLUMN "id";
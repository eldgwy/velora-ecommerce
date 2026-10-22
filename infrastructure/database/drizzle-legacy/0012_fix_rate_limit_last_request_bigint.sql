-- 0012_fix_rate_limit_last_request_bigint
-- Change last_request column from integer to bigint to support JavaScript timestamps (milliseconds)
-- JavaScript Date.now() returns milliseconds since epoch, which exceeds 32-bit integer max (2,147,483,647)

ALTER TABLE "rate_limit" ALTER COLUMN "last_request" TYPE bigint;

-- Rollback:
-- ALTER TABLE "rate_limit" ALTER COLUMN "last_request" TYPE integer;
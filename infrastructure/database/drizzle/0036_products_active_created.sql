-- 0036: Partial index for active-product listing sorts (T-4.5 / GP-08).
--
-- Measured at the roadmap's mandated 10k-product scale (EXPLAIN ANALYZE,
-- 2026-10): every paginated listing (`sort=newest|default`) read the WHOLE
-- backward `products_created_at_idx` (10001 rows) and ran an incremental
-- sort just to emit LIMIT 9 — 24.4 ms, and O(n) at catalog scale. A partial
-- index whose predicate matches exactly the two listing filters
-- (`status = 'ACTIVE'`) in the exact sort direction lets the scan stop at
-- the page boundary. Verified: actual time drops from ~24 ms to <1 ms and
-- the plan becomes an ordered index scan over 9 rows.
--
-- Search-side ILIKE (99 ms at 10k, linear) needs pg_trgm/FTS, which is NOT
-- available in this Postgres build — deferred to when the production host
-- can install the extension (see docs/db-integrity.md "Scale validation").
--
-- Rollback: DROP INDEX IF EXISTS "products_active_created_idx";

CREATE INDEX IF NOT EXISTS "products_active_created_idx"
  ON "products" ("created_at" DESC, "id" ASC)
  WHERE "status" = 'ACTIVE';

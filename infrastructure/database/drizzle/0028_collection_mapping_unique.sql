-- 0028_collection_mapping_unique
-- Reconcile a declared-but-missing constraint: the Drizzle schema has
-- always declared `collection_products_collection_product_unique`, but the
-- index was never created live (verified absent in pg_indexes; the
-- duplicate-mapping guard in application code therefore never fired).
--
-- Legacy audit (zero duplicate pairs at authorship): the index validates
-- immediately. No data rewritten.
--
-- Rollback (reverse):
--   DROP INDEX IF EXISTS "collection_products_collection_product_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "collection_products_collection_product_unique"
  ON "collection_products" USING btree ("collection_id", "product_id");

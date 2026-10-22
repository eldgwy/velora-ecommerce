-- 0026_product_view_history
-- Server-side browsing history for authenticated customers:
--   product_view_history  one row per (customer, product) with the most
--                         recent view timestamp.
--
-- Repeat views refresh the row via upsert (unique constraint arbitrates
-- races); rows beyond the per-customer history limit are pruned on write,
-- so retention needs no scheduler. Product deletion cascades (never shown
-- stale); account deletion cascades (no orphaned tracking data).
--
-- Guests use bounded browser-local storage instead — no server rows, no
-- tracking accounts, no behavioral data. See docs/recently-viewed-products.
--
-- New table: all constraints validate on creation. No data rewritten.
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "product_view_history";

CREATE TABLE IF NOT EXISTS "product_view_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE cascade,
  "viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_view_history_user_product_unique"
  ON "product_view_history" USING btree ("user_id", "product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_view_history_user_viewed_idx"
  ON "product_view_history" USING btree ("user_id", "viewed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_view_history_product_id_idx"
  ON "product_view_history" USING btree ("product_id");

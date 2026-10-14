-- 0021_product_returns
-- Physical product returns (FR-11 follow-up). A monetary refund must never
-- imply goods were received or are eligible for restocking, so returns are
-- modeled as entities of their own, linked to — but lifecycle-independent
-- from — refunds and inventory movements:
--
--   return_cases  one case per return request against an order
--                 (OPEN → COMPLETED | CANCELLED)
--   return_items  per-order-line quantities with receipt/inspection state
--                 (PENDING → RECEIVED → APPROVED → RESTOCKED,
--                  REJECTED / CANCELLED terminal)
--
-- Restocking idempotency is enforced at the database level:
--   - `return_items.restocked_movement_id` is UNIQUE (NULLs distinct, so
--     unrestocked rows are unaffected) and may only be set when the line is
--     RESTOCKED;
--   - the application additionally transitions APPROVED → RESTOCKED through
--     a conditional update under a row lock, so concurrent attempts converge
--     onto a single RETURN movement.
--
-- There are no pre-existing return rows: these tables are new, so every
-- constraint is validated on creation. No data is rewritten. The optional
-- `refund_id` link is informational only and never moves money.
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "return_items";
--   DROP TABLE IF EXISTS "return_cases";

CREATE TABLE IF NOT EXISTS "return_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE restrict,
  "refund_id" uuid REFERENCES "refunds"("id") ON DELETE set null,
  "status" text NOT NULL DEFAULT 'OPEN',
  "reason" text NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "return_cases_status_allowed"
    CHECK ("status" IN ('OPEN', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "return_cases_order_id_idx"
  ON "return_cases" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "return_cases_status_idx"
  ON "return_cases" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "return_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "return_cases"("id") ON DELETE cascade,
  "order_item_id" uuid NOT NULL REFERENCES "order_items"("id") ON DELETE restrict,
  "variant_id" uuid NOT NULL REFERENCES "product_variant"("id") ON DELETE restrict,
  "quantity" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "condition" text,
  "restocked_movement_id" uuid,
  "processed_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "return_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "return_items_status_allowed"
    CHECK ("status" IN ('PENDING', 'RECEIVED', 'APPROVED', 'REJECTED', 'RESTOCKED', 'CANCELLED')),
  CONSTRAINT "return_items_condition_allowed"
    CHECK ("condition" IS NULL OR "condition" IN ('RESTOCKABLE', 'DAMAGED')),
  CONSTRAINT "return_items_movement_requires_restocked"
    CHECK ("restocked_movement_id" IS NULL OR "status" = 'RESTOCKED')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "return_items_movement_unique"
  ON "return_items" USING btree ("restocked_movement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "return_items_case_id_idx"
  ON "return_items" USING btree ("case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "return_items_order_item_id_idx"
  ON "return_items" USING btree ("order_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "return_items_status_idx"
  ON "return_items" USING btree ("status");

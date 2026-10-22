-- 0017_order_audit_and_notifications
-- Order lifecycle audit trail + notification deduplication (FR-09).
--
-- 1. `order_status_histories` gains nullable audit columns so every state
--    change records durably: previous state, event type, actor (customer /
--    staff / admin / webhook / system + id), and a caller-supplied
--    correlation id (idempotency key, webhook event id, or request id).
--    Existing rows keep NULLs; the application backfills nothing.
-- 2. New `order_notifications` claim table: one row per (order, event type).
--    The row is claimed (`INSERT ... ON CONFLICT DO NOTHING`) inside the
--    same transaction as the state change; the email is sent only when the
--    claim wins, after commit. Webhook/job retries therefore never
--    double-send. No delivery is claimed unless the provider confirms it
--    (`status` moves QUEUED -> SENT only after SMTP accepts).
--
-- All statements are idempotent. No data is rewritten.
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "order_notifications";
--   ALTER TABLE "order_status_histories"
--     DROP COLUMN IF EXISTS "previous_status",
--     DROP COLUMN IF EXISTS "event_type",
--     DROP COLUMN IF EXISTS "actor_type",
--     DROP COLUMN IF EXISTS "actor_id",
--     DROP COLUMN IF EXISTS "correlation_id";

ALTER TABLE "order_status_histories"
  ADD COLUMN IF NOT EXISTS "previous_status" "order_status";

ALTER TABLE "order_status_histories"
  ADD COLUMN IF NOT EXISTS "event_type" text;

ALTER TABLE "order_status_histories"
  ADD COLUMN IF NOT EXISTS "actor_type" text;

ALTER TABLE "order_status_histories"
  ADD COLUMN IF NOT EXISTS "actor_id" text;

ALTER TABLE "order_status_histories"
  ADD COLUMN IF NOT EXISTS "correlation_id" text;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "sent_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_notifications_order_type_unique"
  ON "order_notifications" USING btree ("order_id", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_notifications_order_id_idx"
  ON "order_notifications" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_notifications_status_idx"
  ON "order_notifications" USING btree ("status");

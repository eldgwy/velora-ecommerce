-- 0019_notification_retry_state
-- Durable notification delivery (Phase 2): the claim-once model gains the
-- state needed for bounded retries with crash recovery.
--
--   * `attempts` — deliveries attempted (incremented when a worker claims).
--   * `next_retry_at` — earliest time a retry may run (exponential backoff).
--   * `last_error` — sanitized provider error (message prefix only; never
--     secrets, credentials, or message bodies).
--   * `provider_message_id` — accepted SMTP id, for reconciliation/visibility.
--   * `status` lifecycle: QUEUED (pending) -> SENDING (claimed, leased)
--     -> SENT | QUEUED (scheduled retry) | FAILED (attempts exhausted).
--     A SENDING row whose `updated_at` predates the lease is treated as
--     crashed and may be reclaimed by any worker.
--
-- Additive and idempotent. No data rewritten (`QUEUED` rows keep attempts 0
-- and no scheduled retry, i.e. immediately due).
--
-- Rollback (reverse):
--   ALTER TABLE "order_notifications"
--     DROP COLUMN IF EXISTS "attempts",
--     DROP COLUMN IF EXISTS "next_retry_at",
--     DROP COLUMN IF EXISTS "last_error",
--     DROP COLUMN IF EXISTS "provider_message_id";

ALTER TABLE "order_notifications"
  ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "order_notifications"
  ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp;

ALTER TABLE "order_notifications"
  ADD COLUMN IF NOT EXISTS "last_error" text;

ALTER TABLE "order_notifications"
  ADD COLUMN IF NOT EXISTS "provider_message_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_notifications_retry_idx"
  ON "order_notifications" USING btree ("status", "next_retry_at");

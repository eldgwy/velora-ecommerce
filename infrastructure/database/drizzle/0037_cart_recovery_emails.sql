-- 0037_cart_recovery_emails
-- GP-25-adjacent / T-5.1 (product-approved via the Phase 5 gate): recovery
-- emails for abandoned carts become a durable queue, mirroring the proven
-- auth-email queue (0034) exactly: rendered email stored at enqueue time;
-- QUEUED -> SENDING(lease) -> SENT | QUEUED(backoff) | FAILED at exhaust.
--
-- Design notes:
-- - Additive CREATE TABLE IF NOT EXISTS; no existing table is touched.
-- - A SEPARATE table rather than an auth_emails event type: recovery rows
--   need a per-cart identity for the (cart_id, stage) duplicate-send guard,
--   which auth_emails cannot carry, and overloading auth_email's FK-free
--   dedupe design (D16: fresh link request = fresh row) would change its
--   semantics.
-- - `cart_id` references the `cart` table (note: singular physical table
--   name; the drizzle export `carts` maps to it) with CASCADE: the queued
--   email is useless without the cart (state/lifecycle artifacts);
--   `user_id` FK CASCADE for the same reason as 0034 — no recipient, no row.
-- - `stage` is the reminder number (1..N): the UNIQUE (cart_id, stage) key
--   IS the duplicate-send guard, same doctrine as the 0035 low-stock
--   ledger. A failed-terminal stage 1 suppresses the next stage (a bouncing
--   mailbox must not receive repeats), and the 7-day per-user frequency cap
--   in the scan keeps repeated abandon cycles quiet.
-- - Only accounts with logged-in carts can be mailed (guest carts carry no
--   email); the scan gate exists in application code, mirrored by tests.
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "cart_recovery_emails";

CREATE TABLE IF NOT EXISTS "cart_recovery_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cart_id" uuid NOT NULL REFERENCES "cart"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "stage" integer NOT NULL,
  "recipient_email" text NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "body_text" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_retry_at" timestamp,
  "last_error" text,
  "provider_message_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "sent_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_recovery_emails_cart_stage_unique"
  ON "cart_recovery_emails" ("cart_id", "stage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_recovery_emails_user_idx"
  ON "cart_recovery_emails" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_recovery_emails_status_idx"
  ON "cart_recovery_emails" ("status");

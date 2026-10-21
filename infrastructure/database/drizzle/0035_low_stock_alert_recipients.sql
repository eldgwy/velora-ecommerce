-- 0035_low_stock_alert_recipients
-- GP-30 (T-3.5): per-recipient delivery ledger for low-stock alert emails.
-- `deliverSingleAlert` blasted every recipient with Promise.all and, on any
-- single recipient's SMTP failure, requeued the whole alert — so a retry
-- re-sent the email to recipients who already received it. This ledger
-- records exactly who has received which alert; retries send only to the
-- missing recipients, and duplicates become impossible by unique key.
--
-- Design notes:
-- - Additive CREATE TABLE IF NOT EXISTS. Existing alert rows are untouched;
--   PENDING/PROCESSING alerts in flight simply start with an empty ledger
--   (their first recipients are recorded before the next retry sees them).
-- - Cascades on the alert row: the ledger has no meaning without the alert.
-- - One row per (alert, recipient) — the unique key IS the dedup guard.
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "low_stock_alert_recipients";

CREATE TABLE IF NOT EXISTS "low_stock_alert_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "alert_id" uuid NOT NULL REFERENCES "low_stock_alerts"("id") ON DELETE CASCADE,
  "recipient_email" text NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "low_stock_alert_recipients_alert_email_unique"
  ON "low_stock_alert_recipients" ("alert_id", "recipient_email");

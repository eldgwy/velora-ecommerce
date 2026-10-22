-- 0034_auth_emails
-- GP-14 (T-3.3): verification / password-reset emails become a durable queue.
-- Today those sends are fire-and-forget with only a console.error — if the
-- SMTP call fails, the link is silently lost and the user must guess they
-- need to request it again. The row lives in a queue with the SAME state
-- machine the order-retry worker already runs and tests
-- (QUEUED -> SENDING lease -> SENT | QUEUED(backoff) | FAILED).
--
-- Design notes:
-- - Additive CREATE TABLE IF NOT EXISTS; no existing table is touched.
-- - The rendered email (subject/html/text) is stored at enqueue time so a
--   retry replays byte-identical content. Password-reset links embed a
--   60-minute token; retries inside the backoff window stay within that
--   TTL, and a replay after expiry is harmless (Better Auth rejects the
--   token and the user can request a fresh link).
-- - user_id TEXT references the Better Auth `user` table with CASCADE: the
--   queued message is useless without its recipient, so unlike the audit
--   trail (0033) it MUST die with the account.
-- - No unique (user_id, event_type) claim: a fresh link request is a fresh
--   row; Auth rate limits (reset 2/h per IP, verification 3/h per IP) tensor
--   this, and each row still claims once.
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "auth_emails";

CREATE TABLE IF NOT EXISTS "auth_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
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
CREATE INDEX IF NOT EXISTS "auth_emails_user_idx" ON "auth_emails" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_emails_status_idx" ON "auth_emails" ("status");

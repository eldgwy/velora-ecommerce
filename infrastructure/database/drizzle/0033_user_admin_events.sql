-- 0033_user_admin_events
-- GP-25 (T-2.3): customer-admin operations become reversible-and-auditable.
-- Nothing in the app could previously write `user.status`/`user.role` (a
-- "dead-letter" disable state the guards enforced but nothing could set).
-- With admin toggles landing, every change must leave a durable trail —
-- the admin actors are security-adjacent principals, and console logging is
-- explicitly insufficient (GP-22 rationale).
--
-- Design notes:
-- - Additive CREATE TABLE IF NOT EXISTS; no existing table is touched.
-- - `user_id` is TEXT with NO foreign key: the audit trail for an account
--   must survive the account's own deletion (GDPR anonymization/deletion is
--   a later product decision — T-2.4), and the user table's id is text
--   (Better Auth). Mirrors the 0017/0032 text-actor precedent.
-- - `previous_value`/`new_value` carry the serialized status or role; the
--   actor columns reuse the order-ledger vocabulary ("admin" | "system").
--
-- Rollback (reverse):
--   DROP TABLE IF EXISTS "user_admin_events";

CREATE TABLE IF NOT EXISTS "user_admin_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "event_type" text NOT NULL,
  "previous_value" text,
  "new_value" text NOT NULL,
  "actor_type" text,
  "actor_id" text NOT NULL,
  "reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_admin_events_user_idx" ON "user_admin_events" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_admin_events_created_idx" ON "user_admin_events" ("created_at");

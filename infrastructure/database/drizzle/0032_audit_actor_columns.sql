-- 0032_audit_actor_columns
-- GP-22 (T-2.8): durable audit-trail parity for the non-order state
-- changers. The order ledger (order_status_histories, migration 0017)
-- already records actorType/actorId transactionally; stock movements and
-- review moderation recorded neither, so forensics for money-adjacent
-- actions (stock adjustments, refund moderation) were lost on redeploy —
-- the only trace was console JSON.
--
-- Additive, nullable, mirroring the 0017 columns exactly:
-- - inventory_movement.actor_type / actor_id — the acting principal for
--   RESERVATION/RELEASE/SALE/ADJUSTMENT/RESTOCK/RETURN movements
--   ("customer" | "staff" | "admin" | "webhook" | "system", same
--   vocabulary as the order ledger). Nullable: historical rows and
--   automation that genuinely has no principal keep NULL instead of a
--   fabricated value.
-- - reviews.moderated_by / moderated_at — the admin/staff actor and the
--   moderation moment, written only on an actual transition.
--
-- Column types follow the 0017 precedent (text, not FKs): actors may be
-- users, webhook/event identifiers, or automation names; hard-fkeying
-- would break webhook outages, guest context, and text-typed user ids.
--
-- Rollback (reverse):
--   ALTER TABLE "inventory_movement" DROP COLUMN IF EXISTS "actor_type";
--   ALTER TABLE "inventory_movement" DROP COLUMN IF EXISTS "actor_id";
--   ALTER TABLE "reviews" DROP COLUMN IF EXISTS "moderated_by";
--   ALTER TABLE "reviews" DROP COLUMN IF EXISTS "moderated_at";

ALTER TABLE "inventory_movement"
  ADD COLUMN IF NOT EXISTS "actor_type" text;

ALTER TABLE "inventory_movement"
  ADD COLUMN IF NOT EXISTS "actor_id" text;

ALTER TABLE "reviews"
  ADD COLUMN IF NOT EXISTS "moderated_by" text;

ALTER TABLE "reviews"
  ADD COLUMN IF NOT EXISTS "moderated_at" timestamp;

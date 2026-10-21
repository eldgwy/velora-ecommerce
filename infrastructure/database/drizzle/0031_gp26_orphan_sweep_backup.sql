-- 0031_gp26_orphan_sweep_backup
-- GP-26 (T-2.6): migration 0016 shipped its orphan sweep and `ORD-TEST-%`
-- fixture deletion inline with structural changes ("WOULD delete real
-- orphans in production", per its own header), so a destructive data
-- operation ran inside the migration chain without any operator gate. This
-- migration is the reviewed, prod-run-safe replacement for recurring orphan
-- state: it only ever deletes rows whose parent order is GONE (dead child
-- rows that no query can reach through the orders ledger), and it backs
-- every affected row up first so the sweep is reversible.
--
-- Review checklist for operators (do not re-run blind):
--   1. Inspect the backup tables after a migration run; any unexpected
--      backup content must be investigated BEFORE the rows are treated as
--      disposable. Restore example below.
--   2. This sweep is DATA HYGIENE, not correctness enforcement: a healthy
--      database provisioned with the declared foreign keys cannot contain
--      order-scoped orphan rows at all. Non-zero sweeps signal a history
--      without FKs (the environment this chain repaired) or a test-suite
--      teardown race, never removal of reachable order data.
--   3. Historical order/payment rows whose ORDER still exists are untouched
--      by design (financial snapshots are immutable, AGENTS.md §5).
--
-- Idempotent and safe to replay: `CREATE … IF NOT EXISTS` + insert keyed on
-- the child row id with ON CONFLICT DO NOTHING, so an already-backed-up row
-- is never duplicated and an already-deleted row is never re-run.
--
-- Rollback (reverse): restore from the backup tables, e.g.
--   INSERT INTO "order_items" SELECT * FROM "gp26_orphan_backup_order_items" m
--   WHERE NOT EXISTS (SELECT 1 FROM "order_items" t WHERE t.id = m.id);
-- (repeat per table; the retention window for the backup tables is an
-- operator decision — document it in your deployment runbook.)

--> statement-breakpoint
-- Backup tables (structure copied from the live tables, zero rows).
CREATE TABLE IF NOT EXISTS "gp26_orphan_backup_order_items" AS
  SELECT * FROM "order_items" WHERE false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gp26_orphan_backup_order_addresses" AS
  SELECT * FROM "order_addresses" WHERE false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gp26_orphan_backup_order_status_histories" AS
  SELECT * FROM "order_status_histories" WHERE false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gp26_orphan_backup_payments" AS
  SELECT * FROM "payments" WHERE false;
--> statement-breakpoint
ALTER TABLE "gp26_orphan_backup_order_items"
  ADD COLUMN IF NOT EXISTS "orphan_backed_up_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "gp26_orphan_backup_order_addresses"
  ADD COLUMN IF NOT EXISTS "orphan_backed_up_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "gp26_orphan_backup_order_status_histories"
  ADD COLUMN IF NOT EXISTS "orphan_backed_up_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "gp26_orphan_backup_payments"
  ADD COLUMN IF NOT EXISTS "orphan_backed_up_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gp26_orphan_backup_order_items_id"
  ON "gp26_orphan_backup_order_items" ("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gp26_orphan_backup_order_addresses_id"
  ON "gp26_orphan_backup_order_addresses" ("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gp26_orphan_backup_order_status_histories_id"
  ON "gp26_orphan_backup_order_status_histories" ("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gp26_orphan_backup_payments_id"
  ON "gp26_orphan_backup_payments" ("id");
--> statement-breakpoint
-- Backup orphan rows first (dedupe against previous backups by id).
INSERT INTO "gp26_orphan_backup_order_items" (
  SELECT "o".*, now() FROM "order_items" "o"
  WHERE "o"."order_id" NOT IN (SELECT "id" FROM "orders")
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "gp26_orphan_backup_order_addresses" (
  SELECT "o".*, now() FROM "order_addresses" "o"
  WHERE "o"."order_id" NOT IN (SELECT "id" FROM "orders")
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "gp26_orphan_backup_order_status_histories" (
  SELECT "o".*, now() FROM "order_status_histories" "o"
  WHERE "o"."order_id" NOT IN (SELECT "id" FROM "orders")
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "gp26_orphan_backup_payments" (
  SELECT "o".*, now() FROM "payments" "o"
  WHERE "o"."order_id" NOT IN (SELECT "id" FROM "orders")
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Sweep the now-backed-up orphans.
DELETE FROM "order_items" WHERE "order_id" NOT IN (SELECT "id" FROM "orders");
--> statement-breakpoint
DELETE FROM "order_addresses" WHERE "order_id" NOT IN (SELECT "id" FROM "orders");
--> statement-breakpoint
DELETE FROM "order_status_histories" WHERE "order_id" NOT IN (SELECT "id" FROM "orders");
--> statement-breakpoint
DELETE FROM "payments" WHERE "order_id" NOT IN (SELECT "id" FROM "orders");

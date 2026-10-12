# VELORA — Database Integrity Audit (Phase 1)

Verified 2026-10-12 against the live development database (`velora_db`).
Method: every `pgTable` declaration in `infrastructure/database/schema/*.ts`
was extracted (41 FKs, 26 uniques, 102 plain indexes, 8 checks) and compared
against `pg_constraint` / `pg_indexes`. Violations were checked with
orphan-scan and duplicate-scan queries. No data was deleted or repaired.

## Findings summary

| Class | Declared | Missing live | Violations |
|---|---|---|---|
| Foreign keys | 41 | **36** | orphans in 6 child tables (see below) |
| Unique indexes | 26 | **10** | zero duplicates — all creatable |
| Plain indexes | 102 | **35** (+2 already present) | n/a (performance only) |
| CHECK constraints | 8 | **0** | — |

Tables are tiny in this environment (largest: `webhook_events` 424 rows),
so no statement below risks a long lock here. Production guidance differs —
see rollout.

## Missing foreign keys (36) — all added NOT VALID in 0018

`account.user_id`, `session.user_id`, `addresses.customer_id`,
`low_stock_alerts.inventory_id`, and `order_notifications.order_id` already
existed. Everything else was absent, including all order/cart/inventory/
payment/catalog relationships. Deletion behaviors match the schema
(`cascade` default; `restrict` on products→category/brand,
order_items→variant, orders→user, payments→order, refunds→payment,
promotion/collection→product, categories self-ref; `set null` on webhook
events and coupon-usage user/order links).

Orphans found (all test residue; left untouched per policy):

| Child rows | Orphaned | Notes for review |
|---|---|---|
| `inventory_movement` | 379/379 | parent `inventory` rows deleted by test cleanups without cascades |
| `order_items` | 153/153 | parent orders deleted likewise |
| `order_addresses` | 318/318 | same |
| `order_status_histories` | 331/331 | same |
| `webhook_events` | 195/424 | same (nullable links; `SET NULL` semantics already assumed) |
| `customer_profile` | 1/1 | user deleted, profile left behind |

Preflight pattern (run before promoting any FK with `VALIDATE CONSTRAINT`):

```sql
SELECT count(*) FROM <child> c LEFT JOIN <parent> p
  ON p.<pcol> = c.<ccol>
 WHERE c.<ccol> IS NOT NULL AND p.<pcol> IS NULL;
```

Repair policy: orphans are dead test rows — confirm they reference no live
business object, delete the child rows explicitly (never the parents), then
`ALTER TABLE <child> VALIDATE CONSTRAINT <name>;`. `VALIDATE` takes only
`SHARE UPDATE EXCLUSIVE` (reads/writes continue). Do not backfill fake
parents.

## Missing uniques (10) — all added in 0018 after zero-violation scans

`brand_slug_unique`, `categories_slug_unique`, `collections_slug_unique`,
`product_images_{public_id,url,primary}_unique`, `product_option_product_name_unique`,
`reviews_user_product_unique`, `wishlist_user_id_unique`,
`wishlist_items_wishlist_product_unique`.

## Missing plain indexes (35) — all added in 0018

Auth (3), catalog (11), reviews (7), marketing/banners/collections (10),
wishlist (2), variant linkage (1), products status/created (already present).
These are performance-only; no correctness impact.

## Schema-vs-reality inconsistency found

`banners.status` and `product_variant.status` are mapped to a physical
`is_active` column. Any index spelled against a `status` column on `banners`
would fail — 0018 uses `is_active` for the banner indexes to match the
physical table (consistent with what `drizzle-kit generate` would emit).

## Production rollout

1. Deploy 0015–0018 in order; each is idempotent (`IF NOT EXISTS`, catalog-
   guarded `DO` blocks) and safe to re-run.
2. FKs land `NOT VALID`: new writes are protected immediately; existing rows
   are not scanned; no long locks.
3. Run the preflight queries above in production; repair orphans explicitly.
4. `VALIDATE CONSTRAINT` per FK (online, non-blocking for reads/writes).
5. For large tables, prefer `CREATE INDEX CONCURRENTLY` out-of-band for the
   plain indexes — `CONCURRENTLY` cannot run inside the migrator's transaction.
6. Rollback: `DROP INDEX IF EXISTS …` / `ALTER TABLE … DROP CONSTRAINT IF
   EXISTS …` (statements listed in the migration header). Dropping an FK
   never touches data.

## What was NOT done

- No orphan rows deleted or repaired (explicit task constraint).
- No FKs promoted to `VALIDATED` (blocked on orphan review above).
- No FK reconciliation for tables outside the declared schema.
- No disposable-database rehearsal: the role lacks `CREATEDB` and sudo, so
  0018 was instead dry-run statement-by-statement in a rolled-back
  transaction (85/85 statements clean) before the real run.

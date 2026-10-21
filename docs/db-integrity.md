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

## Products slug (0030 — GP-05)

`0030_products_slug.sql` adds a public, URL-safe identifier to every product,
executed as one transaction:

1. Add nullable `products.slug`.
2. Deterministic backfill: lowercased slugified `name` (non-alphanumeric runs
   folded to `-`, trailing/leading dashes trimmed, clipped to 64 chars,
   `product` when the base would be empty) + `-` + the lowercase 8-hex tail
   of the product id. The id suffix makes every value unique by construction
   (uuid tail collision is impossible), so no dedup pass or advisory lock is
   required and the transform is idempotent and replayable on any database.
3. `SET NOT NULL` after the backfill (all rows have a value at that point).
4. Unique index `products_slug_unique_idx` enforces the contract in the DB.

Deployment notes:

- Apply like any migration (`pnpm db:migrate`); no backfill script needs to
  run out-of-band — the migration carries the backfill itself.
- Locking: the unique index takes a normal lock on `products`; the table is
  small catalog data at current scale. `CONCURRENTLY` is not possible inside
  the migrator transaction; if the table ever grows large, create the index
  `CONCURRENTLY` out-of-band after applying statements 1–3.
- Rollback: `DROP INDEX IF EXISTS products_slug_unique_idx;` then
  `ALTER TABLE products ALTER COLUMN slug DROP NOT NULL;` and
  `ALTER TABLE products DROP COLUMN IF EXISTS slug;`
- Compatibility contract: storefront lookup matches `slug` OR `id`
  (`getProductBySlug`), so pre-slug product-UUID URLs continue to resolve;
  PDP `generateMetadata` declares the slug URL canonical.
- Slugs are stable once assigned (name changes do not rewrite the slug —
  URLs persist).

## Orphan sweep with backup (0031 — GP-26)

`0031_gp26_orphan_sweep_backup.sql` is the GP-26 remediation for the
destructive-in-chain sweep pattern that 0016 shipped (its own header admits it
"WOULD delete real orphans in production"). 0016 itself is applied history and
is NOT modified. 0031 establishes the reviewed sweep pattern:

1. Creates `gp26_orphan_backup_*` audit tables (structure copy of each target
   table + `orphan_backed_up_at`), with a unique index on the row id.
2. Backs up every orphan row (child rows whose parent order is gone:
   `order_items`, `order_addresses`, `order_status_histories`, `payments`)
   into the backup tables, deduplicating against earlier backups via
   ON CONFLICT DO NOTHING.
3. Deletes the backed-up orphans.

Safety properties:

- Only rows unreachable through the orders ledger are ever touched; rows
  whose order still exists (real financial snapshots) are never deleted.
- Idempotent and replayable (IF NOT EXISTS + id-keyed dedupe).
- Restore procedure documented in the migration header (single INSERT …
  WHERE NOT EXISTS per table); retention window is an operator decision.
- The validate-migrations guard below makes accidental runs against real
  data require an explicit operator flag.

## User admin audit trail (0033 — GP-25 / T-2.3)

`0033_user_admin_events.sql` adds `user_admin_events`: one row per admin
status/role change on an account. Nothing in the app could previously write
`user.status`/`user.role` (the guards' NOTACTIVE was a dead-letter state); with
the customer-companion toggles landing, each change carries the acting admin
id server-side (never client-supplied) and shares the account-write
transaction — a change is never visible without its trail.

- `user_id` is text with NO foreign key on purpose: audit rows must survive
  the account they describe; the account-deletion/anonymization flow is a
  separate product-owner decision (T-2.4).
- Rollback: `DROP TABLE IF EXISTS "user_admin_events";` (header lists it).

## Auth email durable queue (0034 — GP-14 / T-3.3)

`0034_auth_emails.sql` adds `auth_emails`: one row per Better Auth
verification / password-reset email. Previously those sends were
fire-and-forget with only a `console.error` — an SMTP failure silently lost
the link (High consequence: login requires a verified email). Rows now run
the same state machine as `order_notifications` (QUEUED -> SENDING lease ->
SENT | QUEUED backoff | FAILED at exhaustion) through the new retry worker.

- The rendered email (subject/html/text) is stored at enqueue time and
  replayed verbatim on retries. A reset link embeds a 60-minute Better Auth
  token; the backoff ladder (60s..6h capped by `NOTIFICATION_MAX_ATTEMPTS`)
  stays mostly inside that TTL, and a replay after expiry is rejected by
  Better Auth — the user can always request a fresh link.
- `user_id` references `user(id) ON DELETE CASCADE` on purpose, the opposite
  of 0033: an email without its recipient is useless, while audit rows must
  survive the account.
- No unique `(user_id, event_type)` claim: a fresh link request is a fresh
  row; Better Auth rate limits (reset 2/h per IP, verification 3/h per IP)
  bound row creation.
- Retry endpoint `/api/internal/jobs/auth-email-retry` (CRON_SECRET bearer,
  fails closed) scheduled `*/5` in `vercel.json`; lease window reuses
  `NOTIFICATION_LEASE_MINUTES`. Lease-expiry reclaims bump `attempts`; the
  enqueue-path first send does not (attempt accounting mirrors
  `notification-retry`).
- Clock-skew note: the claim's stale-lease branch compares DB-written
  `updated_at` against a worker-computed cutoff; with any DB/app clock skew
  the comparison errs on the "fresher" side (delayed reclaim, never
  premature — no duplicate-send window).
- Rollback: `DROP TABLE IF EXISTS "auth_emails";` (header lists it).

## Low-stock alert per-recipient ledger (0035 — GP-30 / T-3.5)

`0035_low_stock_alert_recipients.sql` adds `low_stock_alert_recipients`:
which recipient received which alert, `(alert_id, recipient_email)` unique —
the unique key IS the duplicate-send guard. Previously a multi-recipient
alert that failed for one inbox was requeued whole, re-sending to inboxes
that had already received it.

- Rows cascade on the alert; existing in-flight alerts start with an empty
  ledger and converge on the next attempt.
- Delivery is one SMTP call per remaining recipient with the ledger row
  written immediately per success — a crash mid-loop can only under-send,
  never duplicate.
- Claim-side lease recovery and terminal `FAILED` at `maxRetries` also
  landed with this migration's feature (0035 schema + job logic): a stranded
  PROCESSING row no longer blocks re-alerting the variant forever.
- **Testing revealed the delivery job had never successfully run at all:**
  `getAlertDetails` referenced non-existent table `product_variants` (real:
  `product_variant`) and non-existent column `pv.name` (real:
  `pv.description`). Corrected as part of T-3.5; regression-covered by
  `tests/integration/inventory/low-stock-delivery.test.ts`.
- Rollback: `DROP TABLE IF EXISTS "low_stock_alert_recipients";` (header
  lists it).

## Products listing partial index (0036 — GP-08 / T-4.5)

`0036_products_active_created.sql` adds one partial index:

```sql
CREATE INDEX IF NOT EXISTS "products_active_created_idx"
  ON "products" ("created_at" DESC, "id" ASC)
  WHERE "status" = 'ACTIVE';
```

- The predicate matches exactly the two filters every paginated listing
  applies (`status = 'ACTIVE'`), and the column order/directions match the
  shop-wide sort exactly (`ORDER BY created_at DESC, id ASC` — the newest
  and default sort surfaces), so the executor can read the page prefix
  directly instead of scanning the plain `created_at` index and
  incremental-sorting.
- Measured at the roadmap-mandated 10k-product seed (Postgres 18.6, local,
  `EXPLAIN (ANALYZE, BUFFERS)` after `ANALYZE`):
  - Listing page 1 (`sort=newest`, LIMIT 9): 24.4 ms → **0.388 ms**;
    plan changes from backward index scan over all 10 001 rows +
    incremental sort → ordered scan of the partial index stopping at
    9 rows (9 buffer hits).
  - Search (single category, ILIKE against name/description/variant
    SKU/brand name) with dense matches: 99 ms → **0.9 ms** — the
    pre-ordered partial index lets the executor early-exit at
    LIMIT 21. Rare-term matches still degrade to O(n) worst case.
  - `count(*)` active products: ~6 ms index-only scan at 10k; linear
    but uncritical at this scale, left unchanged.
- 10k seed rows were temporary marker-prefixed fixtures (`t45-%`) and
  were fully removed after measurement (products back to the pre-test 7
  rows; brand/category seeds deleted).
- Rollback: `DROP INDEX IF EXISTS "products_active_created_idx";`
  (header lists it).

### Scale validation — what was NOT done (pg_trgm blocked)

The roadmap's T-4.5 also asks for trigram/FTS search indexes "per
measured need". The need is now measured (ILIKE search is linear —
99 ms/10k rows), but **the `pg_trgm` extension is not available in this
Postgres build** (`CREATE EXTENSION pg_trgm` → "extension is not
available"; `postgresql-contrib` not installed for the local server), so
the trigram path could not be EXPLAIN-verified locally and was **not**
shipped. When a host with contrib extensions is available, the proposed
DDL is:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON "products" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_description_trgm_idx
  ON "products" USING gin ("description" gin_trgm_ops);
```

(Vercel Postgres, Neon, and Supabase all include `pg_trgm`; this is a
deployment-matrix decision, not a code blocker — ILIKE search stays
functional, just linear at scale.)

## Cart recovery queue (0037 — T-5.1)

`0037_cart_recovery_emails.sql` adds the abandonment-recovery email
queue (product-approved build of the previously doc'd absence E8).
Additive table, no changes to existing tables:

- `cart_recovery_emails`: one row per (cart, stage) reminder. Core claim:
  `cart_recovery_emails_cart_stage_unique` on `(cart_id, stage)` — the
  scan enqueues the next stage through a conditional INSERT (unique-claim
  pattern), so concurrent scans/workers can never double-send a stage.
- `status` lifecycle mirrors the auth-email queue machinery exactly:
  `QUEUED → SENDING → SENT`, failures retry with exponential backoff and
  park at terminal `FAILED`. `attempts` are bumped only by worker claims
  (the enqueue-path first send intentionally does not bump — one sendMail
  per envelope is guaranteed by the CAS `QUEUED → SENDING` transitions on
  both sides).
- Stage ladder semantics (D21): stage N requires stage N−1 SENT; FAILED
  is terminal for that cart's ladder (a bouncing mailbox never receives a
  repeat); rendered bodies are persisted at enqueue and replayed verbatim.
- FKs: `cart_id → cart.id` ON DELETE CASCADE (a recovery email without
  its cart is meaningless); `user_id → user.id` ON DELETE CASCADE.
- Indexes: `cart_recovery_emails_status_idx` (due-scan `WHERE status =
  'QUEUED' OR status = 'SENDING'`), `cart_recovery_emails_user_idx`
  (per-user frequency cap lookup `MAX(created_at) GROUP BY user_id`).
- Freshness discipline: candidate eligibility ages are computed
  DB-side as epoch seconds (`EXTRACT(EPOCH FROM now() - …)`), so no
  decision compares a DB timestamp against a Node-converted Date — the
  D17 test-clock finding (DB ~3 h ahead of Node) cannot flip any
  production decision. Claim leases/backoff cutoffs are client-clock
  values written by the same clock that reads them (auth-email
  convention).
- Verify: applied locally via `pnpm db:migrate` (`Migration completed`);
  psql confirms table + all four indexes; journal 38 entries. Rollback:
  `DROP TABLE IF EXISTS "cart_recovery_emails";` (header lists all).

## Audit actor columns (0032 — GP-22)

`0032_audit_actor_columns.sql` closes the audit-trail split-brain: the order
ledger recorded actors transactionally (0017), but inventory movements and
review moderation did not. Additive, nullable, mirroring the 0017 column
shapes exactly:

- `inventory_movement.actor_type` / `actor_id` — same actor vocabulary as the
  order ledger (`customer` | `staff` | `admin` | `webhook` | `system`). Every
  movement write site now populates them: checkout reserve = customer id,
  payment-committed SALE/failure RELEASE = webhook (+ payment correlation in
  the reason), expiry/release automation = system, admin adjustments =
  admin id, variant restock seeding = admin id. Null means "no principal
  known" (historical rows) — never a fabricated value.
- `reviews.moderated_by` / `moderated_at` — written only on an actual
  moderation transition (serialized conditional UPDATE; race losers leave the
  winner's audit intact).
- `inventory_movement_actor_id_idx` supports forensics by actor.

Types are `text`, not FKs (0017 precedent): actors may be webhook/event
identifiers or automation names; the user id is text-typed in this schema.

Deployment notes:

- Apply like any migration (`pnpm db:migrate`). No backfill: historical rows
  legitimately have unknown actors.
- Locking: additive nullable columns take brief exclusive table locks; the
  tables are small at current scale.
- Rollback: DROP COLUMN IF EXISTS per column (header lists exact statements).
- Forensics: movement rows are composable with `order_status_histories` via
  the shared reason text referencing the order id/payment id; aggregation
  queries should filter `actor_type`, not string-match ids.

## validate-migrations guard (GP-26)

`scripts/validate-migrations.ts` hardened (was warns-only on non-empty
targets — it validated nothing there):

- Non-empty target database aborts (exit 1) unless `--allow-non-empty` or
  `ALLOW_NON_EMPTY_MIGRATION_VALIDATION=true` is passed explicitly, with the
  limitation spelled out in the refusal message.
- The migration-history table is located across schemas (this deployment has
  it in the `drizzle` schema; a hard-coded unqualified lookup would fail on
  any primed database).
- Critical-check failures now produce exit code 1, and the
  `rate_limit key is unique` check accepts drizzle's unique-INDEX form
  (it previously filtered `information_schema.table_constraints`, where
  drizzle's unique indexes never appear — so it could never pass).

Known tooling note: `drizzle-kit generate` snapshots stop at 0004 and the
journal (32 entries) has since moved ahead hand-written; generate currently
requires interactive conflict resolution against a stale snapshot (GP-26).
0030 and 0031 therefore follow the established handwritten pattern.

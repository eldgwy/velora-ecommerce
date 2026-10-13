# VELORA — Staging Environment Guide

Isolated staging only. Never point staging tooling at production; no
procedure here touches production data.

## 1. Provisioning (DBA + platform owner)

1. Provision a dedicated PostgreSQL 16+ instance and database, e.g.
   `velora_staging`. The provisioning role needs `CREATEDB` (or a
   pre-created empty database); the app role needs `CONNECT`, `CREATE` (first
   migrate only), and DML on all tables thereafter.
2. Set `DATABASE_URL` to the staging connection string. There is no fallback:
   `infrastructure/database/migrate.ts` and `scripts/*` fail closed without
   it. The only fallback connection string in the repo is the localhost dev
   default in `tests/integration/_db.ts`, which never runs outside tests.
3. Run `pnpm db:migrate` (applies journal `0000`–`0019` in one transaction;
   any failure rolls back the run — verified behavior, never partial).
4. Optionally replay-check on a scratch database first:
   `DATABASE_URL=<empty-db-url> pnpm tsx scripts/validate-migrations.ts`.

## 2. Environment variables (names only — never commit values)

Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_API_KEY`,
`BETTER_AUTH_URL` (staging URL), `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`,
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
Test-mode payments: `STRIPE_SECRET_KEY` (sk_test_*), `STRIPE_WEBHOOK_SECRET`
(staging endpoint secret), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_*).
Jobs: `CRON_SECRET` (generate: `openssl rand -hex 32`). Integrity:
`GUEST_CART_SECRET` (required in production; staging must set it — no
fallback). Tuning (optional, defaults apply): `RESERVATION_EXPIRY_MINUTES`
(30), `EXPIRED_RESERVATION_BATCH_SIZE` (100),
`EXPIRED_RESERVATION_MAX_RETRIES` (3), `NOTIFICATION_BATCH_SIZE` (50),
`NOTIFICATION_MAX_ATTEMPTS` (5), `NOTIFICATION_LEASE_MINUTES` (10),
`SMTP_PORT` (587), `SMTP_SECURE`, `SMTP_FROM`,
`LOW_STOCK_ALERT_RECIPIENTS`, `CLOUDINARY_UPLOAD_PRESET`.
Validation lives in `config/env.ts` (Zod, fail-closed at boot); `.env.example`
lists every name. Missing secrets fail safely: no-Stripe → card flows return
`configurationMissing` instead of charging; no `CRON_SECRET` → job endpoints
answer 401 and never execute.

## 3. Reset / seed procedure (staging data only)

No production dump may be used for seeding. Repeatable reset:

1. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on the STAGING database.
2. `pnpm db:migrate` to rebuild schema + constraints.
3. Seed smoke fixtures (admin user via Better Auth sign-up, one category /
   brand / product / variant with inventory, one coupon) through the UI or
   API — no seeder script exists; do not copy production rows.
4. Record the seed manifest (who/when/what) alongside the staging credentials.

All test fixtures live in `tests/` and clean up after themselves; integration
tests target the database in `VELORA_TEST_DATABASE_URL` (default: local dev
DB) and must never run against staging.

## 4. Backup & restore drill (DBA)

- Backup: `pg_dump "<DATABASE_URL>" -Fc -f velora-staging-$(date +%F).dump`
  (verified working: custom-format archive with tables, data, indexes,
  constraints — 299 objects on the reference DB).
- Covers: all relational data. Does NOT cover: Cloudinary-hosted product
  media (URLs only in DB), Stripe-side objects (intents/refunds — reconcile
  via dashboard/API), SMTP state.
- Restore drill (isolated target, never production):
  `createdb velora_restore_drill && pg_restore -d velora_restore_drill
  <archive>`, then verify migration journal row count (20 entries),
  constraint counts, and app connectivity (`pnpm db:migrate` must no-op).
- Status: dump verified readable; full restore drill UNVERIFIED (no spare
  database target available in this environment). Do not claim restorability
  until the drill runs green.

## 5. Cron (platform owner)

`vercel.json` schedules (all `POST`, all bearer-authenticated):
`expire-reservations` every 5 min, `notification-retry` every 5 min,
`deliver-low-stock-alerts` every 10 min. Without `CRON_SECRET` every endpoint
answers 401 and nothing executes — set the secret AND confirm 200s in logs
after deploy; silent non-execution is the expected failure mode to watch for.

## 6. Monitoring prerequisites (on-call lead)

No monitoring integration ships in-repo. Before staging sign-off, wire the
structured JSON logs (`module`/`action` fields) to the platform log drain and
create the eight alerts specified in `docs/production-readiness.md` §5/§7
with owners and runbooks. Staging sign-off requires at least: job 200-rate,
webhook 5xx-rate, and `FAILED`-notification visibility.

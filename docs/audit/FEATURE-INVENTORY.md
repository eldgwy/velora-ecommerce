# VELORA — Feature Inventory & Completion Assessment

> Evidence-based feature inventory produced by a repository-wide audit.
> Companion documents: [`ARCHITECTURE-GAPS.md`](./ARCHITECTURE-GAPS.md) (issue register, stable IDs `GP-xx`), [`MASTER-ROADMAP.md`](./MASTER-ROADMAP.md) (task IDs `T-x.y`).
> Statuses: **Implemented** / **Needs Hardening** / **Partially Implemented** / **Missing** / **Unverified** / **Optional**.

---

## 1. Audit scope and methodology

**Method.** Read-only inspection of implementation code on the current working tree (2026-10-17). Seven parallel deep-inspection passes covered:

1. Commerce core (catalog pages, catalog-public services, cart, checkout).
2. Orders / payments / returns / financial integrity (schema, commands, webhooks, refunds).
3. Inventory, background jobs, notifications.
4. Administration and customer experience.
5. Marketing, merchandising, SEO, email infrastructure.
6. Security and privacy (middleware, route handlers, CSP, uploads, secrets).
7. Testing, delivery, performance, deployment.

High-severity findings were re-verified line-by-line against the working tree before acceptance (see §7, "Verifier" column). Build/runtime behavior could not be exercised in all cases (a `next dev` server held the working dir; `next build` was not run) — claims that depend on runtime execution are labeled.

**Constraints honored.** No application code, schema, dependency, documentation, or test files were modified. No migrations were run. Only files created: the three documents under `docs/audit/`.

**Verification commands actually executed** (from repo root):

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Exit 0 — no type errors |
| `npx eslint .` | Exit 0 — 0 errors, 0 warnings |
| `npx vitest run tests/unit` (executed by the testing pass) | 31 files, 160/160 tests passed, 90.87 s |
| `next build` | **Not run** (long-running; `next dev` active). Production build status is **Unverified**. |
| Integration tests (`vitest run tests/integration`) | **Not run** (require a live Postgres test DB; running them mutates DB. A test DB may exist but was not assumed.) |
| Migration replay (`scripts/validate-migrations.ts`) | **Not run** (applies migrations to a target DB — mutating; skipped per audit constraints). Script source was inspected instead. |

---

## 2. Repository and module inventory

### 2.1 Stack

Next.js 16.3.2 (App Router, `proxy.ts` as Node-runtime middleware, `forbidden()` route convention), React 19.2, TypeScript 5 (strict), PostgreSQL via Drizzle ORM 0.45 (`pg` driver), Better Auth 1.7 (Drizzle adapter, DB-backed rate limiting), Stripe server SDK 22.5 + `@stripe/stripe-js` 9 (Payment Element), Cloudinary signed uploads, Nodemailer SMTP, Tailwind CSS 4 + shadcn/ui components, Vitest 5 systems. Package manager: pnpm 11.20 (pinned, lockfile 9.0).

### 2.2 Application surfaces

| Surface | Path | Notes |
|---|---|---|
| Storefront | `app/(storefront)/**` | home, products, categories, collections, search, cart, checkout, account (orders/wishlist/profile/settings/recently-viewed/questions) |
| Auth | `app/(auth)/**` | register, login, forgot/reset password, verify email |
| Admin | `app/admin/**` | orders, reviews, questions, banners, collections, coupons, promotions wired; products, brands, categories, customers, inventory, analytics, settings are placeholders |
| API | `app/api/**` | `auth/[...all]`, `banners` (GET), `search/suggestions` (GET), `webhooks/stripe` (POST), `internal/jobs/{expire-reservations, deliver-low-stock-alerts, notification-retry, sync-banners}` (GET+POST, CRON_SECRET), **`validate` (GET — unauthenticated, must be deleted, GP-01)**
| Root | `app/layout.tsx` | fonts, theme pre-paint script (plain `<script>` in body), ThemeProvider, SmoothScroll (GSAP/Lenis loads on every route), Toaster |

### 2.3 Module map (modules/)

| Module | State | Location of real logic |
|---|---|---|
| `catalog` | **Empty scaffolding** (`.gitkeep` only) | Real logic: `services/catalog.service.ts`, `services/{product,product-variant,product-option,product-media,brand}.service.ts`, `services/catalog-public/{queries,search}.ts` |
| `cart`, `checkout`, `orders`, `payments`, `returns`, `promotions`, `coupons`, `collections`, `banners`, `reviews`, `product-questions`, `wishlist`, `recently-viewed`, `notifications`, `inventory`(partial), `analytics`, `jobs`, `customer`(scaffold-only) | Structured domain/application/infrastructure/presentation | see per-feature rows |
| `discounts` | Scaffolding only (empty unit test dirs `tests/unit/discounts`, `inventory`, `order-state`, `pricing` also empty) | — |

Architecture tension: AGENTS.md mandates `modules/<module>/...` organization, but catalog, inventory, and almost all CRUD persistence live in flat `services/*`. Documented as GP-13 (not silently "fixed").

### 2.4 Database

30 Drizzle migrations (`infrastructure/database/drizzle/0000…0029`), journal at `meta/_journal.json` (idx 0–29). Schema in `infrastructure/database/schema/*.ts` (auth, catalog, orders, inventory, reviews, collections, banners, rate_limit, etc.). Migration 0016 contains destructive orphan-sweep `DELETE`s (GP-26). Notable schema facts used throughout this document: `inventory` CHECK constraints (`quantity >= 0`, `reserved_quantity >= 0`, `reserved <= quantity`), `orders_user_idempotency_unique`, `webhook_events (provider, provider_event_id)` unique, returns tables carry the only 8 CHECK constraints.

---

## 3. Feature inventory

Legend for the dimension columns: **UI**, **Logic**, **DB**, **E2E**, **Tests**, **Ops** — ✓ if the dimension is satisfied for the feature.

### A. Commerce core

| # | Capability | Evidence (paths) | UI | Logic | DB | E2E | Tests | Ops | Status | Key gaps |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Product detail page | `app/(storefront)/products/[slug]/page.tsx` | ✓ | ✓ | ✓ | ✗ | ✗ | — | **Needs Hardening** | Dead Add-to-Cart button (L193, no handler); thumbnail `onClick` in Server Component (L127, GP-04); reviews rendered twice; no real slugs (UUID URLs, GP-05); grid of dead tabs |
| A2 | Variant selection | `shared/components/product/VariantSelector.tsx` | ✓ | ✓ | ✓ | ✗ | ✗ | — | **Partially Implemented** | Client component resolves variant and price but passes no `variantId` to any server action — the funnel PDP→cart is unwired (only wishlist→cart works) (GP-04) |
| A3 | Product listing / filtering | `app/(storefront)/products/page.tsx`, `services/catalog-public/search.ts` | ✓ | ✓ | ✓ | Partial | ✓ (discovery integration) | — | **Needs Hardening** | `escapeILike` double-escaping corrupts `%`/`_` queries (GP-06); `listProducts` default sort non-deterministic (no tie-break, GP-07); unstyled `btn/input/select/checkbox` classes (GP-03) |
| A4 | Search | `app/(storefront)/search/page.tsx`, `services/catalog-public/search.ts` | ✓ | ✓ | ✓ | Partial | ✓ | — | **Needs Hardening** | No relevance ranking (default `createdAt DESC`, substring ILIKE only, GP-08); local duplicate `ProductCard`/`formatPrice`; category links inject slug into `q` (search/page.tsx L246-ish, GP-09); no facets; suggestions route 500s on non-numeric `limit` |
| A5 | Categories | `app/(storefront)/categories/[slug]/page.tsx`, `services/catalog-public/queries.ts` (tree CTEs) | ✓ | ✓ | ✓ | ✗ | ✗ | — | **Needs Hardening** | Local duplicate ProductCard; no pagination (first 24 only, mislabeled count); unsorted children |
| A6 | Collections | `app/(storefront)/collections/[slug]/page.tsx`, `modules/collections/**` | ✓ | ✓ | ✓ | Partial | ✓ (collections integration) | — | **Implemented** | Best-in-audit listing page: shared ProductCard, batched promo/wishlist lookups, force-dynamic; cover images use raw `<img>` with eslint-disable |
| A7 | Pricing display | promotion views on PDP/cards/grid via `getVariantPromotionViews`/`getProductPromotionSummaries` (batched) | ✓ | ✓ | ✓ | Partial | ✓ | — | **Needs Hardening** | Customer-facing surfaces consistent (promotion + comparePrice), but hero home sections render hardcoded static data (A10) |
| A8 | **Cart (guest + user)** | `modules/cart/**`, `app/(storefront)/cart/**` | ✓ | ✓ | ✓ | ✓ | ✓ (integration: merge/validate) | — | **Implemented** | Strongest domain: HMAC-signed opaque guest cookie, FOR UPDATE locking, deterministic merge lock ordering, cap-and-retain merge that reports invalid lines instead of silently dropping them; docs truthful. Gaps: ~5 sequential queries per item (`resolveCatalogEntry`, batched nowhere, called 2×/item in validate — GP-10); float `toCents` helper vs Decimal policy (Low) |
| A9 | **Checkout** | `modules/checkout/**`, `app/(storefront)/checkout/**` | ✓ | ✓ | ✓ | Partial | ✓ (unit + integration) | — | **Implemented** | Genuinely strong: dual-transaction pipeline, hash-bound idempotency keys (`orders_user_idempotency_unique`), in-tx cart re-read, coupon row lock, reservation failure compensation, server-authoritative prices only, total-drift confirmation (`expectedTotalCents`, optional at command level: GP-24). Tax is $0 by documented design (`tax.ts` empty jurisdiction table); shipping flat-rate 499/1299¢ + free threshold; both disclosed in `docs/checkout.md`. Guest checkout unsupported (orders.user_id NOT NULL). |
| A10 | Home page merchandising | `app/(storefront)/page.tsx`, `shared/components/home/*`, `shared/constants/index.ts` | ✓ | ✗ | ✗ | ✗ | ✗ | — | **Partially Implemented** | Only `HeroBanners` uses real data (client fetch of `/api/banners`, graceful fallback). `BestSellers`, `NewArrivals`, `Products`, `FeaturedCategories` render hardcoded static arrays with local jpg prices (GP-02). Navbar links to nonexistent `/shop`, `/about`, `/contact` → 404s (GP-11) |
| A11 | Address management | `services/address.service.ts`, `app/(storefront)/account/profile/AddressBook.tsx`, inline guest snapshots at checkout | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Clear-then-insert for default-address partial unique; ownership-scoped everywhere; guest checkout uses inline snapshots (never persists to the book) |

### B. Orders, payments, financial integrity

| # | Capability | Evidence | UI | Logic | DB | E2E | Tests | Ops | Status | Key gaps |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | Order creation & state machine | `modules/orders/application/commands/*`, domain `order-transitions.ts` matrix (single authority) | ✓ | ✓ | ✓ | Partial | ✓ (concurrency tests) | — | **Implemented** | Every state changer takes `SELECT … FOR UPDATE` on the order row first; `order_status_histories` written transactionally; matrix enumerates actors/events (PENDING→PROCESSING webhook-only; SHIPPED prohibited for card+PENDING). Gap: fully refunded PROCESSING orders can never be cancelled/closed (GP-20) |
| B2 | Idempotent checkout | idempotency key + hash + unique constraint + replay semantics (`create-order.ts`) | — | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Hash-bound key; conflicting replay returns stored order; races arbitrated by `orders_user_idempotency_unique` |
| B3 | **Stock reservation** | `reserve-order-inventory.ts` L87–213: FOR UPDATE on inventory rows sorted by variantId, all-or-nothing availability, conditional PENDING→RESERVED with `.returning()` guard | — | ✓ | ✓ (CHECKs) | Partial | ✓ (concurrency) | — | **Implemented** | Over-sell guarded under row locks + DB CHECKs (migration 0007). Caveat: reservation writes bypass low-stock alert hooks (GP-16); `commitOrderReservation` appears orphaned (LOW) |
| B4 | Payment initiation | `modules/checkout/application/payment-init.ts` | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Persists-total-only (rejects client figures), `checkout-{orderId}` idempotency key, COD without external call, Stripe calls outside inventory locks |
| B5 | **Payment webhooks** | `app/api/webhooks/stripe/route.ts`, `modules/orders/application/webhooks/verify-signature.ts` | — | ✓ | ✓ | Partial | ✓ (auth, mismatch, concurrency) | ⚠ | **Needs Hardening** | HMAC + timing-safe + 5-min tolerance; replay protection via unique `(provider, event_id)` + status gating. Defect: events stuck in PROCESSING are unrecoverable (500-forever, no lease timeout) (GP-17); dedup insert races produce spurious 500s (fail-closed) |
| B6 | Refunds | `modules/payments/application/commands/request-refund.ts` | ✓ (admin) | ✓ | ✓ | Partial | ✓ (capped concurrent, ambiguous-gateway) | — | **Needs Hardening** | Genuine Stripe call w/ pinned key refund cap (captured − completed − fresh PENDING), ambiguous-error keeps PENDING, provider-replay convergence. **Defect GP-12:** idempotency key `refund-{paymentId}-{amountCents}` (L290) is reused across separate legitimate attempts → equal-amount repeat refund reports COMPLETED with no new money. Refund guard is `requireAdmin()` (ADMIN or STAFF) while docs claim admin-only (GP-19) |
| B7 | Returns (RMA goods flow) | `modules/returns/**`, transitions matrix, restock with unique movement per line | ✓ | ✓ | ✓ (CHECKs + unique) | Partial | ✓ (restock race) | — | **Implemented** | Quota under per-line locks; DB-enforced one-restock-per-line; refund ≠ restock separation both directions |
| B8 | Financial snapshots & money math | `modules/checkout/domain/{money,calculation,pricing}.ts`, schema snapshot columns, `pricing_policy_version` | — | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Decimal.js everywhere in charging paths, ROUND_HALF_UP once, invariants asserted (`unitPrice === list − discount`), USD-only by design (`CHECKOUT_CURRENCY`, `CURRENCIES`) |
| B9 | Invoices / PDF | — | ✗ | ✗ | ✗ | ✗ | ✗ | — | **Missing** | No invoice generation or PDF dependency anywhere; not mentioned in docs/orders.md. Roadmap item (T-3.4) as product decision |
| B10 | Reconciliation & stuck-state recovery | `webhook_events` + retry semantics + docs | — | Partial | ✓ | ✗ | Partial | ✗ | **Needs Hardening** | Same PROCESSING-stuck gap as B5; manual runbook references nonexistent `handle_checkout_expiration` SQL function and `/health` endpoint (`docs/EXPIRED_RESERVATIONS_OPERATIONS.md` L228, L193) (GP-18) |

### C. Customer experience

| # | Capability | Evidence | UI | Logic | DB | E2E | Tests | Ops | Status | Key gaps |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Auth (register/login) | `shared/lib/auth.ts` (Better Auth + Drizzle adapter), `app/(auth)/**`, `app/api/auth/[...all]` | ✓ | ✓ | ✓ | Partial | ✓ (auth-schemas) | — | **Implemented** | Email verification required; enumeration-resistant reset; DB rate limit 5/min login, 3/min register; roles/status `input:false`. Deactivation not enforced at sign-in (dead-letter session, LOW) |
| C2 | Password reset / email verification | `shared/lib/auth.ts` hooks + branded templates `renderPasswordResetEmail`/`renderVerificationEmail` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | **Needs Hardening** | Both emails fire-and-forget `void sendMail` (L101–107, L191–193) — no queue row, no claim, no retry path; SMTP failure silently loses the email (GP-14) |
| C3 | Session management | cookie blocks `httpOnly/secure/sameSite=lax`, 7-day DB TTL, sliding renewal, revoke-on-reset | — | ✓ | ✓ | ✗ | ✗ | — | **Implemented** | Remembered cookie maxAge (30 d) exceeds DB session TTL (7 d) (LOW); no better-auth admin plugin (session list/revocation UI missing) |
| C4 | Account profile & addresses | `app/(storefront)/account/**`, `shared/lib/actions/{profile,address}.ts` | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | All pages server-guarded (`requireSession`), proxy overlay, whitelisted patches |
| C5 | Order history & detail | `account/orders/page.tsx`, `[id]/page.tsx`, `getOrderDetail(id, { userId })` ownership enforced inside query | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Immutable amounts, event history, PENDING countdown. No shipment tracking (no tracking_number column anywhere, GP-21) |
| C6 | Wishlist | `modules/wishlist/**`, `WishlistToggle`, batched grid membership | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Move-to-cart picks first ACTIVE variant (works around A2 but inconsistent with variant choice) |
| C7 | Recently viewed | `modules/recently-viewed/**`, `product_view_history_user_viewed_idx`, guest merge | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** |
| C8 | Reviews | `modules/reviews/**` (submit → PENDING → moderate; verified-buyer from server `hasDeliveredOrderForProduct`; ≤4 signed Cloudinary images) | ✓ | ✓ | ✓ | Partial | ✓ | — | **Needs Hardening** | Moderation status-change has no durable actor column (console-only actor, GP-22); images accept arbitrary external URLs (`url: z.string().url()`, GP-15); no per-user submission cooldown (GP-15) |
| C9 | Questions & answers | `modules/product-questions/**` | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Staff answer atomic w/ transition; customer queue; content-dedup |
| C10 | UX states: loading/error/not-found | `app/**` | ✗ | — | — | ✗ | ✗ | — | **Missing** | Zero `loading.tsx`, zero `error.tsx`, no root `not-found.tsx` (GP-23). Empty states exist where hand-built |
| C11 | Order status tracking | status badges + event history only | ✓ | ✓ | ✓ | ✗ | ✗ | — | **Partially Implemented** | No carrier tracking numbers; `shipOrder` docstring promises a note but UI passes none (GP-21) |

### D. Administration and operations

| # | Capability | Evidence | UI | Logic | DB | E2E | Tests | Ops | Status | Key gaps |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | Admin access control | `proxy.ts` Node middleware (403 inline), `app/admin/layout.tsx` `requireAdmin()`, per-action `requireAdmin()` in every audited action file | — | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Consistent triple-layer enforcement; no missing-guard action found |
| D2 | Order processing (ship/deliver/cancel/batch/manifest) | `app/admin/orders/**`, `admin-order.actions.ts`, `OrderBatchControls` (max 50, per-item results), shipping manifest page | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Strongest admin area; mandatory cancel reason; COD collection command locked + idempotent. No tracking numbers (GP-21) |
| D3 | Refund admin | `AdminRefundControl`, `requestRefundAction` | ✓ | ✓ | ✓ | Partial | ✓ | — | **Needs Hardening** | Blocking defect is B6/GP-12, not the UI |
| D4 | Product/brand/category/variant admin | `shared/lib/actions/{products,brands,catalog,variants,media}.ts` (fully wired actions, zod-validated, cached-invalidation) | ✗ | ✓ | ✓ | ✗ | ✗ | — | **Partially Implemented** | **Headless:** all eight admin pages are `AdminPlaceholderCard`s — an admin cannot create a product through the UI although the action layer is complete. This is the single biggest product-gap: catalog cannot be authored (GP-27) |
| D5 | Inventory admin | `app/admin/inventory/page.tsx` placeholder; real logic `services/inventory.service.ts` | ✗ | ✓ | ✓ | ✗ | ✓ | — | **Partially Implemented** | Stock adjustment/`setStock`/reservation adjust work via service layer with locked patterns |
| D6 | Customer admin | `app/admin/customers/page.tsx` placeholder; `modules/customer/**` all `.gitkeep`; only `services/customer.service.ts` profile CRUD | ✗ | Partial | ✓ | ✗ | ✗ | — | **Missing** | No list/detail/disable/delete; no server action anywhere sets user `status`/`role` (guards enforce NOTACTIVE that nothing can set) (GP-25) |
| D7 | Executive dashboard | `app/admin/page.tsx` + `modules/analytics/**` | ✓ | ✓ | ✓ | ✗ | ✓ (unit+integration) | — | **Implemented** | SQL-side aggregation, Decimal, UTC half-open windows, 90-day cap, non-USD exclusion; no N+1. No fraud/test-order exclusion flag |
| D8 | Moderation queues | `app/admin/reviews`, `questions` | ✓ | ✓ | ✓ | Partial | ✓ | — | **Needs Hardening** | Wire-quality good; auditability gap (GP-22); rejected reviews terminal (no edit-resubmit) |
| D9 | Marketing admin (banners/collections/coupons/promotions) | `app/admin/{banners,collections,coupons,promotions}/**` + module actions | ✓ | ✓ | ✓ | Partial | ✓ | — | **Implemented** | Signed Cloudinary uploads kept server-side; image upload required before feature-flag gating is enforced |
| D10 | Audit trails | `order_status_histories` (transactional) vs console-only JSON logger for catalog/inventory/moderation | — | Partial | Partial | ✗ | ✗ | — | **Needs Hardening** | Split-brain: only orders have durable actor histories; `inventory_movement`/`reviews` lack actor columns (GP-22) |
| D11 | Admin nav | `ADMIN_LINKS` in `shared/constants/index.ts` L43–60 | ✗ | — | — | ✗ | ✗ | — | **Needs Hardening** | Nav lists 3 sections; admin actually has 15 (LOW) |

### E. Marketing and merchandising

| # | Capability | Evidence | Status | Key gaps |
|---|---|---|---|---|
| E1 | Promotions engine | `modules/promotions/**`, `promotion-rules.ts` (best-promotion-per-line, deterministic tie-break, Decimal, clamped) | **Implemented** | Evaluated live per render (not cached) — correct for time-driven eligibility; bounded 60 s listing staleness documented in docs/promotions.md |
| E2 | Coupons | `modules/checkout/application/coupon.ts` (row lock, per-user + global limits, UTC-safe ts, GREATEST-clamped idempotent release) plus standalone `modules/coupons/**` admin | **Implemented** | Promo-then-coupon order enforced in preview and placement |
| E3 | Hero banners | `modules/banners/**`, `deriveBannerStatus`, `/api/banners` cached 60 s | **Needs Hardening** | `sync-banners` cron endpoint exists but is never scheduled in `vercel.json` → stored statuses drift (GP-28; public eligibility safe) |
| E4 | SEO: sitemap/robots/canonical | absence verified | **Missing** | No `app/sitemap.ts`, `robots.ts`, no `metadataBase`/`alternates` anywhere; `/admin` and `/api` crawlable (GP-05, GP-29) |
| E5 | SEO: structured data | absence verified | **Missing** | No JSON-LD (Product/Organization/Breadcrumb) (GP-29) |
| E6 | SEO: slugs | `queries.ts:458 slug: p.id` | **Missing** | Product URLs are UUIDs (GP-05) |
| E7 | Search relevance | `search.ts` | **Needs Hardening** | Recency ranking, no FTS/trigram (GP-08) |
| E8 | Cart abandonment recovery | absence verified | **Missing** | No table/route/email; stock-expiry job frees stock but never reminds. Proposed product decision only (Roadmap Phase 5) |
| E9 | Email templates | `shared/lib/mail.ts` (`renderVerificationEmail`, `renderPasswordResetEmail` branded tables), `modules/notifications/application/order-emails.ts` `renderOrderEmail` (escaped, minimal div layout) | **Needs Hardening** | Order emails lack branded layout used by auth emails (LOW); `${url}` interpolated unescaped in auth templates (LOW) |

### F. Notifications and background processing

| # | Capability | Evidence | UI | Logic | DB | E2E | Tests | Ops | Status | Key gaps |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | Email transport | `shared/lib/mail.ts` (lazy nodemailer, SMTP envs) | — | ✓ | — | ✗ | ✗ | ✗ | **Implemented** | No health/MX verification; `NOTIFICATION_*` envs honored for retry worker |
| F2 | Order notification queue | `order_notifications` schema (unique `(order_id, type)` claim row), `claimNotification` → `ORDER BY unique` idempotent; retry worker with lease-style conditional claim (`claimDueRow`), backoff, max attempts | ✓ | ✓ | ✓ | Partial | ✓ (send-once races, lease expiry, worker-specific) | ⚠ | **Needs Hardening** | Synchronous dispatch sends `sendMail` while the row stays QUEUED — the retry worker can duplicate a mid-flight email (GP-23b). Fire-and-forget `void dispatchOrderNotification` in serverless actions (Low/Medium) |
| F3 | Reservation expiry job | `modules/jobs/release-expired-reservations.ts`, `handleCheckoutExpiration` order-footprint + reservation release + verify of `releaseCheckoutOperator` | — | ✓ | ✓ | Partial | ✓ (concurrency) | ⚠ | **Implemented** | Verifiable determinant ordering; candidate query bounded; cron (*/5) drives `handleExpiredReservationsRequest` with empty config envs (`EXP-red-ac skipped` — cron ignores `EXPIRED_RESERVATION_*` envs, default config only) (GP-LOW). Synchronous sleep-retry loops can exceed function limits under failure storms (HIGH runtimes) |
| F4 | Low-stock alert delivery | `modules/inventory/application/low-stock-alerts.ts` (memory formal), claim w/ `FOR UPDATE SKIP LOCKED`, dedup partial unique idx, sender, mark-FAILED | — | ✓ | ✓ | Partial | ✗ (no job test) | ⚠ | **Needs Hardening** | No `PROCESSING` lease recovery → a crash strands the alert forever and blocks new alerts for that variant (partial unique); retry cap unenforced; multi-recipient `Promise.all` partial failure duplicates sends (GP-30); **alert hooks never fired by the checkout reservation path** — only inventory-service writes trigger (GP-16) |
| F5 | Banner sync job | `modules/jobs/sync-banner-statuses.ts` | — | ✓ | ✓ | ✗ | ✗ | ⚠ | **Needs Hardening** | `(gp-28)` No cron schedule in `vercel.json` — hygiene-only drift |
| F6 | Job auth | All 4 `/api/internal/jobs/*` routes fail-closed `Bearer CRON_SECRET` | — | ✓ | — | ✗ | ✓ (auth tests) | — | **Implemented** | Non-timing-safe string compare (LOW, standard for such use, fine in practice) |
| F7 | Health endpoint / ops docs | `docs/EXPIRED_RESERVATIONS_OPERATIONS.md` claims vs code | — | ✗ | — | ✗ | ✗ | ✗ | **Missing** | No `/health` route; runbook references a nonexistent SQL function `handle_checkout_expiration` (GP-18) |

### G. Security and privacy

| # | Capability | Evidence | Status | Key gaps |
|---|---|---|---|---|
| G1 | Route-handler auth matrix | `app/api/*` audit (see ARCHITECTURE-GAPS §4 table) | **Needs Hardening** | All jobs + webhook fail-closed ✓; **`/api/validate` public DB mutation (GP-01)** |
| G2 | CSP | `next.config.ts` L41–54 | **Needs Hardening** | **Confirmed breakage (GP-31):** `connect-src` omits `js.stripe.com`/`api.stripe.com`/`m.stripe.network` and `api.cloudinary.com` — CSP blocks Payment Element and all signed browser uploads; jsdelivr whitelists an unused host; `unsafe-eval` unnecessary; placeholder domain in policy |
| G3 | CSRF/cookies | Next Server-Action origin checks; auth + guest cookies `httpOnly, secure, sameSite=lax`; guest cookie HMAC+timingSafeEqual, fail-closed in prod | **Implemented** | Clean; well-built |
| G4 | SQL injection | ~100 `sql`` callsites parameterized; ordering whitelsited; `escapeILike` double-escape only actively wildcards `%`/`_` (GP-06) | **Implemented** | No injection found |
| G5 | XSS | Only static theme script and chart CSS use `dangerouslySetInnerHTML`; user content React-escaped; moderation-first display | **Implemented** | — |
| G6 | Rate limiting | Login/register/reset/verify DB-backed in `shared/lib/auth.ts` L209–235 | **Needs Hardening** | No rate limits on public APIs, review/question submission, or signed-upload param issuance (GP-15) |
| G7 | Upload validation | `validateImageFile` defined but never invoked (dead code) (GP-15) | **Needs Hardening** | Signed flow limits folder scope only; no server-side size/format revalidation; review images accept external URLs |
| G8 | Secrets | `config/env.ts` zod; `.env` git-ignored; no `NEXT_PUBLIC_*` secrets; publishable key only client exposure | **Implemented** | `BETTER_AUTH_API_KEY` required-but-unused (LOW) |
| G9 | PII in logs | structured logger ids-only; two raw `console.error(error)` paths can embed recipient | **Implemented** | LOW polish |
| G10 | GDPR/data deletion | absence verified | **Missing** | No account deletion/anonymization path at all (SRS requires right-to-be-forgotten §746) (GP-25) |

### H/I/J. Horizontal concerns — see ARCHITECTURE-GAPS.md

The cross-cutting findings (architecture boundaries, cache machinery, N+1 patterns, CI, bundle size, migrations, observability) are consolidated in the companion gap document with stable IDs; the summary level is provided there to avoid duplication.

---

## 4. End-to-end workflow completeness

| Workflow | Entry → exit trace | Verdict |
|---|---|---|
| **Discover → PDP → variant → add to cart** | listing pages → PDP → VariantSelector (client) → *(no action call)* → cart | **BROKEN for organic cart adds.** The add-to-cart button has no handler; VariantSelector does not forward the resolved variant to any server action. Only wishlist → cart works. (GP-04) |
| Add to cart → checkout preview → place order | cart actions (zod, session-aware owner converge + merge) → `previewCheckout` (live pricing) → `placeOrder` with `expectedTotalCents` → dual-transaction create-order → reservation → Stripe init | **Sound**, with A2 blocking entry. |
| Place order → pay (card) | Stripe Payment Element mounted from server `clientSecret`; webhook → verify → finalize (locks order+payment, amount/currency check, commit reservation w/ inventory decrement + SALE movements, PROCESSING/PAID) → receipt email | **Sound**; webhook PROCESSING-stuck recovery missing. |
| Pay (COD) | COD provider recorded, no external call; ship permitted PENDING (COD-only), collect-on-delivery command | **Sound** |
| Payment fails / reservation expires | failure webhook → release + CANCELLED; expiry job per-order `handleCheckoutExpiration` | **Sound**, duplicate-email claim caveat. |
| Customer cancels | PENDING + non-PAID only, lock-first, coupon release in-tx, audit row | **Sound** |
| Admin fulfills | ship/deliver via transition matrix under lock; batch ship ≤ 50 per-item results; manifest | **Sound**; no tracking number |
| Partial refund → restock | `requestRefund` (Stripe key refund) / returns `restockReturn` with unique movement | **Sound** except GP-12 equal-amount replay |
| Moderation → publish | review/question submission PENDING → admin approve/reject → cache tags invalidated | **Sound** |
| **Catalog authoring** | admin actions exist → **no UI** | **BROKEN end-to-end (product gap)** — backend complete, admin cannot create/edit products via UI (GP-27) |

---

## 5. Testing evidence

**Actually executed.** Unit suite `npx vitest run tests/unit`: 31 files, 31/31 passed, 160/160 tests, 90.87 s (94 s of which is happy-dom instantiation overhead — fixable via `pool: 'vmThreads'`). `tsc` and `eslint` clean.

**Inspected but not executed.** 40 integration test files spanning orders (lifecycle hardening: concurrent cancel-vs-finalize "exactly one wins with balanced inventory either way"; duplicate finalization; failure no-ops on PAID; audit exactness), payments (webhook signature/auth, amount mismatch no-mutation, concurrent success-vs-failure), refunds (concurrent cap, ambiguous gateway), returns (restock exactly-once), notifications (send-once races), inventory invariants, checkout, coupon.

**Not covered by any automated test:** e2e (5 empty scaffold dirs, no Playwright dependency exists), storefront untyped-class rendering (GP-03 would have been caught by any e2e or visual check), low-stock delivery job end-to-end, webhook PROCESSING recovery, equal-amount repeat refund, catalog admin actions (never wired to UI → uncovered).

**Test infrastructure risk.** Integration tests share a DB with FK-ordered teardown (no rollback), pool max 3, `VELORA_TEST_DATABASE_URL` falls back to a hardcoded localhost string (a prod-looking misconfiguration would not silently hit prod because `DATABASE_URL` is not consulted — but if `VELORA_TEST_DATABASE_URL` itself points at prod there is no guard).

---

## 6. Summary counts

| Status | Capability count (approx.) | Representative |
|---|---|---|
| Implemented | 24 | checkout pipeline, cart, order lifecycle, refunds, returns, collections, dashboard, promotions, coupons, auth |
| Needs Hardening | 17 | add-to-cart funnel wiring, search, webhooks stuck-state, reviews security, notifications claim race, inventory admin UX |
| Partially Implemented | 7 | variant→cart, home merchandising, catalog admin, tax (zero by design), tracking |
| Missing | 9 | sitemap/robots/canonical/JSON-LD, slugs, invoices, GDPR deletion, loading/error/not-found, customer admin, cart-abandonment (optional), rate-limit UGC |
| Unverified | 3 | production build, live Stripe/Cron behaviors, migration replay |

---

## 7. Unverified areas and inspection gaps

| Area | What remains unknown | How to verify |
|---|---|---|
| Production build | `next build` never run this audit | run `pnpm build` with dev server stopped |
| Stripe live behaviors | All Stripe work tested against mocks per docs/production-readiness.md | staging Stripe account, test keys |
| Vercel cron delivery | Whether Vercel-injected `Authorization: Bearer $CRON_SECRET` reaches handlers (config has unsupported `"method"` field) | staging deploy, watch job routes for 401s |
| Live DB schema drift vs declared schema | e.g. `order_notifications_retry_idx (status, next_retry_at)` claimed by docs but absent in declared schema | run `drizzle-kit push` in dry mode / inspect live DB |
| Runtime hydration of Server Component onClick (GP-04) | throws at request vs silently dead | attempt to render a multi-image product after deploy or in test |
| Guest-cart converge-after-login coverage | users who log in but never touch cart keep live guest cookie | manual QA |
| Actual catalog data volume | performance of ILIKE search and tree CTEs at scale unknown | seed ≥ 10^4 products, EXPLAIN ANALYZE |
| CSP actual effect | confirmed breakage by spec-reading of Stripe.js/Cloudinary flow, not observed live | enable CSP violation logging in staging |

---

## 8. Recommended next actions (highest leverage)

1. **T-0.2 (GP-01): delete `app/api/validate/route.ts`** — trivial, removes the only public DB-mutation surface.
2. **T-0.1 (GP-04): wire PDP add-to-cart** — restores the core commerce funnel (client gallery/variant ATC component calling the existing cart action).
3. **T-0.3 (GP-31): fix CSP** — staging payment testing is impossible while `connect-src` blocks Stripe.
4. **T-0.4 (GP-03): add missing UI utility classes or port to shadcn primitives** — unstyle-controlled buttons/inputs today.
5. Then the notification/webhook/ops hardening and admin product-UI build-out per the roadmap.

# VELORA — Architecture Gap Analysis

> Issue register with stable IDs (`GP-xx`) referenced by [`FEATURE-INVENTORY.md`](./FEATURE-INVENTORY.md) and [`MASTER-ROADMAP.md`](./MASTER-ROADMAP.md).
> Severity: **Critical / High / Medium / Low / Informational**. Confidence: High = code-verified directly (many re-verified manually); Medium = consistent multiple code reads; Low = needs runtime evidence.

---

## 1. Executive technical assessment

VELORA is a **well-architected order-and-payment core wrapped in an unfinished storefront**. The.financial spine — checkout pipeline (dual transactions, hash-bound idempotency, coupon row-locks, reservation compensation), order state machine under `SELECT … FOR UPDATE`, inventory over-sell defenses (row locks + CHECK constraints + deterministic lock ordering), refunds with pinned-key caps and provider-replay convergence, and the analytics dashboard — is engineered to a standard most production stores do not reach, and is covered by 160 passing unit tests plus 40 substantial integration files.

Against that, the **product surface currently cannot do its primary job end-to-end**: a product cannot be added to a cart from the product page (dead button, unwired variant funnel), the admin cannot create a product through UI (placeholders over a complete action layer), core storefront pages including those same buttons render unstyled (`btn`/`input`/`select`/`checkbox` classes exist in no CSS source), and the Content-Security-Policy as written has been verified, by specification, to block both Stripe.js and Cloudinary browser uploads in production. One unauthenticated API route writes/deletes rows in the production database on GET.

The correct posture: **do not deploy.** Execute Phase 0 (five small fixes, each days or less), then decide scope for admin tooling and notifications hardening before launch.

---

## 2. Architecture overview (as-built)

```
app/**                     Route surfaces: (storefront), (auth), admin, api (5 handlers + jobs)
proxy.ts                   Next 16 Node-runtime middleware: session + role gate (admin/account/orders/checkout)
shared/lib/{guards,auth,mail}.ts   Session/role guards; Better Auth config + DB rate limits; SMTP transport
shared/lib/cache/          Centralized cache tag taxonomy + invalidation (updateTag)
services/*                 Flat Drizzle CRUD + catalog-public cached queries (legacy of pre-module layout)
modules/<domain>/{domain,application,infrastructure,presentation}   Cart, checkout, orders, payments,
                           returns, promotions, coupons, collections, banners, reviews, product-questions,
                           wishlist, recently-viewed, notifications, analytics, jobs; catalog & customer empty
infrastructure/database/schema/*.ts + drizzle/ (30 migrations)     inventory, orders, payments, returns,
                           webhook_events, order_notifications, low_stock_alerts, rate_limit …
shared/components/         shadcn-based UI kit + bespoke storefront components
tests/{unit,integration,e2e}       31 unit files (160 tests, green), 40 integration files, e2e scaffold only
docs/*.md                  Domain runbooks — spot-audited as truthful except EXPIRED_RESERVATIONS_OPERATIONS.md
```

Conventions that hold consistently (verified): server-first rendering, Server Actions as the mutation boundary, zod validation before DB access under every audited action, server-side identity from session (never client-supplied ids), centralized cache invalidation, guest data in server-side rows behind signed opaque tokens, exact-integer minor units for money in all charging paths.

---

## 3. Confirmed defects and evidence-based risks

### GP-01 — Unauthenticated DB-mutating validation harness (Critical, High confidence)
- **Evidence:** `app/api/validate/route.ts` (309 lines; self-described "DELETE THIS FILE after validation"). Every GET inserts 2 `user` rows + profile + 3 addresses via the real service layer, then deletes them; `dynamic = "force-dynamic"`; **no auth, no role, no CRON gate, no rate limit**; returns raw internal error messages (L292); deletion cascade risk on partial failure.
- **Consequence:** anonymous remote write/delete on the production DB; I/O and vacuum amplification; PII-shape writes; internal-message disclosure.
- **Minimal fix:** delete the file. (Auditor verified content directly; multiple agents independently flagged.)

### GP-02 — Home page merchandising is fake data (High, High confidence)
- **Evidence:** `app/(storefront)/page.tsx` L15–21; `BestSellers/NewArrivals/Products/FeaturedCategories/OurStory` consume `shared/constants/index.ts` static arrays (`ProductsList` L62–ff). Only `HeroBanners` fetches real data (client fetch `/api/banners`, graceful fallback).
- **Consequence:** most-visited page misrepresents the catalog; no cache coherency; prices without currency formatting.
- **Fix:** replace with `searchProducts`-based batched section queries (the pattern `/collections/[slug]` already demonstrates).

### GP-03 — Core storefront controls are unstyled (High, verified)
- **Evidence:** `app/globals.css` defines only Tailwind 4 glue + `@import "shadcn/tailwind.css"`; inspected `node_modules/shadcn/dist/tailwind.css` — no `.btn/.btn-primary/.btn-sm/.btn-lg/.input/.checkbox/.select/.radio/.input-sm/.select-sm` anywhere; no daisyUI plugin/dependency exists. Yet components use them: `app/(storefront)/products/page.tsx` (filter sidebar + Apply), `app/(storefront)/search/page.tsx`, `app/(storefront)/products/[slug]/page.tsx:193` (**the Add to Cart button**), `shared/components/product/CatalogFilterControls.tsx` (checkbox/select).
- **Consequence:** primary commerce pages render native unstyled controls — the user experience is broken at exactly the surfaces a "luxury" invariant must protect.
- **Fix:** define the utilities from the design system tokens, or port those components to existing shadcn primitives.

### GP-04 — Add-to-cart funnel unwired (Critical, High confidence)
- **Evidence:** `products/[slug]/page.tsx:193` `<button className="flex-1 btn btn-primary btn-lg">Add to Cart</button>` (no handler/type/action); L127 thumbnail `onClick` inside a Server Component; `shared/components/product/VariantSelector.tsx` resolves variant/price client-side but imports no server action; the only organic add-path is `modules/wishlist/application/commands/wishlist.ts:137` (first ACTIVE variant) → cart action `modules/cart/presentation/actions/cart.actions.ts:162`. Dead tabs at L224–226; placeholder specs section.
- **Consequence:** core commerce funnel broken organically everywhere but wishlist.
- **Fix:** one client component (gallery + variant ATC) calling `addToCart` with the resolved `variantId` (zod schema already accepts it); remove inline thumbs' onClick; restore gallery interaction.

### GP-05 — No product slugs; UUID URLs (High for SEO/commercial, High confidence)
- **Evidence:** `services/catalog-public/queries.ts:458,500,527,568` and `search.ts:360` (`slug: p.id`); schema has no `products.slug`; `getProductBySlug` = `eq(products.id, …)`.
- **Consequence:** every product URL shares no keyword; sitemap/structured-data plan blocked; unshareable links.
- **Fix:** additive migration `products.slug` (generated from name, unique, backfilled, 301-ready patterns preserved by serving both id and slug); index, update all slug sites.

### GP-06 — `escapeILike` double-escape wildcard bug (Medium, High confidence) + user wildcard amplification
- **Evidence:** `services/catalog-public/search.ts:145-150` two chained `.replace()` passes negate each other; `ilike` pattern then treats user `%`/`_` as live wildcards (`?q=%%%%` full-scan amplification).
- **Fix:** single-escape `%`, `_`, `\`; verify with a `%`-bearing query test.

### GP-07 — `listProducts` default sort non-deterministic (Medium, High confidence)
- **Evidence:** `services/catalog-public/queries.ts:726-755` bare `products.createdAt` (ASC! no id tie-break) vs `search.ts:212-228` which is deterministic. Pagination can duplicate/skip rows.
- **Fix:** mirror the search ordering (`createdAt DESC, id ASC`).

### GP-08 — Search relevance absent (Medium, High confidence)
- **Evidence:** `search.ts` ILIKE-only substring; default ranking `createdAt DESC`; no tsvector/trigram/sqlite FTS; plus expensive per-row correlated subqueries for price/rating (scale-dependent).
- **Fix:** first-order: rank name-match above description (cheap CASE in ORDER BY). Later: `pg_trgm` index or FTS column per measured need.
- **Status:** `MEASURED (T-4.5, code-level/local-DB only)`. EXPLAIN ANALYZE at the roadmap's mandated 10k-product seed: name/description/SKU ILIKE search is linear (99 ms at 10k, whole-index scan; every matched row costs proportionally more at scale) — but the shipped partial listing index (`products_active_created_idx`, migration 0036) gives common-match search queries an early-exit plan (measured 0.9 ms when matches are dense; rare terms remain O(n) worst case). Full trigram/FTS indexing is **blocked on the environment**: `pg_trgm` is not installed in the local Postgres 18.6 build and cannot be honestly shipped without a local EXPLAIN verification — documented as the exact proposed DDL in `docs/db-integrity.md` ("Scale validation") for the product/ops gate.

### GP-09 — `/search` filter links mangle `q` (Medium, verified); GP-09a filter param loss
- **Evidence:** `app/(storefront)/search/page.tsx` category anchors `href={/search?q=${category.slug}&category=…}` (clicking a category searches the literal slug text); brand/category anchors drop minPrice/rating/sort params on both /search and /products.
- **Fix:** param-preserving link builder (single shared helper; also de-duplicates the pages, GP-09b: three divergent `ProductCard` implementations — `shared/components/product/ProductCard.tsx` vs search-page local vs categories-page local — different images/price/wishlist behavior).

### GP-10 — Cart item-resolution N+1 (Medium, verified multiple paths)
- **Evidence:** `modules/cart/application/cart-context.ts:143-197 resolveCatalogEntry` = 5 sequential queries/variant; called by `validateCartForCheckout` twice per item (`validate-cart.ts:75,188`), `getCartDetail`, `previewCheckout`, `create-order`.
- **Consequence:** 20-item cart ≈ 200 queries at validate/preview; latency + connection pressure.
- **Fix:** batch variant/product/image/inventory/promotion lookups by variantId set; keep the per-line promotion precision.
- **Status:** `RESOLVED (T-4.1)`. `resolveCatalogEntries(variantIds)` added next to the single resolver — variants/products/images/inventory/promotion-candidates in 5 fixed queries with byte-identical entry semantics (missing product row → absent from the map; `available = quantity - reserved`; one `now` sample for the batch through the same deterministic `selectBestPromotion`). Wired into all six loop sites (`validate-cart` building the map ONCE and reusing it for the totals pass, `get-cart`, `merge-guest-cart`, `checkout-preview`, `create-order.revalidateLines`); the per-item + per-mapping expired-promotion probes collapsed into one leftJoin scan (`findExpiredPromotionProductIds`). Measured with a query-counting lens in `tests/integration/cart/cart-merge-validate.test.ts`: validating a 2-variant cart now issues **8 fixed queries** (bounded independent of item count; was ~5/item + per-item expired probe + a second full resolution for the totals pass). Single-item callers (`add-item`, `update-item`) keep the original resolver.

### GP-11 — Navbar links to nonexistent routes + stale ADMIN_LINKS (Medium/Low, verified)
- **Evidence:** `shared/constants/index.ts:24-41` (`/shop`, `/about`, `/contact` — no such routes); `ADMIN_LINKS` (L43–60) lists 3 sections vs 15 real.
- **Fix:** point nav at `/products`; drive admin links from the real registry.

### GP-12 — Refund idempotency-key collision on equal-amount repeat refunds (High, High confidence)
- **Evidence:** `modules/payments/application/commands/request-refund.ts:290` `idempotencyKey: refund-${paymentId}-${amountCents}`; TxB genesis picks the older COMPLETED row by matching providerRefundId (L344–353), cancels the staging row, and reports COMPLETED to admins. `docs/returns.md` L24–26 acknowledges deterministic replay but only as duplicate-request.
- **Consequence:** admin believes a second equal-amount refund shipped; no money moved; reconciliation drifts silently.
- **Fix:** include per-attempt nonce or staged-row id in the Stripe key; keep convergence for genuine retries; add regression test (second equal-amount refund must move money).

### GP-13 — Layer drift: `services/*` flat CRUD repository vs AGENTS.md module convention; `modules/catalog` empty; `infrastructure/stripe/*.ts` empty stubs (Medium, verified)
- **Evidence:** `modules/catalog/**` all `.gitkeep`; real catalog code in 8 flat `services/*.ts`; `infrastructure/stripe/{client,payments,refunds,webhook}.ts` all 0 bytes while Stripe logic lives in `modules/checkout/application/payment-init.ts` + `modules/payments/application/commands/request-refund.ts` + `app/api/webhooks/stripe`. `modules/inventory/**` mostly empty (logic in `services/inventory.service.ts`); `modules/customer/**` all `.gitkeep`.
- **Consequence:** AGENTS.md §3 mandates module-shaped domains and "follow closest existing module": future engineers will both duplicate and miss. Empty-but-real directories mislead.
- **Fix (opinionated but minimal):** create `modules/catalog/{services,queries}` thin re-exports (no logic moves), delete or populate `infrastructure/stripe` stubs; document the convention and any decision to defer moves (product-owner sign-off per §11).

### GP-14 — Verification & password-reset emails have no durable path (High, verified)
- **Evidence:** `shared/lib/auth.ts:101-107` (`void sendVerificationMail(...)` reset) and `:191-193` (verification) — no queue row, no claim, no retry, no status. Compare with order emails: `order_notifications` claim row + retry worker exist and are tested.
- **Consequence:** SMTP outage/freeze silently loses account-verification and reset emails; users can permanently lock themselves out (login requires verified email).
- **Fix:** reuse the `order_notifications` pattern with a typed `auth_emails` queue (unique per `(user_id, purpose, token_id)`), or accept and document the risk with SMTP→provider fallback matching the doc's own suggestion.
- **Status:** `RESOLVED (T-3.3)`. New `auth_emails` queue (migration 0034) stores the rendered email at enqueue time; the Better Auth `sendResetPassword`/`sendVerificationEmail` hooks enqueue + dispatch through the same CAS `QUEUED -> SENDING(lease) -> SENT | QUEUED(backoff) | FAILED` machine the order-retry worker runs; new retry worker `modules/jobs/auth-email-retry.ts` with `/api/internal/jobs/auth-email-retry` (CRON_SECRET, added to `vercel.json` at `*/5`). The queued row cascades with the account (an email without its recipient is useless — deliberately unlike the 0033 audit trail). No unique claim per `(user, purpose)`: a fresh link request is a fresh row; Auth rate limits bound abuse. Reset-link retries replay the stored body — the 60-minute token covers the backoff window, and a post-expiry replay is harmlessly rejected by Better Auth (user re-requests a link).

### GP-15 — UGC abuse surface: no rate limits or upload validation (Medium, verified)
- **Evidence:** no cooldown on `submitReviewAction` unique only per `(user, product)`; `submitQuestionAction` content-dedup only; `getReviewImageUploadParamsAction` unmetered; `validateImageFile` (`infrastructure/cloudinary/client.ts:154-176`) never invoked; `review.actions.ts` schema accepts any external `url`.
- **Fix:** per-user rate limits (reuse Better Auth Postgres rate-limit table), enforce `validateImageFile` on action input, restrict image URL to uploaded Cloudinary publicIds.
- **Status:** `RESOLVED (T-2.9)`. Per-user throttles on review submit (5/10 min), question submit (5/10 min), and signed upload params (30/h) via `shared/lib/rate-limit.ts` reusing the Better Auth `rate_limit` table (atomic upsert, fail-open on infra error — documented); `validateImageFile` moved to a browser-safe shared module and is now the single source used by the review form; review submission accepts ONLY images uploaded through the author's own signed folder (`velora/reviews/<userId>/…`) with the delivery URL locked to the same reference (cross-cloud/hand-crafted URLs rejected).

### GP-16 — Checkout reservation path misses low-stock hooking (Medium-High, verified)
- **Evidence:** only `services/inventory.service.ts` trio calls `checkAndCreateLowStockAlert`; `reserveOrderInventory`/`release`/`commit` (`modules/orders/application/commands/reserve-order-inventory.ts`) never do. Stock can drain purely through checkouts with no admin alert.
- **Fix:** call alert-check in commit/reserve release/commit paths from the same transaction inventory lock site.

### GP-17 — Webhook events stuck in PROCESSING unrecoverable (Medium-High, verified)
- **Evidence:** `app/api/webhooks/stripe/route.ts:96-125`: COMPLETED → success, PROCESSING → 500 every retry, FAILED → retry (attempts++). Nothing later flips stale PROCESSING rows; contrast `order_notifications.claimDueRow` lease-timeout pattern; `low_stock_alerts` similarly has no lease recovery (GP-30).
- **Consequence:** a crash between PROCESSING mark and completion permanently blocks `payment_intent.succeeded` — paid order stuck PENDING with reserved stock until manual SQL.
- **Fix:** lease column + expiry check (`updated_at < now()-lease` flips to FAILED with bounded retries), operational query, integration test.

### GP-18 — Runbook references nonexistent SQL function (Low, verified)
- **Evidence:** `docs/EXPIRED_RESERVATIONS_OPERATIONS.md` L228 manual recovery `SELECT * FROM handle_checkout_expiration('ORDER_UUID')` — no such SQL function exists (grep); `/api/internal/jobs/health` (doc L193) does not exist.
- **Fix:** fix the doc; the actual recovery is the repo's own endpoint + default batch config.

### GP-19 — Refund permission semantics inconsistent (Medium, verified)
- **Evidence:** `modules/payments/presentation/actions/refund.actions.ts:36` comment "Admin-only"; commands accept STAFF via `requireAdmin()` (`ADMIN_ROLES` = ADMIN|STAFF, `shared/lib/roles.ts`). Money movement by STAFF is policy, not bug — but docs, code comment, and actual roles three ways disagree.
- **Fix:** product-owner decision: either gate refunds to ADMIN role (`requireRole`) or update docs consistently. (Roadmap marks this an approval-required decision.)

### GP-20 — Cancel-after-refund deadlock (Medium, verified)
- **Evidence:** `order-lifecycle.ts:29-31` `RELEASABLE_PAYMENT_STATUSES` excludes REFUNDED/PARTIALLY_REFUNDED; `order-transitions.ts` matrix has no PROCESSING→CANCELLED edge for those. A fully refunded PROCESSING order can only be shipped/deferred — never closed; admin UI offers no path.
- **Fix:** add explicit `cancelled_after_refund` edge (ledger note, no inventory impact) and a test.

### GP-21 — No tracking numbers anywhere (Medium, verified)
- **Evidence:** no `tracking_number`/`carrier` column in `infrastructure/database/schema/orders.ts`; `admin-order-controls.tsx` calls `shipOrderAction(orderId)` (no note); `shipOrder` docstring (`order-transitions.ts:149`) promises a tracking/note requirement; `note ?? "Order shipped"` default renders the promise moot. No customer tracking UI exists beyond status history.
- **Fix:** decision-gated: either add carrier/tracking columns + inputs + customer display (roadmap T-2.3) or drop docstring claim.

### GP-22 — Durable audit trail only for orders (Medium, verified)
- **Evidence:** `order_status_histories` written transactionally (`modules/orders/application/commands/order-transitions.ts:35-59`); but `inventory_movement` schema has no actor column (quantity/type/reason/notes only — `schema/inventory.ts:73-125`), `reviews` has no moderator column; catalog CRUD/audit goes to `logger.catalog.*` console JSON only (`shared/lib/logging/logger.ts` = structured `console[]` calls).
- **Consequence:** operational forensics for money-adjacent actions (stock adjustments, refund moderation) lost on redeploy (no persistent sink).
- **Fix:** add `actor_id` on `inventory_movement` + review moderation via additive migrations; or decide console is sufficient pending an aggregating sink.
- **Status:** `RESOLVED (T-2.8)`. Migration `0032_audit_actor_columns.sql` adds nullable `actor_type`/`actor_id` on `inventory_movement` (0017 vocabulary) + `moderated_by`/`moderated_at` on `reviews`; every movement write site persists the actor; moderation persists actor+moment on actual transitions only. Console logging remains the catalog-CRUD trail pending the external sink (T-3.6, product/ops decision).

### GP-23 — Zero loading/error/not-found boundaries (Medium, verified)
- **Evidence:** repo-wide absence of `app/**/loading.tsx`, `app/**/error.tsx`, root `app/not-found.tsx` (agent glob + direct check).
- **Consequence:** full-paint blocking on all force-dynamic pages; uncaught RSC errors crash into framework default; not-found falls through to Next default.
- **Fix:** root + admin + auth + storefront error/loading files; keep minimal.
- **Status:** `RESOLVED (T-3.1)`. Root `app/error.tsx` + `app/global-error.tsx` (own html/body; this Next version's boundary API is `{ error, retry }`) + root `app/not-found.tsx` (single root layout — no experimental `global-not-found.js` needed) and segment `loading.tsx`/`error.tsx` for `(storefront)`, `(auth)`, and `admin`, all built on shared server-safe skeletons (`shared/components/loading/skeletons.tsx`) using the existing token classes. Boundaries surface only the digest reference, never the error internals.

### GP-23b — Notification dispatch claim-not-lease duplicate send (Medium-High, verified by code path)
- **Evidence:** `modules/notifications/application/order-emails.ts:43-78`: `claimNotification` (insert-or-ignore QUEUED row) → inline `sendMail` while status stays QUEUED → retry worker `claimDueRow` (QUEUED scan) can pick the in-flight row during a slow SMTP call (cron every 5 min). Only the async retry path leases.
- **Consequence:** duplicate order emails possible (bounded: needs slow SMTP + unlucky cron timing); refunds/webhooks never wait on mail.
- **Fix:** synchronous path sets SENDING + lease before `sendMail`, or marks immediately and lets only the retry worker send.
- **Status:** `RESOLVED (T-3.4)`. `dispatchOrderNotification` now CASes `QUEUED -> SENDING` (`startNotificationDispatch`) before the SMTP call; a retry worker that wins the race between insert and CAS suppresses the dispatch path (`already-handled`, no duplicate), and a crash mid-send leaves a SENDING lease the worker reaps at expiry. Regression-tested in `tests/integration/notifications/order-emails.test.ts` (in-flight SENDING assertion + pre-leased skip).

### GP-24 — `expectedTotalCents` optional at command boundary (Low-Medium, verified optionality)
- **Evidence:** `create-order.ts:303` optional param; UI always passes it; `TotalChangedError` skip only when caller omits it. Server still charges its own recomputed total (no monetary risk), but the drift confirmation is client-cooperation-enforced.
- **Fix:** make it required from the action boundary (accept `undefined` only for internal callers/test harness).

### GP-25 — Customer management and GDPR deletion missing (High for compliance, verified absence)
- **Evidence:** `app/admin/customers/page.tsx` placeholder; `modules/customer/**` all scaffold; no server action sets `user.status`/`role` anywhere (guards enforce NOTACTIVE that nothing can set — dead-letter state); no account-deletion or anonymization path despite SRS right-to-be-forgotten (SRS §746); addresses snapshot retention unbounded (fine) but no policy statement.
- **Fix:** admin customer list + detail + disable action (reuse guards); account deletion request flow (decide snapshot-retention policy as product decision); status/role actions only via admin (Better Auth admin plugin or custom actions).
- **Status:** `RESOLVED (T-2.3)` for the management axis — paginated account list with search/status filter; detail page with profile + status/role toggles (server-gated actions, self-change lockout rejected, reason captured) and a durable audit trail (`user_admin_events`, migration 0033, transactional with the account write). The GDPR deletion/anonymization axis stays **open, product-owner-gated (T-2.4)**: snapshot-retention policy and deletion semantics are a compliance decision, not an engineering default.

### GP-26 — Migration 0016 destructive orphan sweep + validate-migrations non-empty warns-only (Medium-High, from repo docs & code)
- **Evidence:** `infrastructure/database/drizzle/0016_reconcile_declared_indexes.sql` deletes orphaned `order_items/addresses/payment rows` and `ORD-TEST-%` fixtures; header admits "WOULD delete real orphans in production"; `scripts/validate-migrations.ts:52-55` warns-only on non-empty DB (validates nothing if pointed at real data).
- **Status:** `RESOLVED (T-2.6)`. `validate-migrations.ts` now aborts on non-empty databases unless `--allow-non-empty` is passed, and locates the migration-history table across schemas. A reviewed, backup-first sweep migration (`0031_gp26_orphan_sweep_backup.sql`) is chained after it: it backs up every orphaned row it deletes into `gp26_orphan_backup_*` audit tables (idempotent, keyed on id) so adoption replays are reversible. The historical 0016 file itself is NOT modified (applied migration); a database adopted with pre-existing data through a fresh `db:migrate` replay still executes 0016's historical sweep — the guard is that such an adoption must not go through replay at all (see MIGRATION_ADOPTION_PLAN.md Option A baseline procedure).
- **Consequence:** deployment runbook could destroy legitimate data if run against prod with orphans that should be preserved.
- **Fix:** gate the orphan sweep behind an operator-approved, separately-created data-cleanup migration with backup; harden validator to abort non-empty targets unless override flag.

### GP-27 — Admin catalog UI missing while actions wired (High, verified absence)
- **Evidence:** `app/admin/{products,brands,categories,settings}/page.tsx` and `inventory/page.tsx` are `AdminPlaceholderCard` renders; `shared/lib/actions/{products,brands,catalog,variants,media}.ts` fully implemented with zod + requireAdmin + cache-taggable surfaces; no `.tsx` imports them (agent grep zero hits).
- **Consequence:** **catalog cannot be authored, priced, or adjusted via the product UI**; storefront inventory depends on hand-run scripts. This is the largest operational blocker after GP-04.
- **Fix:** single "ProductForm" client component driven by `productSchema` calling existing actions; brands/categories simpler forms; inventory adjust panel; wire `ADMIN_LINKS`.
- **Status:** `RESOLVED (T-2.1 / T-2.2)`. Full CRUD pages for brands and categories (hierarchy display via `buildCategoryTree`, cycle/orphan-safe), product list/new/detail with images panel (signed uploads, canonical `validateImageFile`) and variant manager (mirrors the storefront VariantSelector shape, batched `listVariantsForAdmin` read); inventory console with alert stats + currently-low strip + reason-forced adjust driving `adjustInventory`; `ADMIN_LINKS` extended. `settings`/`analytics` remain placeholders (explicitly out of the roadmap's Phase 2 task list).

### GP-28 — `sync-banners` endpoint unscheduled (Low-Medium, verified)
- **Evidence:** `vercel.json` crons only 3 jobs; `app/api/internal/jobs/sync-banners/route.ts` exists with its own `CRON_SECRET`; docs flag it operator-configured. Public eligibility remains correct (live window checks); stored status drift concentrates hygiene.
- **Fix:** add cron entry or document non-scheduling decision.

### GP-29 — SEO surfaces missing as a system (High for launch catalog, verified absence)
- **Evidence:** no `app/sitemap.ts`, `robots.ts` (`/admin`,`/api` crawlable), no `metadataBase`/`alternates` canonical anywhere, no JSON-LD (Product/Organization/Breadcrumb) — combined with GP-05 UUIDs.
- **Fix:** add sitemap (products/categories/collections canonical), robots with disallow `/api`,`/admin`, metadata base + per-route canonical, Product JSON-LD on PDP with price/availability.

### GP-30 — Low-stock alert stuck-PROCESSING + multi-recipient partial-failure duplicates (Medium, verified)
- **Evidence:** no lease recovery for `PROCESSING` rows in `low_stock_alerts` (crash strands alert forever; partial unique blocks re-alert per variant); `deliverSingleAlert` `Promise.all` of recipients + requeue → duplicate emails to already-sent recipients.
- **Fix:** same lease expiry pattern as GP-17; per-recipient send/dedup or chunked send semantics.
- **Status:** `RESOLVED (T-3.5)`. Delivery now uses a per-recipient ledger (`low_stock_alert_recipients`, migration 0035, unique `(alert_id, recipient_email)` IS the dedup guard): recipients are deduped case-insensitively, already-served inboxes are skipped on retry, sends go out one SMTP call at a time with the ledger row written immediately per success (a crash can only under-send, never duplicate), and an alert is DELIVERED only when every recipient has a ledger entry. Claim-side: `getNextPendingAlert` now reclaims PROCESSING rows past a `leaseMs` window (GP-17 pattern), honors `retryDelayMs` for failed rows, and `markAlertFailed` parks exhausted rows as terminal `FAILED` (previously dead config — `maxRetries`/`retryDelayMs` were never read), unblocking a fresh alert on the next stock drop. **Discovered during testing:** `getAlertDetails` referenced non-existent table `product_variants` (real: `product_variant`) and non-existent column `pv.name` (real: `pv.description`) — the delivery job had never been exercised and would have failed on every attempt; both corrected. Suite: `tests/integration/inventory/low-stock-delivery.test.ts` (6 tests: dedup, partial-failure resume, lease reclaim, exhaustion, backoff deferral, no-recipients skip).

### GP-31 — CSP blocks Stripe and Cloudinary (High, verified by config inspection)
- **Evidence:** `next.config.ts` L41–54: `connect-src 'self' https://api.velora.example.com wss://api.velora.example.com`; `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net` (jsdelivr referenced nowhere in repo code); `img-src … https:` wildcard. Stripe Payment Element (`@stripe/stripe-js` 9) loads `js.stripe.com` (script-src) and contacts `api.stripe.com`/`m.stripe.network` (connect-src) — both blocked. Signed Cloudinary browser uploads POST `api.cloudinary.com/v1_1/...` from three client components — blocked. Placeholder domain `api.velora.example.com` dry-runs only.
- **Consequence:** card payments cannot run in production CSP-on; upload forms cannot run.
- **Fix:** add required hosts; drop jsdelivr + unsafe-eval; narrow img-src to self/data/res.cloudinary.com; multiple independent agents flagged; direct config re-read confirms.

---

## 4. Security and privacy findings summary

| ID | Finding | Severity | Confidence |
|---|---|---|---|
| GP-01 | `/api/validate` public DB mutation | Critical | verified |
| GP-31 | CSP breaks payments/uploads | High | verified (spec-level) |
| GP-15 | No rate limits on UGC/suggestions; validateImageFile dead; unlimited signed-upload issuance; review URL accepts externals | Medium | verified |
| GP-14 | Auth emails no durable path (availability, not confidentiality) | High availability | verified |
| GP-12 | Refund key collision (integrity) | High | verified |
| — | Clean areas: SQL injection (all parameterized; ordering whitelisted), XSS (only static theme + chart CSS use dangerouslySetInnerHTML), cookies (httpOnly/secure/sameSite across auth and guest), webhook HMAC+timing-safe+5-min tolerance, guard consistency (every admin action audited calls requireAdmin), no NEXT_PUBLIC secrets, env validation fail-closed | — | verified |
| — | Better Auth: deactivated accounts can still mint sessions (dead-letter); remembered cookie 30d vs DB TTL 7d mismatch (LOW) | Low | verified |
| — | `BETTER_AUTH_API_KEY` required-but-unused (LOW) | Low | verified |

---

## 5. Database and financial-integrity findings

Confirmed sound: inventory CHECKs (`quantity>=0, reserved>=0, reserved<=quantity`), unique `(provider, provider_event_id)` (`webhook_events`), unique `(user, idempotency_key)` orders, `payments.providerPaymentId` unique, `refund_items` unique `restockedMovementId` + 8 CHECKs, refund caps computed against PENDING reservations, Decimal minor-unit money everywhere in charging paths, single USD, UTC-safe promotion/coupon windows, transactional order histories.

Gaps ( Low-Medium, evidence-backed):
- No CHECK on `orders` totals or `payments.amount/currency` (`payments.amount/status` nullable; no DB check `subtotal+shipping+tax-discount=total`); all application-enforced under locks today. Suggested additive CHECKs where compatible (GP-26 conservatively avoids: propose only with explicit migration review).
- `commitOrderReservation` (`reserve-order-inventory.ts:326-394`) appears to be an **orphaned second commit path** (no callers found in orders/checkout flow — needs direct confirmation before deletion).
- Refund-cancel deadlock (GP-20) and equal-amount refund replay (GP-12) — state-machine gaps confirmed by code, not observed in prod.

---

## 6. Reliability, concurrency, and recovery

Structural strengths: every state changer takes `SELECT … FOR UPDATE` on the order row first; inventory locks always ordered by sorted variantIds; reservation flips are conditional (`WHERE status='PENDING'`) with `.returning()` guards; compensation reuses `cancelOrder`; Stripe calls deliberately outside inventory transactions.

Concerns (application-level only, verified code paths):
1. Nested-transaction leak suspicion: `cancelOrder`/`handlePaymentFailure`/`handleCheckoutExpiration` call `releaseOrderReservation` (which opens its own `db.transaction`) from inside their own transaction (order-lifecycle.ts L118/222/311). Currently safe due to idempotent status transitions and `FOR UPDATE` ordering, but a subtle concurrency test gap — recommend an integration test proof (Cross-reservation-deadlock path was flagged; could not be proved conclusively without running DB).
2. GP-17/30 lease-recovery gaps in webhook + low-stock processors (no crash-window self-healing).
3. GP-23b notification duplicate-send race.
4. `void dispatchOrderNotification` fire-and-forget in serverless server actions (`checkout.actions.ts:173` etc.) — send can be dropped mid-flight on freeze (LOW; DB row persists so retry worker eventually delivers: mitigation is real).
5. `processExpiredReservations` serial sleeps (5s/10s/20s per retry, up to batch 100) inside a single request; under failure storms the HTTP call can exceed function runtime (LOW-Medium; per-order idempotency means correctness holds, throughput suffers).

---

## 7. Performance and maintainability

Confirmed by code (no profiling run):
- GP-10 cart N+1 (5 queries/variant; 2× per validate); `searchProducts`/`listProducts` brand/category map hydration duplicated (queries.ts 442–477 vs search.ts 344–381).
- 28 `force-dynamic` pages (all admin, all account, cart, checkout, collections); ~~caching machinery largely unused (one `unstable_cache` call in `/api/banners` route)~~ **CORRECTED (T-4.2 verification, 2026-10): the audit line was stale** — every read in `services/catalog-public/*` (list/category/search/detail/related/home sections/banners) is already `unstable_cache`-wrapped with the full tag taxonomy + per-call `revalidate` windows, and the mutation→invalidation matrix (product/collection/promotion/brand/category mutations → every consuming tag) was verified complete and is regression-covered by `tests/integration/cache/cache-invalidation.test.ts`. Inventory-chip staleness remains correctness-guarded live by checkout (`TotalChangedError`, in-transaction revalidation). Remaining open item: no Next-runtime timing benchmark was run (dev-server OOM risk) — populate-side freshness is verified at code level only, pre-launch caveat per roadmap T-4.2.
- Client bundle: `recharts` (admin only, fine), `gsap+@gsap/react` SmoothScroll **in root layout** (loads on all routes for a luxury effect — cost unmeasured), dead deps `chart.js+react-chartjs-2`, `framer-motion` (used library is `motion`), `cn` package, `shadcn` CLI as runtime dep, dual PG drivers `pg`+`postgres`.
- `next/image` used in 15 files; 8 raw `<img>` remain (wishlist/collections/account/recently-viewed/uploads) despite `res.cloudinary.com` remotePatterns being configured — AGENTS.md §10 violation. **Resolved (T-4.3):** all 4 storefront surfaces converted to `next/image` (wishlist, collections index, collection detail, recently-viewed history rows); the remaining 4 are admin upload previews using blob/object-URL previews where `next/image` semantics don't apply — intentional, documented exception.
- `tsc` strict but no `noUncheckedIndexedAccess`; eslint defaults only. **Resolved (T-4.4):** `noUncheckedIndexedAccess: true` enabled (tests excluded via `tests/tsconfig.json` override); `eslint-plugin-drizzle``s `enforce-update-with-where`/`enforce-delete-with-where` wired (known FP pattern: `cookies()`/`Set`/`URLSearchParams` `.delete()` — inline-disabled with justifications); app/client import-boundary rule (`app/**/*.tsx` must not import `@/infrastructure/*`, route handlers exempt) — caught and fixed a real violation during rollout.
- Integration tests share a DB with teardown deletes; `VELORA_TEST_DATABASE_URL` hardcoded localhost fallback (no prod URL leak because `DATABASE_URL` isn't consulted — a deliberate safety).

---

## 8. Testing and production-readiness gaps

- **No CI at all** (no `.github/`, no config files): unit+lint+typecheck+integration+build should gate every push.
- **E2E never started:** 5 empty dirs, no Playwright/Cypress dep.
- `pnpm test` runs integration without DB and fails locally (no script split `test:unit` vs `test:integration`).
- Production build unverified (no BUILD_ID artifacts; `next dev` active during audit).
- docs/production-readiness.md is honest (production NO-GO with 5 operational blockers external to repo); docs/EXPIRED_RESERVATIONS_OPERATIONS.md has 2 concrete falsehoods (GP-18).
- Log sink is console-only (no transport); no error tracking, no health endpoint, no metrics exposure; job observability lives in rows only.

### GP-35 — No CI pipeline; e2e never started; `pnpm test` fails without a DB (High for delivery, verified)
- **Evidence:** no `.github/`, no CI config anywhere; `tests/e2e/` holds 5 `.gitkeep` dirs and no Playwright/Cypress dependency; `package.json` has no `test:unit`/`test:integration` split, so `pnpm test` runs the 40 integration files and fails without a live test DB.
- **Consequence:** none of tsc/lint/unit/integration/build gates any push; regressions ship silently.
- **Fix:** T-2.5.

### GP-36 — Bundle/dead-dependency debt (Medium, verified)
- **Evidence:** `chart.js` + `react-chartjs-2` installed with zero imports; `framer-motion` installed but unused (the library actually used is `motion`); `cn` package alongside `clsx` + `tailwind-merge`; `shadcn` CLI as a runtime dependency; `pg` + `postgres` dual drivers; `SmoothScroll` (gsap + Lenis) imported in root `app/layout.tsx` for every route; 8 raw `<img>` instances remain on storefront surfaces despite `res.cloudinary.com` remotePatterns being configured (AGENTS.md §10 violation).
- **Fix:** T-4.3.
- **Status:** `RESOLVED (T-4.3)` with one documented deviation (D18): `cn` v0.4 turned out to BE shadcn's official zero-dependency engine (its README replaces `clsx` + `tailwind-merge`), so the roadmap's "drop `cn`" was inverted — `clsx` and `tailwind-merge` were dropped instead and `shared/lib/utils.ts` re-exports `cn` from the package. Actually removed: `clsx`, `tailwind-merge`, `chart.js`, `react-chartjs-2`, `framer-motion` (all verified zero-import before removal); `shadcn` moved to devDependencies. Kept deliberately: `gsap`/`@gsap/react` (8 motion components), `motion` (ElasticButton), `lenis`; `pg`/`postgres` dual driver stays (postgres-js is the runtime driver, `pg` serves Drizzle Kit). SmoothScroll rewritten lenis-only (no gsap ticker, no dead ScrollTrigger registration) with a `prefers-reduced-motion` guard and lazy-loaded via `next/dynamic` in the root layout (no longer on the critical path of every route). Storefront raw `<img>` count reduced 8 → 4; the 4 remaining are admin upload previews (blob/preview semantics, documented — not storefront surfaces). Type check: 0 errors after `pnpm install` lockfile refresh.

### GP-37 — Observability absent (Medium, verified)
- **Evidence:** `shared/lib/logging/logger.ts` is console-only structured JSON ("In production, this would go to a proper logging service" — it does not); no error tracking (no Sentry/Datadog/OTel), no health endpoint, no metrics exposure; job observability is DB-rows-only.
- **Fix:** T-2.7, T-3.6.

---

## 9. Risk register (ordered by severity)

| ID | Title | Sev | Status in roadmap |
|---|---|---|---|
| GP-01 | Unauth DB harness `/api/validate` | Critical | Phase 0 |
| GP-04 | Add-to-cart funnel unwired | Critical | Phase 0 |
| GP-03 | Unstyled core controls | High | Phase 0 |
| GP-31 | CSP breaks Stripe/Cloudinary | High | Phase 0 |
| GP-02 | Fake home merchandising | High | Phase 1 |
| GP-27 | Admin catalog UI missing | High | Phase 2 |
| GP-25 | Customer admin + GDPR deletion missing | High | Phase 2 |
| GP-05 | UUID product slugs | High | Phase 1 (migration) |
| GP-29 | SEO surfaces missing | High | Phase 1 |
| GP-12 | Refund key collision | High | Phase 1 |
| GP-14 | Auth emails no queue | High | Phase 3 |
| GP-17 | Webhook PROCESSING stuck | Medium-High | Phase 1 |
| GP-16 | Reservation misses low-stock hook | Medium-High | Phase 1 |
| GP-23b | Notification duplicate-send race | Medium-High | Phase 3 |
| GP-30 | Low-stock lease/dedup gaps | Medium | Phase 3 |
| GP-10 | Cart N+1 | Medium | Phase 4 |
| GP-08 | Search relevance | Medium | Phase 4 |
| GP-06 | ILIKE escape bug | Medium | Phase 1 |
| GP-07 | listProducts sort | Medium | Phase 1 |
| GP-09 | Filter-link bugs + ProductCard triplication | Medium | Phase 4 |
| GP-11 | Nav dead links | Medium | Phase 0 (cheap) |
| GP-19 | Refund role semantics | Medium | Approval |
| GP-20 | Cancel-after-refund gap | Medium | Phase 1 |
| GP-21 | No tracking numbers | Medium | Approval → Phase 2/3 |
| GP-22 | Audit trail split-brain | Medium | Phase 2 |
| GP-23 | loading/error/not-found | Medium | Phase 3 |
| GP-24 | expectedTotalCents optional | Low-Med | Phase 1 |
| GP-15 | UGC rate limits + upload validation | Medium | Phase 3 |
| GP-18 | False runbook SQL | Low | Phase 2 (doc fix) |
| GP-26 | Migration 0016 sweep risk | Medium | Phase 2 (gating) |
| GP-28 | sync-banners unscheduled | Low | Phase 2 |
| GP-13 | services/module drift; stripe stubs | Medium | Phase 4 (cleanup) |
| GP-36 (bundle/`deps`) | Dead deps, root-layout gsap, raw imgs | Medium | Phase 4 |
| GP-35 (CI) | No CI; e2e absent; script split | High (delivery) | Phase 2 |
| GP-37 (observability) | No sink/health/track | Medium | Phase 2/3 |

*(IDs GP-35 onward used for late-identified horizontal gaps; see Master Roadmap mapping table.)*

---

## 10. Concrete remediation recommendations

Ordered, minimal-change, existing-architecture-preserving. Full task detail lives in MASTER-ROADMAP; this section records only the architectural principle per item:

1. **Delete GP-01** outright (its own header says so).
2. **GP-04/GP-03/GP-31 are correctness fixes, not features** — fix with the smallest diff consistent with AGENTS.md reuse rules (Gallery/VAT component reusing `VariantSelector` + existing cart actions; token-based utilities; delta CSP).
3. **GP-27/GP-25** build admin UI atop already-wired actions; do not restructure actions or move them into `modules/` unless explicitly approved (GP-13).
4. **GP-05** is the only schema migration proposed in Phase 1; additive, nullable-then-backfill, unique-indexed; document slug-redirect contract at launch.
5. **GP-14/GP-17/GP-23b/GP-30** all reuse the proven lease/claim pattern already tested in `order_notifications` — extend, don't invent.
6. **GP-35 CI**: single-suite gate with unit+typecheck+lint+build; integration job optional behind a test-DB service.

---

## 11. Decisions requiring product-owner approval

| Decision | Related IDs | Options |
|---|---|---|
| Can STAFF execute refunds? | GP-19 | require ADMIN role vs keep STAFF with docs update |
| Refunds of equal amount re-keying (needs Stripe idempotency semantic decision) | GP-12 | nonce-per-attempt vs per-staged-row key |
| Introduce carrier tracking fields now or defer post-launch | GP-21 | schema + UI + display vs defer |
| Account deletion/anonymization policy (what is retained: order/financial snapshots lawfully retained) | GP-25 | full delete vs anonymize PII |
| Tax jurisdiction activation | (checkout tax engine is $0 by design, feature-flagged) | legal/finance sign-off per region |
| Sleep-retry pacing for expired-reservations job vs longer-wait loop | GP-05-cron env (unconfirmed runtime constraint) | keep default vs configurable + monitor |
| Whether "modules/catalog" should be populated (moving services) vs current `services/*` shape documented as exception | GP-13 | strict AGENTS.md compliance trade-off |
| Home merchandising data source (which section types) | GP-02 | DB-backed sections vs curated static curated intentional |

---

## 12. Unverified areas and recommended further investigation

|Unknown| How to verify |
|---|---|
| Production build cleanly (Next 16 + authInterrupts + experimental config) | `pnpm build` with dev server off |
| CSP confirmed breakage at runtime (spec-level today) | staging deploy, observe Stripe.js loader + upload console violations |
| Nested `db.transaction` (release-in-cancel) deadlock possibility | targeted integration test: cancel concurrently with adjustStock on same variant |
| `commitOrderReservation` callers | exhaustive ts-rewrite import graph (ts-prune-style) |
| Real DB schema vs declared schema drift (status, next_retry_at index claimed but absent in schema/DB) | `drizzle-kit push --dry-run` / inspect live DB |
| Cart convergence for logged-in-but-idle users' guest carts | manual QA + test seed |
| Analytics of ILIKE/tree CTE at scale | seed 10k products + EXPLAIN |
| Live Vercel cron bearer injection | staging deploy logs |
| Raw `<img>`/SmoothScroll LCP impact | Lighthouse run on homepage |
| `void dispatchOrderNotification` real-world survival on Vercel | staging order with SMTP delay injected |

---

*Document produced read-only; no application code, schema, dependency, or test files modified. Companion: FEATURE-INVENTORY.md (feature status), MASTER-ROADMAP.md (tasks T-0.1…).*

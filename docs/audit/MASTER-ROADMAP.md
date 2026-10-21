# VELORA — Master Roadmap

> Findings referenced as `GP-xx` from [`ARCHITECTURE-GAPS.md`](./ARCHITECTURE-GAPS.md); feature status from [`FEATURE-INVENTORY.md`](./FEATURE-INVENTORY.md).
> Every task is justified by a named finding. Phases are dependency-ordered. No deadlines, staffing, or invented requirements; relative effort (S/M/L, days-scale assumptions stated inline where used) is labeled.

---

## 1. Executive summary

VELORA's financial spine (checkout, orders, refunds, inventory defensibility, analytics) is strong: idempotent, lock-disciplined, Decimal-exact, and meaningfully tested (160 unit tests green, 40 integration files, libs verified by value — `tsc` and `eslint` clean at audit time). The storefront's ability to actually sell, and the operations team's ability to catalog and support customers, are the gaps. Phase 0 is five small fixes that restore the core loop (delete a leaky route, wire add-to-cart, unbreak styling and CSP). Phase 1 closes financial/display correctness bugs; Phase 2 completes operations tooling; Phase 3 hardens notifications and covers the missing UX-state boundaries; Phase 4 tunes performance and cleanup; Phase 5 is optional product enhancement.

The single most impactful first task: **T-0.2 — delete `app/api/validate/route.ts`.** It removes the repository's only public, unauthenticated database-mutating surface in a one-file diff. It should precede everything else because it is the only Critical-severity *security* control gap, it requires no design decisions, and every other task assumes a deploy posture where this endpoint doesn't exist.

---

## 2. Current readiness assessment

| Dimension | Status | Evidence summary | Blockers |
|---|---|---|---|
| Core shopping workflow | **Not Ready** | Cart+checkout excellent (A8/A9 Implemented), but PDP add-to-cart dead (GP-04), unstyled controls (GP-03) | T-0.1, T-0.3 |
| Order & payment correctness | **Ready with Risks** | Idempotency + locks + webhook sig verified; refund key collision (GP-12), refund stuck-PROCESSING (GP-17) | T-1.3, T-1.4 |
| Inventory integrity | **Ready** | FOR UPDATE + CHECKs + deterministic ordering + concurrency tests | none critical; GP-16 hardening in Phase 1 |
| Authentication & access control | **Ready with Risks** | Triple-layer admin guard verified; auth-email durability (GP-14), no GDPR deletion (GP-25) | T-0.2, T-2.4, T-3.3 |
| Customer experience | **Not Ready** | wiring solid for account pages, but GP-03 styling, GP-23 no error/loading/notFound, tracking absent | Phase 0 + 3 |
| Administration & fulfillment | **Not Ready** | Order/refund/returns admin genuinely strong; catalog/customer/placeholders missing (GP-27/GP-25) | T-2.1, T-2.2 |
| Notification reliability | **Ready with Risks** | queue+lease tested for order emails; GP-14/GP-23b/GP-30 gaps | T-3.3, T-3.4, T-3.5 |
| Database integrity | **Ready** | 30 safe migrations (except GP-26 gating), constraints verified | T-2.6 |
| Performance | **Unverified (code-level only)** | N+1 and force-dynamic confirmed by inspection; no profiling | T-4.x after launch data |
| Automated verification | **Not Ready** | no CI, no e2e, `pnpm test` fails without DB | T-2.5 |
| Production operations & observability | **Not Ready** | docs/production-readiness.md says NO-GO; audit finds no logging sink/health/error tracking | T-2.7, T-3.6 |

**Overall: NOT production-ready.** Phase 0 + Phase 1 are the minimum gate; admin tooling and CI are the minimum gate for operating the catalogue.

---

## 3. Top priorities and why

1. **T-0.2 Delete `/api/validate`** — the only public write surface; no design trade-offs.
2. **T-0.1 Wire PDP add-to-cart** — without it, the storefront cannot sell outside wishlist.
3. **T-0.4 Restore form/button styling** — the UI is present but visually broken; one token-layer fix unblocks all pages.
4. **T-0.3 Fix CSP** — blocks payment + uploads in prod; a five-line config change.
5. **T-1.3 Refund idempotency-key correctness** — highest integrity risk (silent no-money refund reporting).
6. **T-1.4 Webhook PROCESSING lease/recovery** — prevents paid orders stuck in customer-facing limbo.

---

## 4. Phased roadmap

### Phase 0 — Critical correctness and security (Milestone: "Sellable core")

| Task | Title | Finding(s) | Scope | Dependencies | Acceptance criteria | Tests |
|---|---|---|---|---|---|---|
| **T-0.1** | [ ] Wire PDP add-to-cart (client gallery+ATC component) | GP-04 | `products/[slug]/page.tsx`, new client component, reuse `addToCart` action + `VariantSelector` | none | Add-to-Cart adds the selected variant to the active cart (user or guest); thumbnails swap primary image; dead tabs removed or properly labeled as placeholders | Integration: `addToCart(variantId)` E2E-ish test via server action; component test that the button dispatches |
| **T-0.2** | [ ] Delete `app/api/validate/route.ts` | GP-01 | 1 file | none | Route 404s; no source references | `routes.test.ts` update asserting route absent |
| **T-0.3** | [ ] Fix CSP for Stripe + Cloudinary | GP-31 | `next.config.ts` (5-line) | none | STG deploy: Stripe Payment Element loads (`js.stripe.com` in script-src; `api.stripe.com`,`m.stripe.network`,`api.cloudinary.com` in connect-src); remove jsdelivr + `unsafe-eval`; narrow img-src | CSP header snapshot test or doc'd manual step + staging smoke |
| **T-0.4** | [ ] Define/utilize `.btn/.input/.select/.checkbox` design-system utilities or port to shadcn primitives | GP-03 | `app/globals.css` (or component ports) for products, search, PDP, filter controls | none | Buttons/inputs/selects on /products, /search, PDP render styled per design tokens; components no longer rely on undefined classes | Unit/component snapshot of filter bar; manual visual checklist |
| **T-0.5** | [ ] Fix navbar links (`/shop`,`/about`,`/contact`) + ADMIN_LINKS sync | GP-11 | `shared/constants/index.ts`, `Navbar.tsx` | none | Nav links resolve; admin nav lists actual sections | trivial component assertion |

Order within Phase 0: T-0.2 → T-0.1 → T-0.4 → T-0.3 → T-0.5 (all independent; T-0.1 largest).

### Phase 1 — Commerce and financial reliability

| Task | Title | Finding(s) | Scope | Notes |
|---|---|---|---|---|
| **T-1.1** | [ ] Replace home-page fake sections with catalog-backed queries | GP-02 | `app/(storefront)/page.tsx`, `shared/components/home/*` (reuse `/collections/[slug]` batched pattern for ProductCard grid) | Products/BestSellers/NewArrivals/FeaturedCategories query DB with batched promo/wishlist; `shared/constants` keeps only nav labels |
| **T-1.2** | [ ] Fix catalog query correctness (deterministic sort, ILIKE escape, category→q mangling, param-preserving filter links) | GP-06, GP-07, GP-09, GP-09a, GP-09b | `catalog-public/search.ts`, `queries.ts`, both listing pages, shared `ProductCard` | Deduplicate ProductCard/formatPrice into a shared module; single-escape `%`, `_`, `\` in `escapeILike`; assert pagination delta with a `%`-bearing query regression test |
| **T-1.3** | [ ] Refund idempotency key correction | GP-12 | `modules/payments/application/commands/request-refund.ts` L290 | Include per-attempt nonce or staged-row id; reg test must prove second equal-amount refund actually charges Stripe; keep retry-safe convergence for ambiguous errors. **Stripe idempotency semantic decision flagged in §6.** |
| **T-1.4** | [ ] Webhook event lease/timeout + diagnostics | GP-17 | `app/api/webhooks/stripe/route.ts`, `app/api/internal/jobs/*` optional new recovery in cron | Borrow `order_notifications.claimDueRow` lease pattern; stale PROCESSING (>15 min) flips to FAILED for retry; add ops SQL doc |
| **T-1.5** | [ ] Add `commitOrderReservation` usage decision (call from finalize OR delete) | GP-24, orphan commit path | `reserve-order-inventory.ts`, `finalize-payment.ts` | Resolve duplicate commit possibilities; verify SINGLE path |
| **T-1.6** | [ ] Pin `expectedTotalCents` at action boundary | GP-24 | `checkout.actions.ts`, `create-order.ts` (zod required unless internal) | regression: direct action call without total only allowed by documented internal caller |
| **T-1.7** | [ ] Cancellation after refund (state machine edge) | GP-20 | `order-transitions.ts`, `order-lifecycle.ts` | Add explicit `cancelled_after_refund` transition (ledger-only, no inventory); test |
| **T-1.8** | [ ] Checkout-path low-stock alert hook | GP-16 | `reserveOrderInventory`, `commitOrderReservation`, release path | Call alert-check within same tx/lock as inventory mutation; test that auto-drain produces alert |
| **T-1.9** | [ ] Product slugs (additive migration + everywhere-serving pattern) | GP-05 | schema migration, catalog-public services, admin product form (T-2.1 later consumes) | `products.slug` unique non-null; backfill; 301 contract documented; URLs become `/products/<slug>` with id still resolvable |
| **T-1.10** | [ ] SEO baseline: sitemap + robots + canonical + JSON-LD | GP-29 | `app/sitemap.ts`, `app/robots.ts`, metadataBase, PDP JSON-LD, metadata audit | Crawler-visible products at launch, `/admin`+`/api` disallowed, Product/organization JSON-LD validated |

Order: T-1.1 first, then T-1.2/T-1.3 (expiry), T-1.4, state-machine fixups (T-1.5–1.8), then T-1.9/T-1.10 (SEO chain depends on slugs).

### Phase 2 — Operational completeness

| Task | Title | Finding(s) | Notes |
|---|---|---|---|
| **T-2.1** | [ ] Build Product/Brand/Category admin UI onto existing wired actions | GP-27, GP-13 | `app/admin/products/brands/categories` pages driving `shared/lib/actions/*` (no new actions); reuses productSchema zod centrally; variants list inherits from `VariantSelector` patterns; Wire ADMIN_LINKS |
| **T-2.2** | [ ] Inventory admin panel | GP-27 | `app/admin/inventory` driving `services/inventory.service.ts` (adjust/set with forced audit reason); surfaces alerts |
| **T-2.3** | [ ] Customer admin: list/detail/disable + toggles for status/role | GP-25 | New actions (require admin role) to set `user.status`/`role` (currently un-settable); account list with search; status change audit |
| **T-2.4** | [ ] GDPR: account deletion (or anonymize) flow + policy doc | GP-25 | **Product decision required** (see §6); minimal: request-based admin action; snapshots retained per policy |
| **T-2.5** | [ ] CI pipeline + script split (`test`, `test:unit`, `test:integration`) + e2e framework decision | GP-35 (see GAP doc §8) | GitHub Actions: typecheck, lint, unit, build; integration job requires a test-DB service (documented); build blockers discovered in Phase 0–1 are recorded here |
| **T-2.6** | [ ] Migration-safety guard: abort `validate-migrations` on non-empty DB unless override flag; gate GP-26 orphan sweep behind separate reviewed migration | GP-26 | scripts/validate-migrations.ts; new targeted migration reviewed for prod-run safety |
| **T-2.7** | [ ] Health endpoint + deploy checklist audit | GP-18, GP-37 | `app/api/health` route (DB ping + env presence) + fix false claims in EXPIRED_RESERVATIONS_OPERATIONS.md (nonexistent SQL, missing health endpoint documented) + `sync-banners` cron entry decision (GP-28) |
| **T-2.8** | [ ] Audit-trail durability: actor columns on `inventory_movement` + review moderation | GP-22 | additive migrations; order ledger already exemplary; align with console-only logger (see §6 decision) |
| **T-2.9** | [ ] Error/upload validation hardening | GP-15 | enforce `validateImageFile` on review/mass-image inputs; per-user submission rate limits (reuse Better Auth rate-limit table); restrict review image URLs to Cloudinary publicIds |

### Phase 3 — Customer experience & notifications

| Task | Title | Finding(s) | Notes |
|---|---|---|---|
| **T-3.1** | [ ] `loading.tsx` / `error.tsx` / root `not-found.tsx` | GP-23 | root + admin + (auth) + storefront hierarchical boundaries; skeleton loading matching design tokens |
| **T-3.2** | [ ] Unified empty states + cancelled-after-refund admin UI | bundling GP-20 UI, GP-11 admin nav partially already; remaining: no `analytics`/`customers` empty state confusion once T-2.x lands | Set design-system-level empty-state component |
| **T-3.3** | [ ] Auth-email durable queue (verification/reset) | GP-14 | Reuse order-notification pattern in new `auth_emails` table or extend `order_notifications` schema with a scope field; claim+lease+retry identical (already-tested pattern) |
| **T-3.4** | [ ] Notification dispatch lease (SENDING before send) | GP-23b | Extend synchronous dispatch with SENDING+lease (claimDueRow handles expiry already tested) |
| **T-3.5** | [ ] Low-stock alert lease recovery + per-recipient dedup / chunked send | GP-30 | apply lease pattern; fix Promise.all dupEmail issue |
| **T-3.6** | [ ] Decide external log sink / error tracker (Sentry or self-hosted equivalent) + dashboard for stuck events | GP-37 | product/ops decision required on approach; document final state in runbooks |
| **T-3.7** | [ ] Order tracking (carrier + tracking number fields + customer display) **OR** explicitly remove shipOrder docstring claim + defer | GP-21 | App decision (see §6); if proceed: additive schema, admin ship form input, account order detail display |

### Phase 4 — Performance & cleanup (post-launch observed / scaling)

| Task | Title | Finding(s) | Notes |
|---|---|---|---|
| **T-4.1** | [ ] Batch cart item resolution | GP-10 | new batched resolver by variantId set; measure before/after queries count in validate-cart integration test |
| **T-4.2** | [ ] Cache strategy rationalization: either populate `unstable_cache` for catalog-public reads or reduce invalidation surface | cache-tag machinery unused (see GAP doc §7) | per AGENTS.md §9; measure benefit first; do not cache checkout/payment paths |
| **T-4.3** | [ ] Dead dependency + bundle cleanup: chart.js, react-chartjs-2, framer-motion, `cn`, `shadcn` as runtime dep; move `SmoothScroll`/gsap out of root layout or lazy-load; convert remaining raw `<img>` | GP-36 | drop + document each; verify LCP budget on home |
| **T-4.4** | [ ] TS strictness upgrades (`noUncheckedIndexedAccess`) + eslint hardening (import rules, drizzle plugin) | tooling hygiene (GAP doc §9; no product behavior change) | config-only; run typecheck; fix fallout |
| **T-4.5** | [ ] Scale validation: seed 10k products; EXPLAIN tree CTE + ILIKE; add trigram/FTS indexes per measured need | GP-08 | data-driven: no indexes until EXPLAIN shows need |

### Phase 5 — Optional product enhancements (proposed, not evidence-mandated)

| Task | Title | Notes |
|---|---|---|
| **T-5.1** | [ ] Cart abandonment recovery email | no current table/route; product decision (yes, doc'd absence E8) |
| **T-5.2** | [ ] Invoice/PDF attachments on order confirmation | currently ZERO invoice pipeline; pairs with payment provider choice |
| **T-5.3** | [ ] Storefront search facets with live counts | classic merch capability, no current implementation; only if merchandising KPI demands |
| **T-5.4** | [ ] Admin review replacement flow (edit + re-moderate vs terminal rejected) | current is terminal; product decision |
| **T-5.5** | [ ] Multi-currency | charging stack is USD-pinned deliberately (`CHECKOUT_CURRENCY`); would be a major feature, not a fix |

---

## 5. Milestones & completion gates

| Milestone | Gate |
|---|---|
| **M0 — Privacy + sellability** (end of Phase 0) | No public write route; add-to-cart works; /products & /search & PDP styled; CSP smoke-tested on staging deploy |
| **M1 — Commerce integrity** (end of Phase 1) | Refund concurrency + re-key fixed w/ tests; webhook lease tested; deterministic listing; migrations for slug+indexes replayed against staging DB; SEO baseline deployed |
| **M2 — Operable business** (end of Phase 2) | Admin can create product/brand/category, adjust stock, disable a user, see order history; CI green gate on all pushes; health endpoint live |
| **M3 — Custodian-grade reliability** (end of Phase 3) | Auth emails on durable queue; duplicate-send race closed; loading/error/not-found boundaries shipped; log-sink decision made + applied |
| **M4/5 — Scale & polish** | Profiling-informed; bundle cleaned; optional features by product owner demand only |

---

## 6. Database, deployment, and rollback considerations

- **Schema changes this roadmap requires:** `products.slug` (T-1.9, additive), actor columns (T-2.8, additive), optional `carrier/tracking_number` (T-3.7), optional `auth_emails` (T-3.3). All additive; no column drops; no NOT NULL without default; every migration must follow the existing model (0006 pattern: documented lossless rewrite; 0016 pattern **rejected** for future direct use without data-cleanup review per AGENTS.md §5).
- **Cache:** all cache-tag additions center on `shared/lib/cache/tags.ts` (AGENTS.md §9). No caching of checkout/payment/stock correctness paths.
- **Stripe:** all changes stay inside the documented build order and retain the guard tests that verify raw-body signature flow and amount/currency check before dedup processing.
- **Rollback stance:** each Phase-1 migration ships with a documented down path in its header per the 0006 precedent; consecutive products slug migration and rollback must be verified against a **staging copy before prod**.
- **Deployment gates:** Dev server off during `next build` (T-2.5 runs it in CI); CSP (T-0.3) validated on staging deploy with violation logging before prod enforcement.

---

## 7. Deferred, decision-gated, and explicit out-of-scope

**Decisions required before task starts (product owner):**
- Refund role semantics STAFF vs ADMIN (GP-19) — gates T-3.7-adjacent clarification only (no task pre-written; document if unchanged).
- Tracking number: build vs defer (T-3.7).
- GDPR deletion method (T-2.4).
- Invoice/PDF (T-5.2), cart-abandonment (T-5.1), faceted search (T-5.3).
- Log sink choice (T-3.6).
- Admin module-shape move vs documentation exception (GP-13).
- Tax jurisdiction activation (checkout engine currently $0 by design; gated on legal/finance).

**Explicitly out of scope (per AGENTS.md scope control):**
- Multi-tenant operations; new payment providers; new hosting/infrastructure services not already in repo; marketplace/3P-seller model; native mobile apps; SSO/LDAP; any change to AGENTS.md conventions it currently forbids.
- Any proposed task adding a feature without a named finding in ARCHITECTURE-GAPS.md was deliberately excluded.

---

## 8. Recommended next task

**T-0.2 — Delete `app/api/validate/route.ts`.**

Reasons (each verifiable in ARCHITECTURE-GAPS.md §3 GP-01):
1. **Only Critical-severity security control gap** in the platform — a public, unauthenticated database write/delete endpoint whose own header says DELETE THIS FILE after validation; it has no mitigations and no design ambiguity.
2. **Smallest blast radius on the roadmap** — one-file removal, one test update, zero coupling.
3. **Unblocks safe deployment for everything else** — every other Phase 0 task assumes a staged deployment posture where this endpoint is unreachable.
4. AGENTS.md compliance: no unrequested scope created (deletion is the documented intent of the artifact) and no business rule invented.

Once T-0.2 lands, proceed to **T-0.1** (add-to-cart), which is the user-visible core-funnel restoration, and then T-0.4/T-0.3 styling+CSP to complete the sellable-core milestone.

---

## 9. Cross-reference consistency map

| Finding ID | Task ID(s) |
|---|---|
| GP-01 | T-0.2 |
| GP-02 | T-1.1 |
| GP-03 | T-0.4 |
| GP-04 | T-0.1 |
| GP-05 | T-1.9 |
| GP-06/07/09/09a/09b | T-1.2 |
| GP-08 | T-4.5 |
| GP-10 | T-4.1 |
| GP-11 | T-0.5 |
| GP-12 | T-1.3 |
| GP-13 | T-2.1 (document decision in §6) |
| GP-14 | T-3.3 |
| GP-15 | T-2.9 |
| GP-16 | T-1.8 |
| GP-17 | T-1.4 |
| GP-18 | T-2.7 |
| GP-19 | approval (§7) |
| GP-20 | T-1.7 |
| GP-21 | T-3.7 |
| GP-22 | T-2.8 |
| GP-23 | T-3.1 |
| GP-23b | T-3.4 |
| GP-24 | T-1.6 |
| GP-25 | T-2.3, T-2.4 |
| GP-26 | T-2.6 |
| GP-27 | T-2.1, T-2.2 |
| GP-28 | T-2.7 |
| GP-29 | T-1.10 |
| GP-30 | T-3.5 |
| GP-31 | T-0.3 |
| GP-35 (CI) | T-2.5 |
| GP-36 (bundle) | T-4.3 |
| GP-37 (observability) | T-2.7, T-3.6 |

Every roadmap task trace to either (a) a named finding above, (b) an AGENTS.md mandate (e.g., T-2.5 CI gating supports §12 Definition of Done), or (c) explicit §7 product decision. No task exists without one of these justifications.

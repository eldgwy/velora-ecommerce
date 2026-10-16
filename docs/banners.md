# VELORA — Hero Banners & Merchandising Slides

Staff-managed homepage carousel: title, subtitle, desktop/mobile images,
destination link, display order, schedule window, and lifecycle status.

## Data model

`banners`: title (NOT NULL, 1–120), subtitle (≤300), `image` desktop
(NOT NULL, HTTPS URL), `mobile_image` (nullable, falls back to desktop),
`link` (site path or HTTPS, validated), `sort_order` (≥0), `starts_at` /
`ends_at` (ordered when both set; NULL bounds open), `status`
(ACTIVE/EXPIRED/SCHEDULED/DRAFT, default ACTIVE at the column — creations
go through the command default DRAFT), timestamps. Migration `0029`
(forward-only, idempotent, applied, journaled `idx: 29`; empty table at
authorship, zero violations).

## Lifecycle and scheduling

- DRAFT: never public. SCHEDULED: future. ACTIVE: publishable in-window.
  EXPIRED: never public.
- Admin transitions form an explicit matrix (DRAFT→SCHEDULED/ACTIVE,
  SCHEDULED→ACTIVE/DRAFT/EXPIRED, ACTIVE→EXPIRED/DRAFT,
  EXPIRED→DRAFT/SCHEDULED; replays allowed). Editing never publishes
  implicitly — leaving DRAFT requires the status field to say so.
- Sync job (`modules/jobs/sync-banner-statuses`, internal route
  `/api/internal/jobs/sync-banners` behind the CRON_SECRET bearer):
  SCHEDULED→ACTIVE on window open, SCHEDULED/ACTIVE→EXPIRED on close, one
  clock per run, conditional writes, tag invalidation. Never touches DRAFT
  and never publishes from EXPIRED.
- **The sync is hygiene only.** Public eligibility re-checks status +
  inclusive window live on every computation, so starts/expirations hold
  even if the job never runs.

## Administration (`/admin/banners`)

`requireAdmin` on every read/mutation. List (search, status filter,
pagination, schedule + order columns), create/edit form with signed
Cloudinary uploads (JPEG/PNG/WebP ≤10 MB, folder `velora/banners/{id}`),
two-step delete, publish/unpublish controls, up/down ordering with one
explicit atomic save (dense 0..n-1; partial/foreign/duplicate sets
rejected). UTC datetime handling matches the repo convention.

## Storefront carousel

`GET /api/banners` (public, cached 60 s + `banners:list` tag, s-maxage
60): ACTIVE + in-window + `sortOrder ASC, id ASC`, minimal fields; errors
resolve to an empty list so merchandising never breaks the homepage.
`HeroBanners` client carousel fetches on mount: manual prev/next +
labelled dots, arrow-key support, live-region announcements, no autoplay
(reduced-motion safe), mobile image below md (desktop fallback), broken
images hide artwork only, zero/error states render the existing static
`Hero` unchanged.

## Cache behavior

New tags `banners:list` + `banner:{id}`; every mutation invalidates.
Schedule boundaries hold via 60 s freshness + live window checks, never
via admin-triggered invalidation. Commands degrade gracefully outside
Server Actions (tests/jobs).

## Tests

- Unit: transitions, inclusive boundaries, derived status, field/link
  validation, action guards.
- Integration: lifecycle (draft default, explicit publish, validation,
  transition matrix, update-without-implicit-publish, delete),
  eligibility matrix (windows, boundaries, statuses, deterministic order),
  dense reorder + rejection + rollback integrity, sync job (open/close,
  draft/expired untouched, 401 without bearer), public route (order,
  mobile fallback, draft exclusion, empty list).
- Regression: full suite green (homepage, products, cart, checkout,
  orders, payments, cache suites included).

## Limitations

- No autoplay/video slides; single cover image per breakpoint.
- Starts default ACTIVE at the DB column but commands force DRAFT unless
  requested — direct SQL inserts bypass the default (documented).
- Sync cadence is operator-configured cron (endpoint provided, schedule
  not provisioned here); correctness does not depend on it.
- No per-slide click analytics; no audience targeting.

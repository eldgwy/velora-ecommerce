# VELORA — Product Reviews, Ratings & Moderation

Customer reviews with server-determined verified-buyer badges, a
PENDING-only moderation queue, and approved-only public aggregates.

## Lifecycle and status transitions

`reviews.status`: `pending` → `approved` | `pending` → `rejected`
(same-state replays allowed). New rows default to `pending` at both the
database and application levels. Rejected reviews stay excluded from public
display permanently — no resubmission or appeal workflow in this scope.

Transition policy sits in two layers: the legacy `moderateReview` service
permits any non-self transition (its re-evaluation tests are preserved
unchanged); the admin queue path additionally requires a `pending` source,
enforced in `moderateReviewAction` before delegating, so stale or repeated
moderations resolve to a clear "already moderated" result instead of
overwriting. All changes run through a conditional `UPDATE ... WHERE
status <> target`, so concurrent moderations serialize safely.

## Submission eligibility and duplicates

- Authenticated customers only; the author id comes from the session —
  a client-supplied user id is never accepted.
- Product must exist and be ACTIVE.
- Rating integer 1–5 (DB CHECK backstop), title ≤120, content ≤5000,
  ≤4 images (HTTPS Cloudinary URL + provider id each).
- One review per customer per product, enforced by the unique
  `(user_id, product_id)` constraint; concurrent duplicates converge on it
  and surface as "already reviewed" (no raw constraint text leaks).
- Failed validation never writes; unexpected errors log server-side and
  return a generic message.

## Verified-buyer determination

At submission, an `EXISTS` query checks for a `DELIVERED` order owned by the
author whose items (via variant → product) include the reviewed product.
One row max, no count inflation; cancelled/failed/paid-only orders never
qualify. The flag is stored (`is_verified_buyer`) and the public badge
renders only for APPROVED + verified rows. Verified status is not required
to review.

## Public visibility and aggregation

`getProductReviews` (list), `getRatingSummary` (SQL AVG/COUNT + per-star
GROUP BY), `listApprovedReviews` (paginated, batched images), and the
rating sort all filter `status = approved` in the data-access layer —
pending/rejected rows cannot leak through any public surface. The detail
page section shows summary, distribution, approved list with badges, an
empty state, and the submission form (`?reviewsPage=` pagination).

## Administrative permissions

`requireAdmin` (ADMIN/STAFF) guards the queue reads and every moderation
mutation; unauthorized calls reject before touching data. The queue shows
product, author name (no emails/addresses), rating, text, eligibility,
image counts, and dates with status/rating pagination. Moderation records
via the existing `reviewModerated` audit log (review, product, previous →
new status, actor, timestamp).

## Images

Customer flow reuses the Cloudinary infrastructure: server-signed params
scoped to `velora/reviews/{userId}`, direct browser upload, then submission
references `{url, publicId}`. Server validates type/size-equivalent rules
(HTTPS URL, ≤4 files) and review ownership governs the rows (cascade delete
with the review). No binaries in Postgres. Product-image admin flows are
untouched.

## Migration details

`0024_review_integrity_and_verified_buyer` (forward-only, idempotent,
applied, journaled `idx: 24`): `is_verified_buyer` NOT NULL DEFAULT false,
`status` DEFAULT 'pending', CHECKs for rating 1–5 and text lengths. Legacy
audit on empty tables: zero violations, all constraints validated
immediately. No data rewritten.

## Cache invalidation

Submission and effective moderation changes call `invalidateReviewCache`
(product reviews tag + product + listing). Submission form and queue
mutations refresh via `router.refresh()`. Display data rides the existing
300 s product-reviews cache. No new cache subsystem.

## Test coverage and limitations

- Unit: rating matrix, moderation matrix, text limits, action guards.
- Integration: submission (pending default, duplicates, concurrent
  duplicates, validation, eligibility, images, folder scoping),
  verified-buyer (delivered vs shipped vs foreign), queue (context,
  approve/reject, re-moderate + no-op replay — moderation is REVERSIBLE
  as of T-5.4: any non-self status transition incl. re-open from
  approved/rejected; submission text/rating remains immutable),
  storefront (approved only, aggregates, pagination, empty state).
- Preserved: existing moderation service/aggregate/action suites untouched
  and green.
- Limitations: no review editing/deletion by customers; no appeal flow;
  no email notifications on moderation; image alt text not collected;
  Cloudinary credentials are dev placeholders (upload path mock-tested
  only for params, not exercised end-to-end).

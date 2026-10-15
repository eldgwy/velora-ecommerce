# VELORA — Product Questions & Answers

Customer questions with staff answers on product detail pages, plus a
staff moderation queue and per-customer history.

## Domain model and schema decisions

One `product_questions` row per question; the staff answer is embedded
(`answer`, `answered_by`, `answered_at`) because the lifecycle is strictly
one-question-one-answer — a separate answers table would add joins without
benefit. Multiple questions per customer/product are allowed by design (no
uniqueness rule); double-submits are absorbed by a 10-minute exact-text
dedup that returns the existing row.

Lifecycle: `PENDING` → `ANSWERED` | `REJECTED`, plus `ANSWERED` →
`REJECTED` for withdrawal of visible content (this covers the HIDDEN need
with minimum states). `REJECTED` is terminal; same-state repeats replay
idempotently. Only `ANSWERED` rows carrying an answer are public —
unanswered questions stay hidden by policy. Withdrawn rows keep their
answer text for the audit trail but are excluded by the status filter.

Migration `0025_product_questions` (forward-only, idempotent, applied,
journaled `idx: 25`): `question_status` enum, table with FKs (product
cascade, user set null — matching review retention), length CHECKs
(question 3–2000, answer ≤5000), and an answer-consistency CHECK
(no answer on PENDING rows). New table: all constraints validated on
creation, no data rewritten.

## Question submission rules

Authenticated customers only; author id from the session (never the
client); product must exist and be ACTIVE; text trimmed 3–2000 chars.
Rows start `PENDING`, never public, never answered at creation. Zod at the
action boundary + domain asserts in the command + DB CHECKs at the backstop.
Unexpected errors log server-side and return a generic message.

## Answering and moderation lifecycle

Staff-only actions (`requireAdmin`): `answerQuestion` sets answer +
attribution atomically with the conditional `PENDING → ANSWERED` transition
(no answer edits in this scope — re-answers are rejected, withdrawal is the
recourse); `moderateQuestion` handles `PENDING → REJECTED` and `ANSWERED →
REJECTED` withdrawal; both are conditional on the source state so
concurrent moderations converge instead of clobbering, and repeats replay.
Events record via the `questionModerated` audit log (question, product,
previous → new status, actor, timestamp). Note: the legacy review
moderation service permits re-evaluation; the Q&A path deliberately does
not expose that — rejected Q&A stays excluded permanently.

## Public visibility policy

`listPublicQuestions` filters `status = ANSWERED AND answer IS NOT NULL`
in the data-access layer and selects no author data — pending/rejected
content cannot leak through any public query, aggregate, or sort, even if
cache invalidation lags. Customer history (`listCustomerQuestions`) is a
separate session-scoped query showing all own statuses with answers where
provided.

## Customer and staff authorization

Customers: session authorship, own-history scoping (cross-customer reads
structurally impossible — no foreign id enters the predicate). Staff:
ADMIN/STAFF server gating on every queue read and mutation; unauthorized
calls reject before touching data (PII limited to names in the queue).

## Cache invalidation behavior

Answer publication and withdrawal/rejection call the existing
`invalidateProductCache` (detail + listing tags); submission needs none
(non-public until answered). Queue and history pages are `force-dynamic`;
mutations `router.refresh()`. No new cache layer, no denormalized counters.

## Migration details

See `0025_product_questions.sql` (idempotent `DO` enum guard,
`IF NOT EXISTS` everywhere; reverse: drop table + type). Journal entry
`idx: 25` added. Live DB applied cleanly.

## Tests and known limitations

- Unit: text validation, lifecycle matrix, action guards (10 tests).
- Integration: submission (pending default, authorship, dedup, distinct
  multiples, validation, eligibility), moderation (answer publish,
  reject/withdraw, stale-transition safety, unauthorized, queue context +
  pagination), visibility (approved-only, withdrawal disappearance,
  pagination integrity, history scoping) — 13 tests.
- Preserved: existing review suites untouched and green; full suite green.
- Limitations: no customer edit/delete/appeal; no answer editing (withdraw
  instead); no moderation emails; no voting/attachments/messaging; admin
  nav link not added (follows reviews/coupons precedent — direct URL).

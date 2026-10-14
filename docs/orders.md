# VELORA — Order Lifecycle & Customer Order Experience (FR-09)

## Order-state model

States are the existing `order_status` enum — no parallel machines:

| Transition | Actor | Preconditions | DB changes | Inventory | Payment |
|---|---|---|---|---|---|
| none → `PENDING` | customer (checkout) | valid cart, reservation succeeds | order + items (`PENDING`) + addresses + history + payment (`PENDING`) + cart `CONVERTED` | reserved | `PENDING` |
| `PENDING` → `PROCESSING` | webhook only | verified `payment_intent.succeeded`, active reservation | history row, order `PAID`, items `COMMITTED`, stock decremented + `SALE` | committed | `COMPLETED` |
| `PENDING` → `CANCELLED` | customer/staff/admin/webhook/system | customer: `PENDING` + unpaid (BR-014); paid customer attempts rejected with refund-review escalation (refunds are admin-initiated via `requestRefund`, never automatic) | release + history + order `CANCELLED` | released | unchanged (paid preserved) or `CANCELLED`/`FAILED`/`EXPIRED` |
| `PROCESSING` → `SHIPPED` | staff/admin | — | history row | none (sold at finalize) | none |
| `SHIPPED` → `DELIVERED` | staff/admin | — | history row | none | none |
| any → same | any | replay | none (no duplicate audit rows) | none | none |

Anything outside this matrix throws `InvalidOrderTransitionError`. Clients can
never submit arbitrary statuses — actions expose only named operations.
Fulfillment (`SHIPPED`/`DELIVERED`) belongs to this phase per SRS FR-09.02 and
RBAC ("update order fulfillment stages"); carrier tracking/labels are future work.

## Customer permissions

Identity comes only from the verified Better Auth session. History lists and
details are scoped by `order.userId`; foreign ids return "not found" (no
ownership oracle, BR-008). Self-cancellation: `PENDING` + unpaid only; paid or
fulfilled orders get an escalation message instead of an unsupported refund
promise. Staff UI is convenience-only; `requireAdmin` + proxy enforce roles
server-side, and money never moves except through verified webhooks.

## Cancellation rules

- Customer: `PENDING` + payment `PENDING` → release via the reservation
  lifecycle (never twice — release is idempotent) → `CANCELLED`. Repeats succeed quietly.
- Paid: blocked, support escalation (refunds are admin-initiated through the
  verified `requestRefund` workflow — partials capped, webhook-reconciled —
  never automatic on cancellation).
- Staff: `PENDING`/`PROCESSING` with mandatory recorded reason; `PAID` payment
  state preserved.
- Races: cancel-after-finalize fails (`OrderAlreadyCompletedError` surfaced);
  finalize-after-cancel throws (`OrderAlreadyCancelledError`); expiry and
  payment race through the same status checks + inventory invariants.

## Payment and reservation interactions

Reservation (`RESERVED`) is created at checkout, committed (`SALE`) only by
verified payment finalization, released on failure/cancel/expiry. COD orders
carry `checkoutExpiresAt = NULL` so the expiry job (dated expiries only) never
touches them; release follows fulfillment/cancellation. Late verified payments
against cancelled/expired orders are rejected, never fulfilled without stock.

## Audit history

`order_status_histories` now records `previous_status`, `event_type`,
`actor_type` (`customer|staff|admin|webhook|system`), `actor_id`, and
`correlation_id` (idempotency key / webhook event / request id) alongside each
new state — written in the same transaction as the mutation. Webhook events
are distinguishable (`actor_type: webhook`); failures/expiry record their
trigger. Previously-missing rows were added: `PROCESSING` on finalization and
failure-path histories.

## Concurrency and locking

Every state-changing command takes the order row `FOR UPDATE` before
touching inventory, and inventory rows are always locked in sorted variant
order — a single global order (order row → inventory rows), so concurrent
transitions serialize without deadlock. Losers observe the winner's committed
state and fail loudly (`OrderAlreadyCancelledError`,
`InvalidOrderTransitionError`) or replay idempotently; they never silently
overwrite. Failure webhooks never flip `COMPLETED`/`REFUNDED` payments.

## Notification behavior

Claim-once emails (`order_notifications`, unique per order+type) for placed,
paid, failed, cancelled, expired, shipped, delivered. Dispatch runs
post-commit with SMTP outside every transaction; `SENT` is recorded only after
provider acceptance, failures stay `QUEUED` without failing the caller, and
retries/redeliveries lose the claim and skip. Templates live with the
dispatcher; no payment secrets or excess PII in metadata.

## Known gaps and follow-up work

- Refund workflow: IMPLEMENTED (admin-only `requestRefund`, partials with
  BR-007 cap, webhook reconciliation, `refund_issued` notices; see
  `docs/reliability.md`). Remaining: live Stripe keys, a return-merchandise
  flow (refunds never restock), partial-capture handling.
- No carrier/tracking integration for shipment; no delivery-proof capture.
- No `QUEUED`-notification retry sweep (failed sends wait for the next
  triggering redelivery).
- Environment lacks most FK constraints declared in migration 0000 (no
  cascades run here) — FK reconciliation migration recommended.
- Guest order history: impossible while guest checkout is unsupported.

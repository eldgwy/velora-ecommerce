# VELORA — Refunds, Returns & Restocking

A monetary refund and a physical product return are separate business events.
This document describes both lifecycles, how they (don't) interact, and how
eligible goods re-enter stock.

## Refund lifecycle (`refunds`: PENDING → COMPLETED | FAILED | CANCELLED)

Admin-only (`requireAdmin`: ADMIN/STAFF per FR-01.06; customers are rejected
before any validation or DB access). Command: `requestRefund`.

- **Eligibility.** Payment `status = COMPLETED`, Stripe card payment with a
  provider id. Reason mandatory. Amounts are integer minor units validated
  through the exact-decimal engine: zero/negative/non-integer rejected,
  unsupported payment currencies rejected, over-cap rejected.
- **Cap & concurrency.** TxA locks the payment row (`FOR UPDATE`) and
  computes `remaining = captured − COMPLETED − fresh PENDING`. Fresh
  in-flight reservations count against the cap, so concurrent different-amount
  requests cannot collectively exceed the captured amount at Stripe. An
  identical fresh PENDING row is followed (twin-follow) instead of
  duplicated. PENDING rows older than 15 minutes (`STALE_PENDING_MS`) are
  treated as abandoned crash residue: they free their reservation and no
  longer block an identical restage (same idempotency key).
- **Stripe idempotency.** Deterministic key `refund-{paymentId}-{amountCents}`
  per attempt, always outside any DB transaction or row lock. A retry of the
  same (payment, amount) replays the same provider refund object.
- **Ambiguous outcomes.** Timeouts, connection loss, rate limits, and
  provider 5xx keep the row PENDING and raise a retryable error — FAILED is
  terminal and would wrongly free a retry to move the same money twice. The
  retry adopts the same row under the same idempotency key; TxB converges
  (marks CANCELLED/superseded) if the twin or a webhook already recorded the
  money. Deterministic rejections (4xx) move PENDING → FAILED.
- **Status sync.** COMPLETED totals drive `orders.paymentStatus`
  (REFUNDED when total ≥ captured, else PARTIALLY_REFUNDED); full refunds
  additionally mirror `payments.status → REFUNDED` (conditional on
  COMPLETED). Partials keep the payment COMPLETED.
- **Reconciliation.** `charge.refunded` converges local COMPLETED rows toward
  provider `amount_refunded` (idempotent; over-reports logged, recorded as
  nothing). Duplicate/out-of-order events are safe via provider-id dedup and
  the same convergence checks.

**Investigating a stuck refund:** a PENDING row younger than 15 minutes with
a live caller is being worked; an older PENDING row means the stager died or
the outcome was ambiguous — check Stripe dashboard for a refund with metadata
`paymentId`, then either retry the same amount (converges) or wait for the
`charge.refunded` webhook (reconciles). Never mark COMPLETED by hand.

## Return lifecycle (migration `0021`)

Tables `return_cases` (OPEN → COMPLETED | CANCELLED) and `return_items`
(PENDING → RECEIVED → APPROVED → RESTOCKED; REJECTED/CANCELLED terminal).
Optional informational `refund_id` link — setting it never moves money, and
issuing a refund never opens a case.

- **Create.** Lines must belong to the order; requested (non-rejected,
  non-cancelled) quantities plus the new request can never exceed the
  purchased quantity (checked under per-line row locks, so concurrent cases
  cannot overshoot). Unknown refund links rejected.
- **Receive.** PENDING → RECEIVED, idempotent replay.
- **Inspect.** Per line: approve requires RESTOCKABLE condition;
  approve+DAMAGED is rejected outright; reject records the condition.
  Approval alone (no inspection) can never restock — `restockReturn`
  requires APPROVED **and** RESTOCKABLE.
- **Restock (`restockReturn`).** Additionally requires the order in
  PROCESSING/SHIPPED/DELIVERED (cancelled/expired orders already released
  their stock — restocking them would double-count). Atomically: conditional
  APPROVED → RESTOCKED claim (race losers converge onto the winner's
  movement), `inventory.quantity` += approved qty (reserved untouched —
  sold goods were already committed), one `RETURN` movement referencing
  order/case/item, low-stock recheck, `return_restocked` audit with the
  actor, case auto-completion when all lines are terminal.
- **Idempotency.** DB-enforced: UNIQUE on `restocked_movement_id` (NULLs
  distinct) + CHECK linking movement to RESTOCKED status, plus the
  application-level conditional claim under a row lock. Replays return the
  existing movement without touching stock.
- **Negative guarantees (tested).** Refunds never restock and never open
  cases; restocks never create refunds; damaged/rejected/unreceived lines
  never restock; failures roll back stock and ledger together (single
  transaction).

## Inventory movement semantics

`RETURN` is a positive on-hand adjustment for verified goods re-entering
saleable stock. It never touches `reservedQuantity` and never runs for
ordinary refunds, cancellations, failures, or webhook retries. Movement
`reason` carries `order/case/item` references; `notes` carries the actor.

## Migration & operations

- `0021_product_returns.sql`: two new tables, FKs (restrict on order/lines,
  cascade case→items, set-null refund link), indexes, CHECKs. No pre-existing
  rows (new tables) — all constraints validated on creation. Applied to the
  dev database; journal entry `idx: 21` added.
- Live Stripe keys remain a production prerequisite (refunds block without
  them — safe default). Live gateway behavior (real timeouts, dashboard
  reconciliation) has NOT been verified against actual credentials.
- Authorization: all return/refund mutations are ADMIN/STAFF server actions;
  UI visibility is convenience only.

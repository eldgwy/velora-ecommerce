/**
 * Payment state machine (domain layer — pure, no framework or DB imports).
 *
 * Canonical payment transitions for the `payment_status` enum. This is the
 * single source of truth for which payment moves are legal; command-level
 * guards in finalization, failure handling, refunds, and COD collection
 * enforce the order-level preconditions on top (order status, ownership,
 * provider) rather than duplicating the transition table.
 *
 * Normal lifecycle:
 * ```text
 * PENDING
 *   ├── COMPLETED
 *   └── FAILED
 *
 * COMPLETED
 *   └── REFUNDED
 *
 * FAILED
 *   └── Terminal
 *
 * REFUNDED
 *   └── Terminal
 * ```
 *
 * Notes:
 * - `AUTHORIZED` is a Stripe-side interim state; locally it behaves like
 *   PENDING (a payment that can still complete or fail).
 * - Payment retries do not transition the row: a FAILED payment starts a
 *   fresh attempt that moves it back through PENDING implicitly when a new
 *   intent is attached. The matrix governs terminal outcomes, not retries.
 * - COD collection (`PENDING → COMPLETED`) is an authorized manual
 *   operation, not a webhook event; the matrix does not distinguish actors.
 */

export type PaymentTransitionStatus =
  | "PENDING"
  | "AUTHORIZED"
  | "COMPLETED"
  | "FAILED"
  | "REFUNDED";

export interface PaymentTransitionRule {
  from: PaymentTransitionStatus;
  to: PaymentTransitionStatus;
}

const PAYMENT_TRANSITIONS: PaymentTransitionRule[] = [
  { from: "PENDING", to: "COMPLETED" },
  { from: "PENDING", to: "FAILED" },
  { from: "AUTHORIZED", to: "COMPLETED" },
  { from: "AUTHORIZED", to: "FAILED" },
  { from: "COMPLETED", to: "REFUNDED" },
];

/** True when `from → to` is a legal payment transition (same-state replays allowed). */
export function canTransitionPayment(
  from: PaymentTransitionStatus,
  to: PaymentTransitionStatus,
): boolean {
  if (from === to) return true;
  return PAYMENT_TRANSITIONS.some((r) => r.from === from && r.to === to);
}

/** Terminal states: no outbound transition exists. */
export function isTerminalPaymentStatus(status: PaymentTransitionStatus): boolean {
  return status === "FAILED" || status === "REFUNDED";
}

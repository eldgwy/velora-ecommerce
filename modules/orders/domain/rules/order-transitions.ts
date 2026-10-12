/**
 * Order lifecycle matrix (domain layer — pure, no framework or DB imports).
 *
 * States come from the existing `order_status` enum; this file is the single
 * authority on which transitions are legal and who may request them.
 * Enforcement lives in `modules/orders/application/commands/order-transitions.ts`;
 * the matrix itself stays side-effect free so it is trivially unit-testable.
 */

export type OrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

export type OrderActor = "customer" | "staff" | "admin" | "webhook" | "system";

export interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  /** Actors permitted to request this transition. */
  actors: OrderActor[];
  /** Short machine-readable reason used in audit events. */
  event: string;
}

/**
 * Every legal transition. Anything absent here is rejected with
 * `InvalidOrderTransitionError`. Notes:
 * - Creation (`none → PENDING`) happens in checkout, not here.
 * - `PENDING → PROCESSING` is webhook-only (verified payment finalization).
 * - Customer cancellation is `PENDING → CANCELLED` only (BR-014); staff may
 *   also cancel `PROCESSING` orders (existing `cancelOrder` semantics).
 * - Paid orders are never cancelled by customers (no refund workflow exists;
 *   see docs/orders.md) — the command layer enforces the payment check.
 * - `SHIPPED` / `DELIVERED` advance fulfillment; both are idempotent replays
 *   of the same state (handled by the command, not the matrix).
 */
export const ORDER_TRANSITIONS: TransitionRule[] = [
  { from: "PENDING", to: "PROCESSING", actors: ["webhook", "system"], event: "payment_succeeded" },
  { from: "PENDING", to: "CANCELLED", actors: ["customer", "staff", "admin", "webhook", "system"], event: "cancelled" },
  { from: "PENDING", to: "CANCELLED", actors: ["webhook", "system"], event: "payment_failed" },
  { from: "PENDING", to: "CANCELLED", actors: ["system"], event: "reservation_expired" },
  { from: "PROCESSING", to: "SHIPPED", actors: ["staff", "admin"], event: "shipped" },
  { from: "PROCESSING", to: "CANCELLED", actors: ["staff", "admin"], event: "cancelled" },
  { from: "PROCESSING", to: "CANCELLED", actors: ["webhook", "system"], event: "payment_failed" },
  { from: "SHIPPED", to: "DELIVERED", actors: ["staff", "admin"], event: "delivered" },
];

export function findTransition(
  from: OrderStatus,
  to: OrderStatus,
): TransitionRule | null {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/** True when `actor` may move an order from `from` to `to`. */
export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
): boolean {
  if (from === to) return true; // idempotent replay, decided by the command
  const rule = findTransition(from, to);
  return rule !== null && rule.actors.includes(actor);
}

/** Terminal states: no outbound transition exists. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === "DELIVERED" || status === "CANCELLED";
}

/**
 * Return lifecycle (domain layer — pure, no framework or DB imports).
 *
 * A return tracks physical goods, never money. It is independent of the
 * financial refund lifecycle; the two may reference each other but neither
 * drives the other.
 *
 * Case:    OPEN → COMPLETED | CANCELLED
 * Item:    PENDING → RECEIVED → APPROVED → RESTOCKED
 *                            ↘ REJECTED (terminal) · CANCELLED (terminal)
 *
 * Only APPROVED lines with a RESTOCKABLE inspection condition may restock.
 * DAMAGED lines must be rejected. Same-state repeats are idempotent replays.
 */

export type ReturnCaseStatus = "OPEN" | "COMPLETED" | "CANCELLED";

export type ReturnItemStatus =
  | "PENDING"
  | "RECEIVED"
  | "APPROVED"
  | "REJECTED"
  | "RESTOCKED"
  | "CANCELLED";

export type ReturnCondition = "RESTOCKABLE" | "DAMAGED";

const ITEM_TRANSITIONS: Array<{ from: ReturnItemStatus; to: ReturnItemStatus }> = [
  { from: "PENDING", to: "RECEIVED" },
  { from: "PENDING", to: "CANCELLED" },
  { from: "RECEIVED", to: "APPROVED" },
  { from: "RECEIVED", to: "REJECTED" },
  { from: "APPROVED", to: "RESTOCKED" },
];

/** True when `from → to` is a legal return-item move (replays allowed). */
export function canTransitionReturnItem(
  from: ReturnItemStatus,
  to: ReturnItemStatus,
): boolean {
  if (from === to) return true;
  return ITEM_TRANSITIONS.some((r) => r.from === from && r.to === to);
}

/** Terminal item states: rejected, restocked, or cancelled lines never move. */
export function isTerminalReturnItemStatus(status: ReturnItemStatus): boolean {
  return status === "REJECTED" || status === "RESTOCKED" || status === "CANCELLED";
}

/**
 * Whether a line in `status` with `condition` may be restocked.
 * Both halves are required: approval alone (without a recorded inspection)
 * and a restockable condition without approval are each insufficient.
 */
export function isRestockEligible(
  status: ReturnItemStatus,
  condition: ReturnCondition | null,
): boolean {
  return status === "APPROVED" && condition === "RESTOCKABLE";
}

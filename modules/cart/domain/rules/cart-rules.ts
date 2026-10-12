/**
 * Pure cart business rules (domain layer — no framework or DB imports).
 *
 * Quantity policy (no pre-existing per-item limits were found in the
 * codebase, so these are defined here and documented in docs/cart-lifecycle.md):
 * - Every cart-item quantity is an integer in [1, MAX_QUANTITY_PER_ITEM].
 * - A cart holds at most MAX_DISTINCT_ITEMS distinct variants.
 * - Quantity zero is never stored; it deletes the row (CHECK-enforced >= 1).
 */

export const MAX_QUANTITY_PER_ITEM = 99;
export const MAX_DISTINCT_ITEMS = 50;

/** A variant is purchasable only when both it and its product are ACTIVE. */
export function isPurchasable(
  variantStatus: string,
  productStatus: string,
): boolean {
  return variantStatus === "ACTIVE" && productStatus === "ACTIVE";
}

/** True for integers in the storable quantity range. */
export function isValidQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_QUANTITY_PER_ITEM
  );
}

/** FR-06.01 merge arithmetic: quantities combine by addition. */
export function mergeQuantities(
  authenticatedQuantity: number,
  guestQuantity: number,
): number {
  return authenticatedQuantity + guestQuantity;
}

/**
 * Conflict policy for merges/adds that exceed available stock: preserve the
 * valid portion (cap at available) and report the unavailable remainder so
 * the UI can show it instead of silently discarding it.
 */
export function capAtAvailable(
  requested: number,
  availableStock: number,
): { quantity: number; remainder: number } {
  const quantity = Math.max(0, Math.min(requested, availableStock));
  return { quantity, remainder: requested - quantity };
}

// ---------------------------------------------------------------------------
// Money helpers — integer cents so totals never drift on float arithmetic.
// ---------------------------------------------------------------------------

export function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function lineTotalCents(unitPrice: string | number, quantity: number): number {
  return toCents(unitPrice) * quantity;
}

export function subtotalCents(
  lines: Array<{ unitPrice: string | number; quantity: number }>,
): number {
  return lines.reduce(
    (sum, line) => sum + lineTotalCents(line.unitPrice, line.quantity),
    0,
  );
}

export type PromotionKind = "PERCENTAGE" | "FIXED";

/**
 * Apply one active promotion to a unit price (discount precedence BR-009:
 * promotions adjust the unit price before any coupon math, which lives in
 * checkout — not here).
 */
export function applyPromotionToUnitPrice(
  unitPriceCents: number,
  promotion: { type: PromotionKind; value: string | number },
): number {
  if (promotion.type === "PERCENTAGE") {
    const pct = Number(promotion.value);
    if (!Number.isFinite(pct) || pct <= 0) return unitPriceCents;
    return Math.max(0, Math.round(unitPriceCents * (1 - pct / 100)));
  }
  return Math.max(0, unitPriceCents - toCents(promotion.value));
}

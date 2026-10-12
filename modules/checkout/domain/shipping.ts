/**
 * Shipping catalog (domain layer — no framework or DB imports).
 *
 * Gap note: the repository has no shipping-methods table or carrier rules,
 * so methods are a closed, server-authoritative enum. Adding a method is a
 * code change, which keeps every charge calculation reviewable in one place.
 * Client-supplied shipping charges are never accepted; only the method id
 * crosses the boundary and the fee is computed here.
 */

export const SHIPPING_METHODS = {
  STANDARD: {
    label: "Standard delivery",
    baseFeeCents: 499,
    etaDays: "3–5 business days",
  },
  EXPRESS: {
    label: "Express delivery",
    baseFeeCents: 1299,
    etaDays: "1–2 business days",
  },
} as const;

export type ShippingMethodId = keyof typeof SHIPPING_METHODS;

/**
 * BR-018 minimum-order free shipping: a STANDARD shipment is free when the
 * discounted subtotal strictly exceeds the threshold. EXPRESS is never free.
 */
export const FREE_SHIPPING_THRESHOLD_CENTS = 7500;

export function isShippingMethod(value: unknown): value is ShippingMethodId {
  return (
    typeof value === "string" &&
    (value === "STANDARD" || value === "EXPRESS")
  );
}

/** Server-authoritative shipping charge in cents. */
export function calculateShippingCents(
  method: ShippingMethodId,
  subtotalAfterDiscountsCents: number,
): number {
  if (
    method === "STANDARD" &&
    subtotalAfterDiscountsCents > FREE_SHIPPING_THRESHOLD_CENTS
  ) {
    return 0;
  }
  return SHIPPING_METHODS[method].baseFeeCents;
}

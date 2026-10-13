import { createHash } from "crypto";

import {
  couponDiscountForSubtotal,
  percentOfCents,
} from "./calculation";

/**
 * Pure checkout pricing rules (domain layer — no framework or DB imports).
 * All authoritative money math runs in integer cents; numeric-string columns
 * are only the storage representation.
 */

export const CHECKOUT_CURRENCY = "USD";

/**
 * Tax hook. No jurisdiction rules exist in the repository, so tax is
 * explicitly zero rather than invented. When regional tax lands, implement
 * it here and every total updates consistently.
 */
export const TAX_RATE_BPS = 0;

export function calculateTaxCents(
  _taxableCents: number,
  rateBps: number = TAX_RATE_BPS,
): number {
  // Exact decimal percentage; single half-up rounding at the aggregate.
  return percentOfCents(_taxableCents, rateBps);
}

export type CouponKind = "PERCENTAGE" | "FIXED";

export interface CouponTerms {
  type: CouponKind;
  value: string | number;
  maximumDiscountAmount?: string | number | null;
}

/**
 * FR-12.03 discount math: PERCENTAGE capped by maximumDiscountAmount,
 * FIXED capped at the subtotal. Never negative, never exceeds the base.
 * Exact decimal intermediates; half-up rounding once on the result.
 */
export function calculateCouponDiscountCents(
  subtotalCents: number,
  coupon: CouponTerms,
): number {
  return couponDiscountForSubtotal(subtotalCents, coupon);
}

export interface OrderTotals {
  /** Sum of effective unit price × quantity, before coupons. */
  subtotalCents: number;
  /** Promotion savings already reflected in effective prices. */
  promotionDiscountCents: number;
  couponDiscountCents: number;
  shippingCents: number;
  taxCents: number;
  /** subtotal − coupon + shipping + tax (BR-002). */
  totalCents: number;
}

/** BR-002 exact financial invariant, in cents. */
export function calculateOrderTotals(input: {
  subtotalCents: number;
  promotionDiscountCents: number;
  couponDiscountCents: number;
  shippingCents: number;
  taxCents: number;
}): OrderTotals {
  const totalCents =
    input.subtotalCents -
    input.couponDiscountCents +
    input.shippingCents +
    input.taxCents;
  if (totalCents < 0) {
    throw new Error("Order total must not be negative");
  }
  return { ...input, totalCents };
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Canonical checkout hash: binds an idempotency key to one exact order
 * intent. Key reuse with different inputs is rejected (409) instead of
 * returning a mismatched order.
 */
export function hashCheckoutInput(canonical: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

const ORDER_NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** `VEL-YYYYMMDD-XXXX` human-readable order number (SRS FR-09.01). */
export function generateOrderNumber(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += ORDER_NUMBER_ALPHABET[Math.floor(Math.random() * ORDER_NUMBER_ALPHABET.length)];
  }
  return `VEL-${y}${m}${d}-${suffix}`;
}

import Decimal from "decimal.js";

import {
  MAX_MINOR_UNITS,
  assertNonNegativeMinorUnits,
  assertSupportedCurrency,
  type SupportedCurrency,
} from "./money";
import type { ShippingMethodId } from "./shipping";

/**
 * Dedicated checkout calculation engine (domain layer — pure, no React,
 * database, or Stripe access).
 *
 * Implements the approved formula with exact decimal intermediates:
 *
 *   Subtotal       = Σ(quantityᵢ × unitPriceᵢ)          (exact integer sums)
 *   DiscountAmount = PromotionDiscount + CouponDiscount
 *   TaxableBase    = Subtotal − DiscountAmount + TaxableShipping   (≥ 0)
 *   TaxAmount      = round_half_up(TaxableBase × TaxRate)
 *   TotalAmount    = Subtotal − DiscountAmount + Shipping + Tax
 *
 * Rounding policy: ROUND_HALF_UP applied exactly once per computed
 * aggregate that involves division (percentage discounts, tax). Line
 * totals and subtotals are exact sums of minor-unit integers and are
 * never re-rounded. See docs/checkout.md for the full policy.
 *
 * Stacking policy (enforced by construction — the engine accepts a single
 * coupon figure): product promotions adjust unit prices first (BR-009),
 * then at most one coupon applies to the discounted merchandise subtotal.
 * Coupons never touch shipping or tax. Discounts can never drive the
 * merchandise base negative: coupon input is capped at the subtotal and
 * re-checked here.
 */

/** Engine version frozen into each order snapshot (`pricing_policy_version`). */
export const PRICING_POLICY_VERSION = "2";

export interface EngineLine {
  variantId: string;
  quantity: number;
  /** Effective (post-promotion) unit price, minor units. */
  unitPriceCents: number;
  /** Promotion saving per unit embedded in the effective price. */
  discountPerUnitCents: number;
}

export interface EngineInput {
  currency: string;
  lines: EngineLine[];
  /** Single coupon discount on the merchandise subtotal, minor units. */
  couponDiscountCents: number;
  shippingMethod: ShippingMethodId;
  shippingCents: number;
  /** Portion of shipping inside the taxable base (0 unless taxed). */
  taxableShippingCents: number;
  taxJurisdiction: string;
  /** Non-negative integer basis points. */
  taxRateBps: number;
}

export interface EngineLineTotal {
  variantId: string;
  quantity: number;
  unitPriceCents: number;
  lineSubtotalCents: number;
  linePromotionCents: number;
}

export interface TotalsBreakdown {
  currency: SupportedCurrency;
  lines: EngineLineTotal[];
  /** Σ line subtotals (effective prices), minor units. */
  subtotalCents: number;
  promotionDiscountCents: number;
  couponDiscountCents: number;
  /** Promotion + coupon. Never exceeds the merchandise subtotal. */
  totalDiscountCents: number;
  /** Merchandise subtotal after coupon, before shipping/tax. */
  discountedBaseCents: number;
  shippingMethod: ShippingMethodId;
  shippingCents: number;
  taxableShippingCents: number;
  taxJurisdiction: string;
  taxRateBps: number;
  taxableBaseCents: number;
  taxCents: number;
  totalCents: number;
  pricingPolicyVersion: string;
}

function fail(label: string): never {
  throw new Error(`Invalid checkout totals (${label}).`);
}

/** Percentage-of-base in minor units, half-up — the single division helper. */
export function percentOfCents(baseCents: number, rateBps: number): number {
  assertNonNegativeMinorUnits(baseCents, "percentage base");
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) fail("rate");
  const result = new Decimal(baseCents)
    .mul(rateBps)
    .div(10_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const cents = result.toNumber();
  if (!Number.isSafeInteger(cents) || cents < 0) fail("percentage result");
  return cents;
}

/** Coupon figure against a merchandise subtotal (FR-12.03), Decimal-exact. */
export function couponDiscountForSubtotal(
  subtotalCents: number,
  coupon: { type: "PERCENTAGE" | "FIXED"; value: string | number; maximumDiscountAmount?: string | number | null },
): number {
  assertNonNegativeMinorUnits(subtotalCents, "coupon base");
  if (subtotalCents === 0) return 0;
  if (coupon.type === "PERCENTAGE") {
    let pct: Decimal;
    try {
      pct = new Decimal(coupon.value);
    } catch {
      return 0;
    }
    if (!pct.isFinite() || pct.lte(0)) return 0;
    const raw = new Decimal(subtotalCents)
      .mul(pct)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    let discount = raw;
    if (
      coupon.maximumDiscountAmount !== null &&
      coupon.maximumDiscountAmount !== undefined
    ) {
      try {
        const cap = new Decimal(coupon.maximumDiscountAmount)
          .mul(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        if (cap.isFinite() && cap.gte(0) && cap.lt(discount)) discount = cap;
      } catch {
        // Unparseable cap: fall back to the uncapped figure (still ≤ subtotal).
      }
    }
    return Math.max(0, Math.min(discount.toNumber(), subtotalCents));
  }
  let fixed: Decimal;
  try {
    fixed = new Decimal(coupon.value).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  } catch {
    return 0;
  }
  if (!fixed.isFinite() || fixed.lte(0)) return 0;
  return Math.min(fixed.toNumber(), subtotalCents);
}

export function calculateCheckoutTotals(input: EngineInput): TotalsBreakdown {
  assertSupportedCurrency(input.currency);
  if (!Number.isSafeInteger(input.taxRateBps) || input.taxRateBps < 0) {
    fail("tax rate");
  }
  assertNonNegativeMinorUnits(input.shippingCents, "shipping");
  assertNonNegativeMinorUnits(input.taxableShippingCents, "taxable shipping");
  if (input.taxableShippingCents > input.shippingCents) fail("taxable shipping");
  assertNonNegativeMinorUnits(input.couponDiscountCents, "coupon");

  const lines: EngineLineTotal[] = input.lines.map((line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) fail("quantity");
    assertNonNegativeMinorUnits(line.unitPriceCents, "unit price");
    assertNonNegativeMinorUnits(line.discountPerUnitCents, "unit promotion");
    if (line.discountPerUnitCents > line.unitPriceCents) fail("unit promotion");
    const lineSubtotalCents = line.unitPriceCents * line.quantity;
    if (!Number.isSafeInteger(lineSubtotalCents)) fail("line subtotal");
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineSubtotalCents,
      linePromotionCents: line.discountPerUnitCents * line.quantity,
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  if (!Number.isSafeInteger(subtotalCents)) fail("subtotal");
  const promotionDiscountCents = lines.reduce((s, l) => s + l.linePromotionCents, 0);

  if (input.couponDiscountCents > subtotalCents) fail("coupon exceeds subtotal");
  const discountedBaseCents = subtotalCents - input.couponDiscountCents;

  const taxableBaseCents = discountedBaseCents + input.taxableShippingCents;
  const taxCents = percentOfCents(taxableBaseCents, input.taxRateBps);

  const totalCents = discountedBaseCents + input.shippingCents + taxCents;
  if (totalCents < 0 || totalCents > MAX_MINOR_UNITS) fail("order total");

  return {
    currency: input.currency,
    lines,
    subtotalCents,
    promotionDiscountCents,
    couponDiscountCents: input.couponDiscountCents,
    totalDiscountCents: promotionDiscountCents + input.couponDiscountCents,
    discountedBaseCents,
    shippingMethod: input.shippingMethod,
    shippingCents: input.shippingCents,
    taxableShippingCents: input.taxableShippingCents,
    taxJurisdiction: input.taxJurisdiction,
    taxRateBps: input.taxRateBps,
    taxableBaseCents,
    taxCents,
    totalCents,
    pricingPolicyVersion: PRICING_POLICY_VERSION,
  };
}

import { describe, it, expect } from "vitest";

import {
  PRICING_POLICY_VERSION,
  calculateCheckoutTotals,
  couponDiscountForSubtotal,
  percentOfCents,
} from "@/modules/checkout/domain/calculation";

const line = (over: Partial<{ variantId: string; quantity: number; unitPriceCents: number; discountPerUnitCents: number }> = {}) => ({
  variantId: "v1",
  quantity: 2,
  unitPriceCents: 1800,
  discountPerUnitCents: 200,
  ...over,
});

const base = (over: Partial<Parameters<typeof calculateCheckoutTotals>[0]> = {}) => ({
  currency: "USD",
  lines: [line()],
  couponDiscountCents: 0,
  shippingMethod: "STANDARD" as const,
  shippingCents: 499,
  taxableShippingCents: 0,
  taxJurisdiction: "UNCONFIGURED",
  taxRateBps: 0,
  ...over,
});

describe("percentage math (exact decimal)", () => {
  it("rounds half-up on fractional minor units", () => {
    // 7.5% of 100c = 7.5c → 8c (binary floats famously fumble these).
    expect(percentOfCents(100, 750)).toBe(8);
    expect(percentOfCents(100, 250)).toBe(3);
    expect(percentOfCents(1999, 1000)).toBe(200);
  });

  it("computes fractional coupon percentages exactly", () => {
    // 12.5% of $9.99 = $1.24875 → 125c.
    expect(couponDiscountForSubtotal(999, { type: "PERCENTAGE", value: "12.5" })).toBe(125);
    expect(couponDiscountForSubtotal(999, { type: "PERCENTAGE", value: "10", maximumDiscountAmount: "0.50" })).toBe(50);
  });

  it("rejects invalid rates and bases", () => {
    expect(() => percentOfCents(100, -1)).toThrow();
    expect(() => percentOfCents(-5, 100)).toThrow();
    expect(couponDiscountForSubtotal(0, { type: "FIXED", value: "5.00" })).toBe(0);
  });
});

describe("checkout totals engine (BR-002)", () => {
  it("prices multiple lines with stacking promo-then-coupon", () => {
    const totals = calculateCheckoutTotals(
      base({
        lines: [line(), line({ variantId: "v2", quantity: 1, unitPriceCents: 2250, discountPerUnitCents: 250 })],
        couponDiscountCents: 500,
      }),
    );
    // Subtotal 3600 + 2250 = 5850; promo 400 + 250 = 650; coupon 500.
    expect(totals.subtotalCents).toBe(5850);
    expect(totals.promotionDiscountCents).toBe(650);
    expect(totals.totalDiscountCents).toBe(1150);
    expect(totals.totalCents).toBe(5850 - 500 + 499);
    expect(totals.pricingPolicyVersion).toBe(PRICING_POLICY_VERSION);
    expect(totals.lines).toHaveLength(2);
    expect(totals.lines[0]).toMatchObject({
      lineSubtotalCents: 3600,
      linePromotionCents: 400,
    });
  });

  it("supports coupon-free orders (promotions still apply)", () => {
    const totals = calculateCheckoutTotals(base({ shippingCents: 0 }));
    expect(totals.couponDiscountCents).toBe(0);
    expect(totals.promotionDiscountCents).toBe(400);
    expect(totals.totalCents).toBe(3600);
    expect(totals.totalDiscountCents).toBe(400);
  });

  it("includes taxable shipping in the base and excludes untaxed shipping", () => {
    const taxed = calculateCheckoutTotals(
      base({ shippingCents: 499, taxableShippingCents: 499, taxRateBps: 1000, taxJurisdiction: "T-TEST" }),
    );
    // Base 3600 + 499 = 4099; 10% → 410 (409.9 half-up).
    expect(taxed.taxableBaseCents).toBe(4099);
    expect(taxed.taxCents).toBe(410);
    expect(taxed.totalCents).toBe(3600 + 499 + 410);

    const untaxed = calculateCheckoutTotals(
      base({ shippingCents: 499, taxableShippingCents: 0, taxRateBps: 1000, taxJurisdiction: "T-TEST" }),
    );
    expect(untaxed.taxableBaseCents).toBe(3600);
    expect(untaxed.taxCents).toBe(360);
  });

  it("floors the taxable base at zero under a full-merchandise discount", () => {
    // Coupon wipes the merchandise subtotal: base is max(0, 0 + shipping).
    const totals = calculateCheckoutTotals(
      base({
        couponDiscountCents: 3600,
        shippingCents: 499,
        taxableShippingCents: 0,
        taxRateBps: 1000,
        taxJurisdiction: "T-TEST",
      }),
    );
    expect(totals.discountedBaseCents).toBe(0);
    expect(totals.taxableBaseCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(499);
    expect(totals.totalDiscountCents).toBe(400 + 3600);
  });

  it("guards discount, base, currency, and overflow boundaries", () => {    expect(() => calculateCheckoutTotals(base({ couponDiscountCents: 3601 }))).toThrow(/coupon/);
    expect(() => calculateCheckoutTotals(base({ taxableShippingCents: 500 }))).toThrow(/taxable shipping/);
    expect(() => calculateCheckoutTotals(base({ currency: "EUR" }))).toThrow(/currency/i);
    expect(() => calculateCheckoutTotals(base({ currency: "JPY" }))).toThrow(/currency/i);
    expect(() => calculateCheckoutTotals(base({ taxRateBps: -5 }))).toThrow();
    expect(() =>
      calculateCheckoutTotals(base({ lines: [line({ quantity: -1 })] })),
    ).toThrow();
    expect(() =>
      calculateCheckoutTotals(
        base({ lines: [line({ unitPriceCents: Number.MAX_SAFE_INTEGER })] }),
      ),
    ).toThrow();
    expect(() =>
      calculateCheckoutTotals(base({ lines: [line({ discountPerUnitCents: 1801 })] })),
    ).toThrow();
    expect(calculateCheckoutTotals(base({ lines: [] })).totalCents).toBe(499);
  });
});

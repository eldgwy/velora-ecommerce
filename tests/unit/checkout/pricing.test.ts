import { describe, it, expect } from "vitest";

import {
  FREE_SHIPPING_THRESHOLD_CENTS,
  calculateShippingCents,
  isShippingMethod,
} from "@/modules/checkout/domain/shipping";
import {
  calculateCouponDiscountCents,
  calculateOrderTotals,
  calculateTaxCents,
  formatCents,
  generateOrderNumber,
  hashCheckoutInput,
} from "@/modules/checkout/domain/pricing";

describe("shipping", () => {
  it("charges flat fees per method", () => {
    expect(calculateShippingCents("STANDARD", 1000)).toBe(499);
    expect(calculateShippingCents("EXPRESS", 1000)).toBe(1299);
  });

  it("makes STANDARD free strictly above the threshold (BR-018)", () => {
    expect(FREE_SHIPPING_THRESHOLD_CENTS).toBe(7500);
    expect(calculateShippingCents("STANDARD", 7501)).toBe(0);
    expect(calculateShippingCents("STANDARD", 7500)).toBe(499);
    expect(calculateShippingCents("EXPRESS", 20_000)).toBe(1299);
  });

  it("validates method ids", () => {
    expect(isShippingMethod("STANDARD")).toBe(true);
    expect(isShippingMethod("EXPRESS")).toBe(true);
    expect(isShippingMethod("OVERNIGHT")).toBe(false);
    expect(isShippingMethod("standard")).toBe(false);
    expect(isShippingMethod(null)).toBe(false);
  });
});

describe("coupon math (FR-12.03)", () => {
  it("computes percentage discounts capped by the maximum", () => {
    expect(
      calculateCouponDiscountCents(5850, { type: "PERCENTAGE", value: "10", maximumDiscountAmount: "5.00" }),
    ).toBe(500);
    expect(
      calculateCouponDiscountCents(1000, { type: "PERCENTAGE", value: "10" }),
    ).toBe(100);
  });

  it("caps fixed discounts at the subtotal", () => {
    expect(
      calculateCouponDiscountCents(300, { type: "FIXED", value: "10.00" }),
    ).toBe(300);
    expect(
      calculateCouponDiscountCents(2000, { type: "FIXED", value: "10.00" }),
    ).toBe(1000);
  });

  it("returns zero for empty or invalid coupons", () => {
    expect(calculateCouponDiscountCents(0, { type: "FIXED", value: "5.00" })).toBe(0);
    expect(calculateCouponDiscountCents(1000, { type: "PERCENTAGE", value: "0" })).toBe(0);
    expect(calculateCouponDiscountCents(1000, { type: "PERCENTAGE", value: "-5" })).toBe(0);
  });
});

describe("order totals (BR-002)", () => {
  it("follows subtotal − coupon + shipping + tax exactly", () => {
    const totals = calculateOrderTotals({
      subtotalCents: 5850,
      promotionDiscountCents: 650,
      couponDiscountCents: 500,
      shippingCents: 499,
      taxCents: 0,
    });
    expect(totals.totalCents).toBe(5850 - 500 + 499);
    expect(formatCents(totals.totalCents)).toBe("58.49");
  });

  it("rejects negative totals", () => {
    expect(() =>
      calculateOrderTotals({
        subtotalCents: 100,
        promotionDiscountCents: 0,
        couponDiscountCents: 500,
        shippingCents: 0,
        taxCents: 0,
      }),
    ).toThrow();
  });

  it("computes zero tax without jurisdiction rules", () => {
    expect(calculateTaxCents(10_000)).toBe(0);
  });
});

describe("order numbers and hashes", () => {
  it("generates VEL-YYYYMMDD-XXXX numbers", () => {
    const n = generateOrderNumber(new Date("2026-10-12T00:00:00Z"));
    expect(n).toMatch(/^VEL-20261012-[A-Z2-9]{4}$/);
    expect(generateOrderNumber()).not.toBe(generateOrderNumber());
  });

  it("hashes canonical input deterministically", () => {
    const a = hashCheckoutInput({ items: [{ v: 1 }], total: 5 });
    expect(hashCheckoutInput({ items: [{ v: 1 }], total: 5 })).toBe(a);
    expect(hashCheckoutInput({ items: [{ v: 2 }], total: 5 })).not.toBe(a);
  });
});

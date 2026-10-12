import { describe, it, expect } from "vitest";

import {
  MAX_QUANTITY_PER_ITEM,
  MAX_DISTINCT_ITEMS,
  applyPromotionToUnitPrice,
  capAtAvailable,
  fromCents,
  isPurchasable,
  isValidQuantity,
  lineTotalCents,
  mergeQuantities,
  subtotalCents,
  toCents,
} from "@/modules/cart/domain/rules/cart-rules";

describe("cart rules", () => {
  it("defines sane quantity policy bounds", () => {
    expect(MAX_QUANTITY_PER_ITEM).toBeGreaterThanOrEqual(1);
    expect(MAX_DISTINCT_ITEMS).toBeGreaterThanOrEqual(1);
  });

  it("accepts only ACTIVE variant + ACTIVE product as purchasable", () => {
    expect(isPurchasable("ACTIVE", "ACTIVE")).toBe(true);
    expect(isPurchasable("DRAFT", "ACTIVE")).toBe(false);
    expect(isPurchasable("ACTIVE", "ARCHIVE")).toBe(false);
    expect(isPurchasable("ARCHIVE", "ARCHIVE")).toBe(false);
  });

  it("validates quantity ranges", () => {
    expect(isValidQuantity(1)).toBe(true);
    expect(isValidQuantity(MAX_QUANTITY_PER_ITEM)).toBe(true);
    expect(isValidQuantity(0)).toBe(false);
    expect(isValidQuantity(-1)).toBe(false);
    expect(isValidQuantity(1.5)).toBe(false);
    expect(isValidQuantity(MAX_QUANTITY_PER_ITEM + 1)).toBe(false);
    expect(isValidQuantity(Number.NaN)).toBe(false);
    expect(isValidQuantity("2")).toBe(false);
  });

  it("merges quantities by addition", () => {
    expect(mergeQuantities(2, 3)).toBe(5);
    expect(mergeQuantities(0, 4)).toBe(4);
  });

  it("caps at available stock and reports the remainder", () => {
    expect(capAtAvailable(3, 10)).toEqual({ quantity: 3, remainder: 0 });
    expect(capAtAvailable(12, 10)).toEqual({ quantity: 10, remainder: 2 });
    expect(capAtAvailable(5, 0)).toEqual({ quantity: 0, remainder: 5 });
  });

  it("computes money in integer cents without float drift", () => {
    expect(toCents("19.99")).toBe(1999);
    expect(fromCents(1999)).toBe("19.99");
    expect(lineTotalCents("19.99", 3)).toBe(5997);
    expect(subtotalCents([{ unitPrice: "0.10", quantity: 3 }])).toBe(30);
    expect(fromCents(subtotalCents([{ unitPrice: "0.10", quantity: 3 }]))).toBe("0.30");
  });

  it("applies percentage and fixed promotions with a zero floor", () => {
    expect(
      applyPromotionToUnitPrice(10000, { type: "PERCENTAGE", value: "10" }),
    ).toBe(9000);
    expect(
      applyPromotionToUnitPrice(10000, { type: "FIXED", value: "25.00" }),
    ).toBe(7500);
    expect(
      applyPromotionToUnitPrice(1000, { type: "FIXED", value: "50.00" }),
    ).toBe(0);
    expect(
      applyPromotionToUnitPrice(1000, { type: "PERCENTAGE", value: "0" }),
    ).toBe(1000);
  });
});

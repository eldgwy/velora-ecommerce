import { describe, it, expect } from "vitest";

import {
  COUPON_CODE_PATTERN,
  assertMajorDecimal,
  assertPercentageValue,
  deriveCouponStatus,
  normalizeCouponCode,
} from "@/modules/coupons/domain/coupon-rules";
import { CouponValidationError } from "@/modules/coupons/domain/coupon-errors";

describe("coupon code normalization", () => {
  it("uppercases and trims", () => {
    expect(normalizeCouponCode("  save10 ")).toBe("SAVE10");
    expect(normalizeCouponCode("SUMMER-20_X")).toBe("SUMMER-20_X");
  });

  it("rejects empty and out-of-alphabet codes", () => {
    for (const bad of ["", "  ", "AB", "x".repeat(33), "SAVE 10", "SAVE.10", "café"]) {
      expect(() => normalizeCouponCode(bad)).toThrow(CouponValidationError);
    }
    expect(COUPON_CODE_PATTERN.test("AB")).toBe(false);
    expect(COUPON_CODE_PATTERN.test("ABC")).toBe(true);
  });
});

describe("coupon display status", () => {
  const base = {
    isActive: true,
    startsAt: null,
    expiresAt: null,
    usageLimit: null as number | null,
    usageCount: 0,
  };
  const now = new Date("2026-10-14T12:00:00Z");

  it("derives lifecycle states from one clock value", () => {
    expect(deriveCouponStatus(base, now)).toBe("ACTIVE");
    expect(deriveCouponStatus({ ...base, isActive: false }, now)).toBe("INACTIVE");
    expect(
      deriveCouponStatus({ ...base, startsAt: new Date("2026-10-15T00:00:00Z") }, now),
    ).toBe("SCHEDULED");
    expect(
      deriveCouponStatus({ ...base, expiresAt: new Date("2026-10-14T12:00:00Z") }, now),
    ).toBe("EXPIRED");
    expect(
      deriveCouponStatus({ ...base, usageLimit: 5, usageCount: 5 }, now),
    ).toBe("EXHAUSTED");
    expect(
      deriveCouponStatus({ ...base, usageLimit: 5, usageCount: 4 }, now),
    ).toBe("ACTIVE");
  });
});

describe("decimal term validation", () => {
  it("accepts exact decimals and rejects the rest", () => {
    expect(assertMajorDecimal("10.50", "test", { maxDecimals: 2 }).toFixed(2)).toBe("10.50");
    for (const bad of ["0", "-3", "abc", "10.501", "Infinity"]) {
      expect(() => assertMajorDecimal(bad, "test", { maxDecimals: 2 })).toThrow(
        CouponValidationError,
      );
    }
  });

  it("bounds percentages to (0, 100]", () => {
    expect(assertPercentageValue("12.5").toString()).toBe("12.5");
    for (const bad of ["0", "-5", "100.01", "101", "nope"]) {
      expect(() => assertPercentageValue(bad)).toThrow(CouponValidationError);
    }
  });
});

import { describe, it, expect } from "vitest";

import {
  applyPromotionToUnitPriceCents,
  isPromotionWindowEligible,
  selectBestPromotion,
} from "@/modules/promotions/domain/promotion-rules";

describe("promotion unit math (exact decimal)", () => {
  it("computes percentage discounts half-up", () => {
    expect(applyPromotionToUnitPriceCents(999, { type: "PERCENTAGE", value: "12.5" })).toBe(874);
    expect(applyPromotionToUnitPriceCents(1000, { type: "PERCENTAGE", value: "10" })).toBe(900);
    expect(applyPromotionToUnitPriceCents(199, { type: "PERCENTAGE", value: "33.333" })).toBe(133);
  });

  it("computes fixed discounts and clamps at zero", () => {
    expect(applyPromotionToUnitPriceCents(2000, { type: "FIXED", value: "10.00" })).toBe(1000);
    expect(applyPromotionToUnitPriceCents(300, { type: "FIXED", value: "10.00" })).toBe(0);
    expect(applyPromotionToUnitPriceCents(0, { type: "FIXED", value: "5.00" })).toBe(0);
  });

  it("ignores invalid terms instead of corrupting prices", () => {
    expect(applyPromotionToUnitPriceCents(1000, { type: "PERCENTAGE", value: "0" })).toBe(1000);
    expect(applyPromotionToUnitPriceCents(1000, { type: "PERCENTAGE", value: "-5" })).toBe(1000);
    expect(applyPromotionToUnitPriceCents(1000, { type: "PERCENTAGE", value: "nope" })).toBe(1000);
    expect(applyPromotionToUnitPriceCents(1000, { type: "FIXED", value: "0" })).toBe(1000);
    expect(applyPromotionToUnitPriceCents(1000, { type: "FIXED", value: "junk" })).toBe(1000);
  });

  it("handles fractional-cent percentages exactly (no float drift)", () => {
    // 999 × 12.5% = 124.875 → 125 saving → 874. Float math gives 874.125→874
    // here too, but 199 × 33.333% separates exact (133) from float paths.
    expect(applyPromotionToUnitPriceCents(999, { type: "PERCENTAGE", value: "12.5" })).toBe(874);
    // 1 cent at 50% → 0.5 rounds half-up to 1.
    expect(applyPromotionToUnitPriceCents(1, { type: "PERCENTAGE", value: "50" })).toBe(1);
  });
});

describe("deterministic overlap selection", () => {
  const a = { id: "aaa", name: "A", type: "PERCENTAGE" as const, value: "10" };
  const b = { id: "bbb", name: "B", type: "FIXED" as const, value: "3.00" };

  it("picks the lowest effective price", () => {
    // 2000 − 10% = 1800 (saving 200) vs 2000 − 300 = 1700 (saving 300).
    const winner = selectBestPromotion(2000, [a, b]);
    expect(winner!.id).toBe("bbb");
    expect(winner!.effectiveCents).toBe(1700);
    expect(winner!.savingCents).toBe(300);
  });

  it("breaks ties by promotion id regardless of input order", () => {
    // Both save exactly 200 on 2000: 10% vs $2.00 fixed.
    const x = { id: "mmm", name: "X", type: "PERCENTAGE" as const, value: "10" };
    const y = { id: "aaa", name: "Y", type: "FIXED" as const, value: "2.00" };
    expect(selectBestPromotion(2000, [x, y])!.id).toBe("aaa");
    expect(selectBestPromotion(2000, [y, x])!.id).toBe("aaa");
  });

  it("applies nothing without a positive saving", () => {
    expect(selectBestPromotion(2000, [])).toBeNull();
    expect(
      selectBestPromotion(2000, [{ id: "z", name: "Z", type: "FIXED", value: "0" }]),
    ).toBeNull();
    expect(selectBestPromotion(0, [a])).toBeNull();
  });
});

describe("window eligibility", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const base = { isActive: true, startsAt: null as Date | null, endsAt: null as Date | null };

  it("gates on active flag and window with one clock", () => {
    expect(isPromotionWindowEligible(base, now)).toBe(true);
    expect(isPromotionWindowEligible({ ...base, isActive: false }, now)).toBe(false);
    expect(
      isPromotionWindowEligible({ ...base, startsAt: new Date("2026-10-15T00:00:00Z") }, now),
    ).toBe(false);
    expect(
      isPromotionWindowEligible({ ...base, endsAt: new Date("2026-10-14T11:59:59Z") }, now),
    ).toBe(false);
    expect(
      isPromotionWindowEligible({ ...base, endsAt: new Date("2026-10-14T12:00:00Z") }, now),
    ).toBe(true);
  });
});

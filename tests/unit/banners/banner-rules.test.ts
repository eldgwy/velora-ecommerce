import { describe, it, expect } from "vitest";

import {
  assertBannerLink,
  assertBannerTitle,
  assertSortOrder,
  canTransitionBannerStatus,
  deriveBannerStatus,
  isBannerEligible,
} from "@/modules/banners/domain/banner-rules";
import { BannerValidationError } from "@/modules/banners/domain/banner-errors";

const NOW = new Date("2026-10-14T12:00:00Z");
const hour = 3_600_000;

describe("banner transitions", () => {
  it("allows the publishing lifecycle plus replays", () => {
    expect(canTransitionBannerStatus("DRAFT", "SCHEDULED")).toBe(true);
    expect(canTransitionBannerStatus("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransitionBannerStatus("SCHEDULED", "ACTIVE")).toBe(true);
    expect(canTransitionBannerStatus("ACTIVE", "EXPIRED")).toBe(true);
    expect(canTransitionBannerStatus("ACTIVE", "DRAFT")).toBe(true);
    expect(canTransitionBannerStatus("EXPIRED", "SCHEDULED")).toBe(true);
    for (const s of ["ACTIVE", "EXPIRED", "SCHEDULED", "DRAFT"] as const) {
      expect(canTransitionBannerStatus(s, s)).toBe(true);
    }
  });

  it("rejects silent or backward publication", () => {
    expect(canTransitionBannerStatus("DRAFT", "EXPIRED")).toBe(false);
    expect(canTransitionBannerStatus("EXPIRED", "ACTIVE")).toBe(false);
  });
});

describe("public eligibility (inclusive interval, one clock)", () => {
  const base = { status: "ACTIVE" as const, startsAt: null as Date | null, endsAt: null as Date | null };

  it("requires ACTIVE status inside the window", () => {
    expect(isBannerEligible(base, NOW)).toBe(true);
    expect(isBannerEligible({ ...base, status: "DRAFT" }, NOW)).toBe(false);
    expect(isBannerEligible({ ...base, status: "SCHEDULED" }, NOW)).toBe(false);
    expect(isBannerEligible({ ...base, status: "EXPIRED" }, NOW)).toBe(false);
  });

  it("applies inclusive start/end boundaries", () => {
    expect(
      isBannerEligible({ ...base, startsAt: new Date(NOW.getTime() - hour), endsAt: new Date(NOW.getTime() + hour) }, NOW),
    ).toBe(true);
    // Exact boundaries are eligible (inclusive interval).
    expect(
      isBannerEligible({ ...base, startsAt: NOW, endsAt: new Date(NOW.getTime() + hour) }, NOW),
    ).toBe(true);
    expect(
      isBannerEligible({ ...base, startsAt: new Date(NOW.getTime() - hour), endsAt: NOW }, NOW),
    ).toBe(true);
    expect(
      isBannerEligible({ ...base, startsAt: new Date(NOW.getTime() + 1) }, NOW),
    ).toBe(false);
    expect(
      isBannerEligible({ ...base, endsAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe(false);
  });
});

describe("derived display status", () => {
  it("reflects the window without ever leaving DRAFT implicitly", () => {
    expect(deriveBannerStatus({ status: "DRAFT", startsAt: null, endsAt: null }, NOW)).toBe("DRAFT");
    expect(
      deriveBannerStatus({ status: "SCHEDULED", startsAt: new Date(NOW.getTime() - hour), endsAt: null }, NOW),
    ).toBe("ACTIVE");
    expect(
      deriveBannerStatus({ status: "ACTIVE", startsAt: null, endsAt: new Date(NOW.getTime() - hour) }, NOW),
    ).toBe("EXPIRED");
  });
});

describe("field validation", () => {
  it("requires titles and validates links", () => {
    expect(assertBannerTitle("  Sale  ")).toBe("Sale");
    expect(() => assertBannerTitle("")).toThrow(BannerValidationError);
    expect(() => assertBannerTitle("x".repeat(121))).toThrow(BannerValidationError);
    expect(assertBannerLink(null)).toBeNull();
    expect(assertBannerLink("/collections/summer")).toBe("/collections/summer");
    expect(assertBannerLink("https://example.com/x")).toBe("https://example.com/x");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//evil.com", "/a b", "/a\\b"]) {
      expect(() => assertBannerLink(bad)).toThrow(BannerValidationError);
    }
  });

  it("bounds display order", () => {
    expect(assertSortOrder(null)).toBeNull();
    expect(assertSortOrder(0)).toBe(0);
    expect(() => assertSortOrder(-1)).toThrow(BannerValidationError);
    expect(() => assertSortOrder(1.5)).toThrow(BannerValidationError);
  });
});

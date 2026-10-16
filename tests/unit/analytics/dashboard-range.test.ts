import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/database", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("DB must not be touched"); } }),
}));

import {
  MAX_REPORT_DAYS,
  normalizeReportRange,
  validateReportRange,
} from "@/modules/analytics/application/queries/dashboard";

describe("report range validation", () => {
  it("normalizes day walls half-open", () => {
    const { from, to } = normalizeReportRange(
      new Date("2026-10-01T15:30:00Z"),
      new Date("2026-10-03T02:00:00Z"),
    );
    expect(from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-03T00:00:00.000Z");
  });

  it("rejects inverted, invalid, and over-long ranges", () => {
    expect(() =>
      validateReportRange(new Date("2026-10-03"), new Date("2026-10-01")),
    ).toThrow(/precede/);
    expect(() =>
      validateReportRange(new Date("2026-10-01"), new Date("2026-10-01")),
    ).toThrow(/precede/);
    expect(() => validateReportRange(new Date("NaN"), new Date())).toThrow(/invalid/i);
    expect(() =>
      validateReportRange(new Date("2026-01-01"), new Date("2026-05-01")),
    ).toThrow(new RegExp(`${MAX_REPORT_DAYS}`));
  });

  it("pins the 90-day policy", () => {
    expect(MAX_REPORT_DAYS).toBe(90);
  });
});

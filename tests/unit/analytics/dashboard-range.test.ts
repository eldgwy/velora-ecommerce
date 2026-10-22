import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/database", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("DB must not be touched"); } }),
}));

import {
  MAX_REPORT_DAYS,
  normalizeReportRange,
  resolveDashboardRange,
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

describe("dashboard range presets", () => {
  it("maps presets to trailing-day windows ending tomorrow", () => {
    const now = new Date("2026-10-22T14:30:22Z");
    const { from, to, kind } = resolveDashboardRange({ range: "7d" }, now);
    expect(kind).toBe("7d");
    expect(from.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("resolves the today preset as exactly one current day", () => {
    const now = new Date("2026-10-22T01:00:00Z");
    const range = resolveDashboardRange({ range: "today" }, now);
    expect(range.kind).toBe("today");
    expect(range.from.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("defaults to 30 days when no range is given", () => {
    const now = new Date("2026-10-22T18:00:00Z");
    const range = resolveDashboardRange({}, now);
    expect(range.kind).toBe("30d");
    expect(range.from.toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });

  it("custom from/to take precedence over presets", () => {
    const now = new Date("2026-10-22T18:00:00Z");
    const range = resolveDashboardRange({ range: "90d", from: "2026-10-01", to: "2026-10-10" }, now);
    expect(range.kind).toBe("custom");
    expect(range.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("does not treat one-sided custom dates as custom", () => {
    const now = new Date("2026-10-22T18:00:00Z");
    // A missing `to` (or a malformed date) never unlocks the custom
    // path: the 30-day default applies instead of a 1-Jan-to-now blowout.
    const range = resolveDashboardRange({ from: "2026-01-01" }, now);
    expect(range.kind).toBe("30d");
    const malformed = resolveDashboardRange({ from: "10/01/2026", to: "2026-10-10" }, now);
    expect(malformed.kind).toBe("30d");
  });

  it("falls back to the 30-day window for unknown presets", () => {
    const now = new Date("2026-10-22T18:00:00Z");
    const range = resolveDashboardRange({ range: "104w" }, now);
    expect(range.kind).toBe("30d");
  });
});

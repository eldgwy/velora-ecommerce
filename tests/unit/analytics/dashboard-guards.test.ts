import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/database", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("DB must not be touched"); } }),
}));

const sessionState = { resolved: false as boolean, role: "ADMIN" };

vi.mock("@/shared/lib/guards", () => ({
  getCurrentSession: vi.fn(async () =>
    sessionState.resolved ? { user: { id: "u1", role: sessionState.role, status: "ACTIVE" } } : null,
  ),
  requireAdmin: vi.fn(async () => {
    if (!sessionState.resolved) throw new Error("NEXT_REDIRECT");
    return { user: { id: "u1", role: sessionState.role, status: "ACTIVE" } };
  }),
}));

import { getDashboardDataAction } from "@/modules/analytics/presentation/actions/dashboard.actions";

/**
 * Fail-closed order for the dashboard action: sessionless access throws
 * before touching the database; authenticated access with bad period
 * input returns a precise validation error and never reaches SQL; a
 * failure inside the queries surfaces as a generic retryable error, never
 * as zero-valued metrics.
 */
describe("dashboard action guards and validation", () => {
  beforeEach(() => {
    sessionState.resolved = false;
    sessionState.role = "ADMIN";
  });

  it("refuses sessionless access and never touches the database", async () => {
    await expect(getDashboardDataAction({ range: "7d" })).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("rejects unknown range presets with a precise message", async () => {
    sessionState.resolved = true;
    const res = await getDashboardDataAction({ range: "52weeks" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/period is not valid/i);
    }
  });

  it("rejects malformed custom dates without touching the database", async () => {
    sessionState.resolved = true;
    const res = await getDashboardDataAction({ from: "10/01/2026", to: "2026-10-10" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/period is not valid/i);
    }
  });

  it("reports inverted or overlong custom windows precisely", async () => {
    sessionState.resolved = true;
    const inverted = await getDashboardDataAction({ from: "2026-10-10", to: "2026-10-01" });
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) {
      expect(inverted.error).toMatch(/Custom reporting dates/);
    }
    const tooLong = await getDashboardDataAction({ from: "2026-01-01", to: "2026-12-31" });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.error).toMatch(/Custom reporting dates/);
    }
  });

  it("surfaces query failures as a generic retryable error", async () => {
    sessionState.resolved = true;
    const res = await getDashboardDataAction({ range: "7d" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/could not be loaded/i);
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Health-probe contract (T-2.7 / GP-18): healthy DB -> 200 + presence-only
 * env booleans; failing DB -> 503, status "unhealthy", no-store cache
 * headers so a monitor never reads stale state.
 */

const execute = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/database", () => ({
  db: { execute },
}));

import { GET } from "@/app/api/health/route";

const OPTIONAL_ENV_KEYS = [
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GUEST_CART_SECRET",
  "LOW_STOCK_ALERT_RECIPIENTS",
];

describe("GET /api/health", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("reports healthy with a DB round-trip and presence-only env booleans", async () => {
    execute.mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    const checks = body.checks as {
      database: { status: string; latencyMs: number };
      env: Record<string, boolean>;
    };
    expect(checks.database.status).toBe("up");
    expect(checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    // Presence-only: exactly the optional operational keys, all booleans.
    expect(Object.keys(checks.env).sort()).toEqual([...OPTIONAL_ENV_KEYS].sort());
    for (const value of Object.values(checks.env)) {
      expect(typeof value).toBe("boolean");
    }
  });

  it("returns 503 and unhealthy when the database round-trip fails", async () => {
    execute.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("unhealthy");
    const checks = body.checks as { database: { status: string } };
    expect(checks.database.status).toBe("down");
  });
});

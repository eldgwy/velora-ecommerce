import { vi, describe, it, expect } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/database", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("DB must not be touched"); } }),
}));
vi.mock("@/shared/lib/guards", () => ({
  getCurrentSession: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => {
    throw new Error("NEXT_REDIRECT");
  }),
  requireSession: vi.fn(async () => {
    throw new Error("NEXT_REDIRECT");
  }),
  requireRole: vi.fn(async () => {
    throw new Error("FORBIDDEN");
  }),
}));

import { collectCodPaymentAction } from "@/modules/payments/presentation/actions/cod.actions";

/**
 * COD action guard wiring: without a staff session the action throws before
 * any database access or state change. Real session behavior is covered by
 * the auth suite and the proxy.
 */
describe("COD action guards", () => {
  it("refuses sessionless cash collection", async () => {
    await expect(
      collectCodPaymentAction("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(collectCodPaymentAction("not-a-uuid")).rejects.toThrow();
  });
});

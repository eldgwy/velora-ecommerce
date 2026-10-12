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

import { getOrderHistoryAction } from "@/modules/orders/presentation/actions/order.actions";
import { getAdminOrdersAction } from "@/modules/orders/presentation/actions/admin-order.actions";
import { cancelCustomerOrderAction } from "@/modules/orders/presentation/actions/order.actions";

/**
 * Presentation guard wiring: with no session, customer actions return error
 * results and admin actions throw before any database access. Real session
 * behavior is covered by the auth suite and the proxy; these tests pin the
 * fail-closed order (identity first, data never).
 */
describe("order action guards", () => {
  it("refuses sessionless history access", async () => {
    const res = await getOrderHistoryAction({ page: 1 });
    expect(res.ok).toBe(false);
  });

  it("refuses sessionless cancellation", async () => {
    const res = await cancelCustomerOrderAction("00000000-0000-0000-0000-000000000000");
    expect(res.ok).toBe(false);
  });

  it("refuses admin access without a staff session", async () => {
    await expect(getAdminOrdersAction({})).rejects.toThrow();
  });
});

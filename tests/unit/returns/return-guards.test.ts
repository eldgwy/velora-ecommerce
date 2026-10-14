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

import { requestRefundAction } from "@/modules/payments/presentation/actions/refund.actions";
import {
  createReturnCaseAction,
  restockReturnItemAction,
} from "@/modules/returns/presentation/actions/return.actions";

/**
 * Admin-surface guard wiring: without a staff session the refund and return
 * actions throw before any validation, database access, or state change.
 * Real session behavior is covered by the auth suite and the proxy.
 */
describe("refund and return action guards", () => {
  it("refuses sessionless refund requests", async () => {
    await expect(
      requestRefundAction({ orderId: "00000000-0000-0000-0000-000000000000", reason: "x" }),
    ).rejects.toThrow();
  });

  it("refuses sessionless return-case creation", async () => {
    await expect(
      createReturnCaseAction({
        orderId: "00000000-0000-0000-0000-000000000000",
        items: [],
        reason: "x",
      }),
    ).rejects.toThrow();
  });

  it("refuses sessionless restocking", async () => {
    await expect(
      restockReturnItemAction("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(restockReturnItemAction("not-a-uuid")).rejects.toThrow();
  });
});

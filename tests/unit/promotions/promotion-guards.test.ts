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

import {
  createPromotionAction,
  listPromotionsAction,
  mapProductAction,
  setPromotionActiveAction,
} from "@/modules/promotions/presentation/actions/promotion-admin.actions";

/**
 * Promotion admin guard wiring: without a staff session the actions throw
 * before any validation, database access, or state change.
 */
describe("promotion admin action guards", () => {
  it("refuses sessionless list, create, map, and activation", async () => {
    await expect(listPromotionsAction({})).rejects.toThrow();
    await expect(
      createPromotionAction({ name: "X", type: "PERCENTAGE", value: "10" }),
    ).rejects.toThrow();
    await expect(
      mapProductAction({
        promotionId: "00000000-0000-0000-0000-000000000000",
        productId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
    await expect(
      setPromotionActiveAction({ id: "00000000-0000-0000-0000-000000000000", isActive: false }),
    ).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(createPromotionAction("not-an-object")).rejects.toThrow();
  });
});

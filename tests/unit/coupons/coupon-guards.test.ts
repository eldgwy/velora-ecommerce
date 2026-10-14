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
  createCouponAction,
  listCouponsAction,
  setCouponActiveAction,
} from "@/modules/coupons/presentation/actions/coupon-admin.actions";

/**
 * Coupon admin guard wiring: without a staff session the actions throw
 * before any validation, database access, or state change.
 */
describe("coupon admin action guards", () => {
  it("refuses sessionless list, create, and activation", async () => {
    await expect(listCouponsAction({})).rejects.toThrow();
    await expect(
      createCouponAction({ code: "SAVE10", type: "PERCENTAGE", value: "10" }),
    ).rejects.toThrow();
    await expect(
      setCouponActiveAction({ id: "00000000-0000-0000-0000-000000000000", isActive: false }),
    ).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(createCouponAction("not-an-object")).rejects.toThrow();
  });
});

import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import { coupons, couponUsages } from "@/infrastructure/database/schema/discounts";
import { orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  createCoupon,
  setCouponActive,
  updateCoupon,
} from "@/modules/coupons/application/commands/coupons";
import {
  getCouponDetail,
  listCoupons,
} from "@/modules/coupons/application/queries/coupons";
import {
  CouponConflictError,
  CouponNotFoundError,
  CouponValidationError,
} from "@/modules/coupons/domain/coupon-errors";

const SFX = `ca-${Date.now()}`;
const createdIds: string[] = [];
let userId = "";

async function track(id: string): Promise<string> {
  createdIds.push(id);
  return id;
}

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `ca-u-${SFX}`, name: "Coupon Admin", email: `couponadmin-${SFX}@ex.com` })
    .returning();
  userId = u.id;
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await testDb.delete(couponUsages).where(inArray(couponUsages.couponId, createdIds));
    await testDb.delete(coupons).where(inArray(coupons.id, createdIds));
  }
  await testDb.delete(user).where(eq(user.id, userId));
});

describe("coupon creation", () => {
  it("creates percentage and fixed coupons with normalized codes", async () => {
    const pct = await createCoupon({
      code: `  pct10-${SFX} `,
      type: "PERCENTAGE",
      value: "10",
      maximumDiscountAmount: "5.00",
      minimumOrderAmount: "10.00",
      usageLimit: 100,
      perUserLimit: 2,
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      isActive: true,
      actorId: "admin-1",
    });
    await track(pct.id);
    const [row] = await testDb.select().from(coupons).where(eq(coupons.id, pct.id));
    expect(row!.code).toBe(`PCT10-${SFX}`.toUpperCase());
    expect(row!.perUserLimit).toBe(2);
    expect(row!.usageCount).toBe(0);

    const fixed = await createCoupon({
      code: `fix5-${SFX}`,
      type: "FIXED",
      value: "5.00",
      actorId: "admin-1",
    });
    await track(fixed.id);
    const [frow] = await testDb.select().from(coupons).where(eq(coupons.id, fixed.id));
    expect(frow!.code).toBe(`FIX5-${SFX}`.toUpperCase());
    expect(frow!.isActive).toBe(true);
  });

  it("rejects duplicate codes including case variants", async () => {
    await track(
      (
        await createCoupon({ code: `dup-${SFX}`, type: "FIXED", value: "1.00", actorId: "admin-1" })
      ).id,
    );
    await expect(
      createCoupon({ code: `DUP-${SFX}`, type: "FIXED", value: "2.00", actorId: "admin-1" }),
    ).rejects.toBeInstanceOf(CouponConflictError);
  });

  it("rejects invalid values, limits, dates, and formats", async () => {
    const bad: Array<Parameters<typeof createCoupon>[0]> = [
      { code: "AB", type: "FIXED", value: "1.00", actorId: "a" },
      { code: "BAD CHAR", type: "FIXED", value: "1.00", actorId: "a" },
      { code: `p150-${SFX}`, type: "PERCENTAGE", value: "150", actorId: "a" },
      { code: `p0-${SFX}`, type: "PERCENTAGE", value: "0", actorId: "a" },
      { code: `f0-${SFX}`, type: "FIXED", value: "0", actorId: "a" },
      { code: `fneg-${SFX}`, type: "FIXED", value: "-5", actorId: "a" },
      { code: `f3dp-${SFX}`, type: "FIXED", value: "1.005", actorId: "a" },
      { code: `fcap-${SFX}`, type: "FIXED", value: "1.00", maximumDiscountAmount: "2.00", actorId: "a" },
      {
        code: `winv-${SFX}`,
        type: "FIXED",
        value: "1.00",
        startsAt: new Date(Date.now() + 3_600_000),
        expiresAt: new Date(Date.now() + 60_000),
        actorId: "a",
      },
      { code: `lim-${SFX}`, type: "FIXED", value: "1.00", usageLimit: -1, actorId: "a" },
    ];
    for (const input of bad) {
      await expect(createCoupon(input)).rejects.toBeInstanceOf(CouponValidationError);
    }
  });
});

describe("coupon updates and activation", () => {
  it("edits terms and blocks incoherent limits", async () => {
    const { id } = await createCoupon({
      code: `edit-${SFX}`,
      type: "PERCENTAGE",
      value: "10",
      usageLimit: 5,
      actorId: "admin-1",
    });
    await track(id);

    await updateCoupon({ id, code: `edit-${SFX}`, type: "PERCENTAGE", value: "15", usageLimit: 5, isActive: true });
    const [row] = await testDb.select().from(coupons).where(eq(coupons.id, id));
    expect(row!.value).toBe("15");

    await testDb.update(coupons).set({ usageCount: 4 }).where(eq(coupons.id, id));
    await expect(
      updateCoupon({ id, code: `edit-${SFX}`, type: "PERCENTAGE", value: "15", usageLimit: 3, isActive: true }),
    ).rejects.toThrow(/below the 4 uses/);
    await testDb.update(coupons).set({ usageCount: 0 }).where(eq(coupons.id, id));
  });

  it("rejects renames onto an existing code", async () => {
    const a = await createCoupon({ code: `rna-${SFX}`, type: "FIXED", value: "1.00", actorId: "a" });
    const b = await createCoupon({ code: `rnb-${SFX}`, type: "FIXED", value: "1.00", actorId: "a" });
    await track(a.id);
    await track(b.id);
    await expect(
      updateCoupon({ id: b.id, code: `RNA-${SFX}`, type: "FIXED", value: "1.00", isActive: true }),
    ).rejects.toBeInstanceOf(CouponConflictError);
  });

  it("toggles activation and reports missing coupons", async () => {
    const { id } = await createCoupon({ code: `tgl-${SFX}`, type: "FIXED", value: "1.00", actorId: "a" });
    await track(id);
    await setCouponActive(id, false);
    const [off] = await testDb.select().from(coupons).where(eq(coupons.id, id));
    expect(off!.isActive).toBe(false);
    await setCouponActive(id, true);
    const [on] = await testDb.select().from(coupons).where(eq(coupons.id, id));
    expect(on!.isActive).toBe(true);
    await expect(setCouponActive("00000000-0000-0000-0000-000000000000", false)).rejects.toBeInstanceOf(
      CouponNotFoundError,
    );
  });
});

describe("coupon list and detail", () => {
  it("searches, filters, and paginates", async () => {
    const now = Date.now();
    const mk = (code: string, extra: Record<string, unknown> = {}) =>
      createCoupon({ code, type: "FIXED", value: "1.00", actorId: "a", ...extra });
    const a = await mk(`lst-a-${SFX}`, { usageLimit: 1 });
    const b = await mk(`lst-b-${SFX}`, { isActive: false });
    const c = await mk(`lst-c-${SFX}`, {
      startsAt: new Date(now + 3_600_000),
      expiresAt: new Date(now + 7_200_000),
    });
    const d = await mk(`lst-d-${SFX}`, {
      startsAt: new Date(now - 7_200_000),
      expiresAt: new Date(now - 3_600_000),
    });
    for (const r of [a, b, c, d]) await track(r.id);
    await testDb.update(coupons).set({ usageCount: 1 }).where(eq(coupons.id, a.id));

    const search = await listCoupons({ query: `lst-a-${SFX}`, pageSize: 20 });
    expect(search.items.map((i) => i.code)).toEqual([`LST-A-${SFX}`.toUpperCase()]);

    expect((await listCoupons({ status: "inactive", pageSize: 50 })).items.some((i) => i.id === b.id)).toBe(true);
    expect((await listCoupons({ status: "scheduled", pageSize: 50 })).items.some((i) => i.id === c.id)).toBe(true);
    expect((await listCoupons({ status: "expired", pageSize: 50 })).items.some((i) => i.id === d.id)).toBe(true);
    expect((await listCoupons({ status: "exhausted", pageSize: 50 })).items.some((i) => i.id === a.id)).toBe(true);

    const p1 = await listCoupons({ query: `lst-`, page: 1, pageSize: 2 });
    const p2 = await listCoupons({ query: `lst-`, page: 2, pageSize: 2 });
    expect(p1.totalCount).toBeGreaterThanOrEqual(4);
    expect(p1.items.map((i) => i.id)).not.toEqual(p2.items.map((i) => i.id));
  });

  it("shows redemption history with order links", async () => {
    const { id } = await createCoupon({ code: `hist-${SFX}`, type: "FIXED", value: "1.00", actorId: "a" });
    await track(id);
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: `CA-HIST-${SFX}`,
        userId,
        status: "PENDING",
        subtotal: "20.00",
        discountAmount: "1.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "19.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();
    await testDb.insert(couponUsages).values({
      couponId: id,
      userId,
      orderId: order.id,
      discountAmount: "1.00",
      code: `HIST-${SFX}`.toUpperCase(),
      type: "FIXED",
      value: "1.00",
    });

    const detail = await getCouponDetail(id);
    expect(detail!.usages).toHaveLength(1);
    expect(detail!.usages[0]!.orderNumber).toBe(`CA-HIST-${SFX}`);
    expect(detail!.usages[0]!.discountAmount).toBe("1.00");

    await testDb.delete(couponUsages).where(eq(couponUsages.couponId, id));
    await testDb.delete(orders).where(eq(orders.id, order.id));
  });
});

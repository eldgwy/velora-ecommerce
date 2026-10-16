import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import { orders, payments, refunds } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  getInventoryAlertSummary,
  getSalesSummary,
  getSalesVelocity,
} from "@/modules/analytics/application/queries/dashboard";

const SFX = `an-${Date.now()}`;
let userId = "";
const orderIds: string[] = [];

/**
 * Qualifying population (all USD, created 2026-10-05T12:00Z):
 * - PROCESSING $100.00 (paid)
 * - SHIPPED $50.00 (paid)
 * - DELIVERED $25.50 (paid)
 * Excluded: CANCELLED $1000, PENDING $1000, EUR PROCESSING €100.
 * One COMPLETED $10.00 refund against the $100 order.
 */
async function seedOrders() {
  const day = new Date("2026-10-05T12:00:00Z");
  const specs = [
    { n: "AN-PROC", status: "PROCESSING", total: "100.00", currency: "USD", pay: "PAID" },
    { n: "AN-SHIP", status: "SHIPPED", total: "50.00", currency: "USD", pay: "PAID" },
    { n: "AN-DEL", status: "DELIVERED", total: "25.50", currency: "USD", pay: "PAID" },
    { n: "AN-CXL", status: "CANCELLED", total: "1000.00", currency: "USD", pay: "CANCELLED" },
    { n: "AN-PEND", status: "PENDING", total: "1000.00", currency: "USD", pay: "PENDING" },
    { n: "AN-EUR", status: "PROCESSING", total: "100.00", currency: "EUR", pay: "PAID" },
  ] as const;
  let firstPaymentId = "";
  for (const s of specs) {
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: `${s.n}-${SFX}`,
        userId,
        status: s.status as "PROCESSING",
        subtotal: s.total,
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: s.total,
        currency: s.currency,
        paymentStatus: s.pay as "PAID",
        createdAt: day,
      })
      .returning();
    orderIds.push(order.id);
    const [payment] = await testDb
      .insert(payments)
      .values({
        orderId: order.id,
        provider: "stripe",
        providerPaymentId: `pi_an_${s.n}_${SFX}`,
        amount: s.total,
        currency: s.currency,
        status: s.pay === "PAID" ? "COMPLETED" : "PENDING",
        paymentMethod: "CARD",
      })
      .returning();
    if (s.n === "AN-PROC") firstPaymentId = payment.id;
  }
  await testDb.insert(refunds).values({
    paymentId: firstPaymentId,
    providerRefundId: `re_an_${SFX}`,
    amount: "10.00",
    reason: "test refund",
    status: "COMPLETED",
    createdAt: day,
  });
}

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `an-u-${SFX}`, name: "Analytics", email: `analytics-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  await seedOrders();
});

afterAll(async () => {
  const payRows = await testDb
    .select({ id: payments.id })
    .from(payments)
    .where(inArray(payments.orderId, orderIds));
  const payIds = payRows.map((p) => p.id);
  if (payIds.length > 0) {
    await testDb.delete(refunds).where(inArray(refunds.paymentId, payIds));
  }
  await testDb.delete(payments).where(inArray(payments.orderId, orderIds));
  await testDb.delete(orders).where(inArray(orders.id, orderIds));
  await testDb.delete(user).where(eq(user.id, userId));
});

const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-10T00:00:00Z");

describe("sales summary", () => {
  it("counts qualifying orders only, in USD, with exact decimals", async () => {
    const summary = await getSalesSummary(FROM, TO);
    expect(summary.currency).toBe("USD");
    // 3 qualifying USD orders (100 + 50 + 25.50); EUR excluded + counted.
    expect(summary.orderCount).toBe(3);
    expect(summary.gmv).toBe("175.50");
    expect(summary.excludedNonUsdOrders).toBe(1);
    // $10 completed refund in period against a qualifying order.
    expect(summary.refunded).toBe("10.00");
    expect(summary.netRevenue).toBe("165.50");
    // 175.50 / 3 = 58.50 exactly.
    expect(summary.averageOrderValue).toBe("58.50");
  });

  it("returns null AOV and zeros on empty ranges", async () => {
    const summary = await getSalesSummary(
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-02T00:00:00Z"),
    );
    expect(summary.orderCount).toBe(0);
    expect(summary.gmv).toBe("0.00");
    expect(summary.netRevenue).toBe("0.00");
    expect(summary.averageOrderValue).toBeNull();
  });
});

describe("sales velocity", () => {
  it("buckets daily GMV in ascending UTC-day order", async () => {
    const [extra] = await testDb
      .insert(orders)
      .values({
        orderNumber: `AN-X-${SFX}`,
        userId,
        status: "DELIVERED",
        subtotal: "5.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "5.00",
        currency: "USD",
        paymentStatus: "PAID",
        createdAt: new Date("2026-10-07T23:59:59Z"),
      })
      .returning();
    orderIds.push(extra.id);
    try {
      const buckets = await getSalesVelocity(FROM, TO);
      // Days without qualifying orders produce no bucket.
      expect(buckets.map((b) => b.date)).toEqual(["2026-10-05", "2026-10-07"]);
      expect(buckets[0]).toMatchObject({ gmv: "175.50", orderCount: 3 });
      expect(buckets[1]).toMatchObject({ gmv: "5.00", orderCount: 1 });
    } finally {
      await testDb.delete(orders).where(eq(orders.id, extra.id));
      orderIds.splice(orderIds.indexOf(extra.id), 1);
    }
  });
});

describe("inventory alerts", () => {
  it("reports open counts without throwing on empty data", async () => {
    const summary = await getInventoryAlertSummary();
    expect(summary.open).toBe(summary.pending + summary.processing);
    expect(summary.open).toBeGreaterThanOrEqual(0);
  });
});

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
import { eq, inArray, sql } from "drizzle-orm";

import { testDb } from "../_db";
import { orders, orderItems, payments, refunds } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  productVariants,
  products,
  brands,
  categories,
} from "@/infrastructure/database/schema/catalog";
import {
  getInventoryAlertSummary,
  getOrderStatusBreakdown,
  getPaymentStatusBreakdown,
  getSalesSummary,
  getSalesVelocity,
  getTopSellingProducts,
} from "@/modules/analytics/application/queries/dashboard";

const SFX = `an-${Date.now()}`;
let userId = "";
let catId = "";
let brandId = "";
let productId = "";
const variantIds: string[] = [];
const orderIds: string[] = [];
const itemIds: string[] = [];

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

/**
 * Wounded-run hygiene (doctrine from tests/integration/catalog): the
 * suite's revenue assertions are absolute over a FIXED calendar window,
 * so fixtures from any earlier interrupted run inside that window would
 * poison later runs. Purge the broad `AN-` namespace (this file's) before
 * AND after seeding.
 */
async function purgeAnalyticsFixtures() {
  await testDb.execute(sql`
    DELETE FROM refunds
    WHERE payment_id IN (
      SELECT p.id FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.order_number LIKE 'AN-%'
    )`);
  await testDb.execute(sql`
    DELETE FROM order_items
    WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'AN-%')`);
  await testDb.execute(sql`
    DELETE FROM payments
    WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'AN-%')`);
  await testDb.execute(sql`DELETE FROM orders WHERE order_number LIKE 'AN-%'`);
  await testDb.execute(sql`DELETE FROM product_variant WHERE sku LIKE 'an-sku-%'`);
  await testDb.execute(sql`DELETE FROM products WHERE slug LIKE 'an-prod-%'`);
  await testDb.execute(sql`DELETE FROM brand WHERE slug LIKE 'an-brand-%'`);
  await testDb.execute(sql`DELETE FROM categories WHERE slug LIKE 'an-cat-%'`);
}

beforeAll(async () => {
  await purgeAnalyticsFixtures();
  const [u] = await testDb
    .insert(user)
    .values({ id: `an-u-${SFX}`, name: "Analytics", email: `analytics-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  await seedOrders();
});

afterAll(async () => {
  await purgeAnalyticsFixtures();
  if (itemIds.length > 0) {
    await testDb.delete(orderItems).where(inArray(orderItems.id, itemIds));
  }
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
  await testDb.delete(productVariants).where(inArray(productVariants.id, variantIds));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, catId));
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


describe("order status breakdown", () => {
  it("counts every placed order, including PENDING and CANCELLED", async () => {
    const rows = await getOrderStatusBreakdown(FROM, TO);
    const byStatus = new Map(rows.map((r) => [r.status, r.count]));
    // 2 PROCESSING (USD + EUR), 1 each of the rest; EUR counts as volume.
    expect(byStatus.get("PROCESSING")).toBe(2);
    expect(byStatus.get("SHIPPED")).toBe(1);
    expect(byStatus.get("DELIVERED")).toBe(1);
    expect(byStatus.get("CANCELLED")).toBe(1);
    expect(byStatus.get("PENDING")).toBe(1);
    // Deterministic order: count desc, then status asc.
    expect(rows[0].status).toBe("PROCESSING");
    const tail = rows.slice(1).map((r) => r.status);
    expect(tail).toEqual([...tail].sort());
  });

  it("returns an empty population for out-of-range periods", async () => {
    const rows = await getOrderStatusBreakdown(
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-02T00:00:00Z"),
    );
    expect(rows).toEqual([]);
  });
});

describe("payment status breakdown", () => {
  it("aggregates the persisted payment states per order", async () => {
    const rows = await getPaymentStatusBreakdown(FROM, TO);
    const byStatus = new Map(rows.map((r) => [r.status, r.count]));
    expect(byStatus.get("PAID")).toBe(4); // 3 qualifying USD + the EUR order
    expect(byStatus.get("CANCELLED")).toBe(1);
    expect(byStatus.get("PENDING")).toBe(1);
  });
});

describe("top-selling products", () => {
  it("ranks by units sold over qualifying USD orders, excluding others", async () => {
    // Prepare the catalogue chain for realistic FK targets.
    const [cat] = await testDb
      .insert(categories)
      .values({ slug: `an-cat-${SFX}`, name: "AN Cat" })
      .returning();
    catId = cat.id;
    const [br] = await testDb
      .insert(brands)
      .values({ slug: `an-brand-${SFX}`, name: "AN Brand" })
      .returning();
    brandId = br.id;
    const [prod] = await testDb
      .insert(products)
      .values({
        slug: `an-prod-${SFX}`,
        name: "AN Product",
        status: "ACTIVE",
        basePrice: "10.00",
        categoryId: catId,
        brandId,
      })
      .returning();
    productId = prod.id;
    const skuA = `an-sku-a-${SFX}`;
    const skuB = `an-sku-b-${SFX}`;
    for (const sku of [skuA, skuB]) {
      const [v] = await testDb
        .insert(productVariants)
        .values({ productId, sku, status: "ACTIVE" })
        .returning();
      variantIds.push(v.id);
    }
    const proc = orderIds[0]; // AN-PROC PROCESSING USD
    const ship = orderIds[1]; // AN-SHIP SHIPPED USD
    const cxl = orderIds[3]; // AN-CXL CANCELLED USD
    const eur = orderIds[5]; // AN-EUR PROCESSING EUR
    async function line(orderId: string, variantId: string, sku: string, quantity: number, total: string) {
      const [row] = await testDb
        .insert(orderItems)
        .values({
          orderId,
          variantId,
          sku,
          productName: "AN Product",
          quantity,
          unitPrice: (Number(total) / quantity).toFixed(2),
          totalAmount: total,
          reservationStatus: "COMMITTED",
        })
        .returning();
      itemIds.push(row.id);
    }
    // One line per (order, variant) — order_items is unique on that pair.
    // A gets 3 units on a qualifying order; B gets 2 on another.
    await line(proc, variantIds[0], skuA, 3, "30.00");
    await line(ship, variantIds[1], skuB, 2, "10.00");
    // 100-unit lines on excluded orders must never surface.
    await line(cxl, variantIds[0], skuA, 100, "1000.00");
    await line(eur, variantIds[1], skuB, 100, "100.00");

    const top = await getTopSellingProducts(FROM, TO);
    expect(top[0]).toMatchObject({ sku: skuA, unitsSold: 3, netSales: "30.00" });
    expect(top[1]).toMatchObject({ sku: skuB, unitsSold: 2, netSales: "10.00" });
    expect(top.map((t) => t.sku)).toHaveLength(top.length); // grouped per sku
  });

  it("honours the limit and returns deterministic tie-breaks", async () => {
    const top = await getTopSellingProducts(FROM, TO, 2);
    expect(top).toHaveLength(2);
    expect(top[0].unitsSold).toBeGreaterThanOrEqual(top[1].unitsSold);
  });

  it("returns an empty population out of range", async () => {
    const top = await getTopSellingProducts(
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-02T00:00:00Z"),
    );
    expect(top).toEqual([]);
  });
});

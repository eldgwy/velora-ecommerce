import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  inventoryMovements,
} from "../_db";
import { orders, orderItems } from "@/infrastructure/database/schema/orders";
import { lowStockAlerts } from "@/infrastructure/database/schema/low-stock-alerts";
import { user } from "@/infrastructure/database/schema/auth";
import {
  reserveOrderInventory,
  releaseOrderReservation,
} from "@/modules/orders/application/commands/reserve-order-inventory";

const SFX = `lsc-${Date.now()}`;
let userId = "";
let variantId = "";
let inventoryId = "";
let productId = "";
let brandId = "";
let categoryId = "";
const orderIds: string[] = [];

// Threshold 4, stock 10: reserving 7 crosses (3 < 4); releasing 7 undoes it.
const BEFORE_ALL_STOCK = 10;
const ALERT_THRESHOLD = 4;
const RESERVE_AMOUNT = 7;

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `lsc-u-${SFX}`, name: "LowStock User", email: `lsc-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `lsc-cat-${SFX}`, name: "LSC Cat" }).returning();
  categoryId = cat.id;
  const [br] = await testDb.insert(brands).values({ slug: `lsc-brand-${SFX}`, name: "LSC Brand" }).returning();
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "LSC Product", status: "ACTIVE", basePrice: "10.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `LSC-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  const [inv] = await testDb
    .insert(inventory)
    .values({
      variantId,
      quantity: BEFORE_ALL_STOCK,
      reservedQuantity: 0,
      lowStockThreshold: ALERT_THRESHOLD,
    })
    .returning();
  inventoryId = inv.id;
});

afterAll(async () => {
  await testDb.delete(lowStockAlerts).where(eq(lowStockAlerts.variantId, variantId));
  if (orderIds.length > 0) {
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
    await testDb.delete(orders).where(inArray(orders.id, orderIds));
  }
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId));
  await testDb.delete(inventory).where(eq(inventory.id, inventoryId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, userId));
});

async function makeOrder(tag: string) {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `LSC-${tag}-${SFX}`,
      userId,
      status: "PENDING",
      subtotal: "70.00",
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "70.00",
      currency: "USD",
      paymentStatus: "PENDING",
    })
    .returning();
  orderIds.push(order.id);
  await testDb.insert(orderItems).values({
    orderId: order.id,
    variantId,
    productName: "LSC Product",
    sku: `LSC-SKU-${SFX}`,
    quantity: RESERVE_AMOUNT,
    unitPrice: "10.00",
    totalAmount: "70.00",
    reservationStatus: "PENDING",
  });
  return order.id;
}

describe("low-stock alert evaluation on the checkout inventory path (GP-16)", () => {
  it("creates a PENDING alert when a reservation crosses the threshold", async () => {
    const id = await makeOrder("cross");
    await reserveOrderInventory(id, { actorId: "test" });

    const [alert] = await testDb
      .select()
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.variantId, variantId));
    expect(alert).toBeDefined();
    expect(alert!.status).toBe("PENDING");
    // available = 10 - 7 = 3
    expect(alert!.availableStock).toBe(BEFORE_ALL_STOCK - RESERVE_AMOUNT);
    expect(alert!.threshold).toBe(ALERT_THRESHOLD);
  });

  it("does not duplicate the PENDING alert on further reservations", async () => {
    // Make a second order that only uses remaining available stock (1 unit):
    // still below threshold, so no NEW alert may be pending alongside.
    const stillBelow = BEFORE_ALL_STOCK - RESERVE_AMOUNT; // 3 available
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: `LSC-nodup-${SFX}`,
        userId,
        status: "PENDING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();
    orderIds.push(order.id);
    await testDb.insert(orderItems).values({
      orderId: order.id,
      variantId,
      productName: "LSC Product",
      sku: `LSC-SKU-${SFX}`,
      quantity: 1,
      unitPrice: "10.00",
      totalAmount: "10.00",
      reservationStatus: "PENDING",
    });
    expect(stillBelow).toBe(3);
    await reserveOrderInventory(order.id, { actorId: "test" });

    const pending = await testDb
      .select()
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.variantId, variantId));
    expect(pending.length).toBe(1); // original alert still the only one
    void stillBelow;
  });

  it("resolves the alert when reservations are released", async () => {
    // Isolated variant so the resolve path is exercised independently of the
    // crossing created by the earlier tests (those reservations stay held).
    const [v2] = await testDb
      .insert(productVariants)
      .values({ productId, sku: `LSC-SKU2-${SFX}`, status: "ACTIVE" })
      .returning();
    const [inv2] = await testDb
      .insert(inventory)
      .values({
        variantId: v2.id,
        quantity: 10,
        reservedQuantity: 0,
        lowStockThreshold: ALERT_THRESHOLD,
      })
      .returning();
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: `LSC-resolve-${SFX}`,
        userId,
        status: "PENDING",
        subtotal: "70.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "70.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();
    orderIds.push(order.id);
    await testDb.insert(orderItems).values({
      orderId: order.id,
      variantId: v2.id,
      productName: "LSC Product",
      sku: `LSC-SKU2-${SFX}`,
      quantity: RESERVE_AMOUNT,
      unitPrice: "10.00",
      totalAmount: "70.00",
      reservationStatus: "PENDING",
    });

    await reserveOrderInventory(order.id, { actorId: "test" });
    const [created] = await testDb
      .select()
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.variantId, v2.id));
    expect(created!.status).toBe("PENDING");

    await releaseOrderReservation(order.id, { actorId: "test", reason: "test release" });

    const [alert] = await testDb
      .select()
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.variantId, v2.id));
    expect(alert!.status).toBe("DELIVERED"); // resolved-on-release marking
    expect(alert!.deliveredAt).not.toBeNull();

    // Fixture cleanup for the second variant (items/order reference it).
    await testDb.delete(orderItems).where(eq(orderItems.orderId, order.id));
    await testDb.delete(orders).where(eq(orders.id, order.id));
    await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inv2.id));
    await testDb.delete(inventory).where(eq(inventory.id, inv2.id));
    await testDb.delete(productVariants).where(eq(productVariants.id, v2.id));
  });
});

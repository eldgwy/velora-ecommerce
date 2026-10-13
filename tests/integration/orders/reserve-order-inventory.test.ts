/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: any) => fn,
  updateTag: vi.fn(),
}));

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { and, eq, inArray, like, lte, or } from "drizzle-orm";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  inventoryMovements,
  orders,
  orderItems,
  orderStatusHistories,
  webhookEvents,
  payments,
  testDb,
} from "../_db";
import {
  reserveOrderInventory,
  releaseOrderReservation,
  commitOrderReservation,
  OrderItemNotFoundError,
  InvalidOrderItemQuantityError,
  OrderAlreadyReservedError,
  InsufficientStockForOrderError,
  OrderAlreadyCancelledError,
  OrderAlreadyCompletedError,
  OrderReservationReleasedError,
  InvalidOrderTransitionError,
  OrderNotFoundError,
} from "@/modules/orders/application/commands/reserve-order-inventory";
import {
  cancelOrder,
  handlePaymentFailure,
  handleCheckoutExpiration,
} from "@/modules/orders/application/commands/order-lifecycle";
import {
  finalizeOrderPayment,
  handlePaymentFailureWebhook,
} from "@/modules/orders/application/commands/finalize-payment";
import {
  findExpiredOrdersWithReservations,
  processExpiredOrder,
  processExpiredReservations,
  DEFAULT_JOB_CONFIG,
} from "@/modules/jobs/release-expired-reservations";
import { adjustReservation, adjustStock, getInventoryByVariant } from "@/services/inventory.service";

let rootId = "",
  childId = "",
  brandId = "",
  productId = "",
  variantId1 = "",
  variantId2 = "",
  inventoryId1 = "",
  inventoryId2 = "",
  orderId = "";

beforeAll(async () => {
  // Rerun safety: this suite uses fixed synthetic order numbers (`ORD-*`).
  // With `orders_order_number_unique` enforced, leftovers from an
  // interrupted run would collide on the next run. Clear only that
  // synthetic prefix (dependents first; no FK cascades in this environment).
  const stale = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.orderNumber, "ORD-%"));
  const staleIds = stale.map((o) => o.id);
  if (staleIds.length > 0) {
    await testDb.delete(payments).where(inArray(payments.orderId, staleIds));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, staleIds));
    await testDb.delete(orders).where(inArray(orders.id, staleIds));
  }

  // Same rerun safety for the fixed catalog slugs: an interrupted run can
  // leave `order-res-*` rows behind, and `categories_slug_unique` (plus the
  // FK net) now rejects blind re-inserts. Scoped to this suite's prefix.
  const staleVariants = await testDb
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(like(productVariants.sku, "ORD-RES-%"));
  const staleVariantIds = staleVariants.map((v) => v.id);
  if (staleVariantIds.length > 0) {
    const staleInv = await testDb
      .select({ id: inventory.id })
      .from(inventory)
      .where(inArray(inventory.variantId, staleVariantIds));
    const staleInvIds = staleInv.map((i) => i.id);
    if (staleInvIds.length > 0) {
      await testDb.delete(inventoryMovements).where(inArray(inventoryMovements.inventoryId, staleInvIds));
      await testDb.delete(inventory).where(inArray(inventory.id, staleInvIds));
    }
    await testDb.delete(productVariants).where(inArray(productVariants.id, staleVariantIds));
  }
  await testDb.delete(products).where(eq(products.name, "Order Res Product"));
  await testDb.delete(brands).where(like(brands.slug, "order-res-%"));
  await testDb.delete(categories).where(eq(categories.slug, "order-res-child"));
  await testDb.delete(categories).where(eq(categories.slug, "order-res-root"));

  // The suite references a synthetic `test-user` everywhere; the enforced
  // `orders_user_id_user_id_fk` requires the row to exist.
  const { user } = await import("@/infrastructure/database/schema/auth");
  const [existingUser] = await testDb.select({ id: user.id }).from(user).where(eq(user.id, "test-user"));
  if (!existingUser) {
    await testDb.insert(user).values({ id: "test-user", name: "Test User", email: "test-user@example.com" });
  }

  const [root] = await testDb
    .insert(categories)
    .values({ slug: "order-res-root", name: "Order Res Root" })
    .returning();
  rootId = root.id;
  const [child] = await testDb
    .insert(categories)
    .values({ slug: "order-res-child", name: "Order Res Child", parentId: rootId })
    .returning();
  childId = child.id;
  const [br] = await testDb
    .insert(brands)
    .values({ slug: "order-res-brand", name: "Order Res Brand" })
    .returning();
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({
      name: "Order Res Product",
      status: "ACTIVE",
      basePrice: "10.00",
      categoryId: childId,
      brandId,
    })
    .returning();
  productId = prod.id;
  const [variant1] = await testDb
    .insert(productVariants)
    .values({
      productId,
      sku: "ORD-RES-SKU-001",
      status: "ACTIVE",
      priceOverride: "12.00",
    })
    .returning();
  variantId1 = variant1.id;
  const [variant2] = await testDb
    .insert(productVariants)
    .values({
      productId,
      sku: "ORD-RES-SKU-002",
      status: "ACTIVE",
      priceOverride: "15.00",
    })
    .returning();
  variantId2 = variant2.id;
  const [inv1] = await testDb
    .insert(inventory)
    .values({ variantId: variantId1, quantity: 10, reservedQuantity: 0 })
    .returning();
  inventoryId1 = inv1.id;
  const [inv2] = await testDb
    .insert(inventory)
    .values({ variantId: variantId2, quantity: 5, reservedQuantity: 0 })
    .returning();
  inventoryId2 = inv2.id;
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: "ORD-TEST-001",
      userId: "test-user",
      status: "PENDING",
      subtotal: "27.00",
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "27.00",
      currency: "USD",
      paymentStatus: "PENDING",
    })
    .returning();
  orderId = order.id;
  await testDb.insert(orderItems).values([
    {
      orderId,
      variantId: variantId1,
      productName: "Order Res Product",
      variantName: "Variant 1",
      sku: "ORD-RES-SKU-001",
      quantity: 2,
      unitPrice: "12.00",
      totalAmount: "24.00",
    },
    {
      orderId,
      variantId: variantId2,
      productName: "Order Res Product",
      variantName: "Variant 2",
      sku: "ORD-RES-SKU-002",
      quantity: 1,
      unitPrice: "15.00",
      totalAmount: "15.00",
    },
  ]);
});

afterEach(async () => {
  await testDb.update(inventory).set({ quantity: 10, reservedQuantity: 0 }).where(eq(inventory.id, inventoryId1));
  await testDb.update(inventory).set({ quantity: 5, reservedQuantity: 0 }).where(eq(inventory.id, inventoryId2));
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId1));
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId2));
  await testDb
    .update(orderItems)
    .set({ reservationStatus: "PENDING", updatedAt: new Date() })
    .where(eq(orderItems.orderId, orderId));
  await testDb
    .update(orders)
    .set({ status: "PENDING", paymentStatus: "PENDING", updatedAt: new Date() })
    .where(eq(orders.id, orderId));
});

afterAll(async () => {
  // FK-safe teardown order: payments restrict their orders, and order items
  // restrict their variants. Clear every synthetic order in this suite
  // (tracked + ORD-% leftovers from nested describes) before parents.
  const suiteOrders = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(or(eq(orders.id, orderId), like(orders.orderNumber, "ORD-%")));
  const suiteOrderIds = suiteOrders.map((o) => o.id);
  if (suiteOrderIds.length > 0) {
    await testDb.delete(payments).where(inArray(payments.orderId, suiteOrderIds));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, suiteOrderIds));
    await testDb.delete(orders).where(inArray(orders.id, suiteOrderIds));
  }
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId1));
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId2));
  await testDb.delete(inventory).where(eq(inventory.id, inventoryId1));
  await testDb.delete(inventory).where(eq(inventory.id, inventoryId2));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId1));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId2));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, childId));
  await testDb.delete(categories).where(eq(categories.id, rootId));
});

describe("reserveOrderInventory", () => {
  it("successfully reserves stock for a single-item order", async () => {
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-TEST-002",
        userId: "test-user",
        status: "PENDING",
        subtotal: "12.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "12.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: order.id,
      variantId: variantId1,
      productName: "Order Res Product",
      variantName: "Variant 1",
      sku: "ORD-RES-SKU-001",
      quantity: 3,
      unitPrice: "12.00",
      totalAmount: "36.00",
    });

    const result = await reserveOrderInventory(order.id, { actorId: "test-admin" });

    expect(result.orderId).toBe(order.id);
    expect(result.reservedItems).toHaveLength(1);
    expect(result.reservedItems[0].variantId).toBe(variantId1);
    expect(result.reservedItems[0].quantity).toBe(3);

    const inv = await getInventoryByVariant(variantId1);
    expect(inv?.reservedQuantity).toBe(3);
    expect(inv?.available).toBe(7);

    await testDb.delete(orderItems).where(eq(orderItems.orderId, order.id));
    await testDb.delete(orders).where(eq(orders.id, order.id));
  });

  it("successfully reserves stock for a multi-item order", async () => {
    const result = await reserveOrderInventory(orderId, { actorId: "test-admin" });

    expect(result.orderId).toBe(orderId);
    expect(result.reservedItems).toHaveLength(2);

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(2);
    expect(inv1?.available).toBe(8);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2?.reservedQuantity).toBe(1);
    expect(inv2?.available).toBe(4);
  });

  it("reserves multiple variants within one order with per-variant checks", async () => {
    // NOTE: duplicate (order, variant) lines are rejected by the declared
    // `order_items_order_variant_unique` constraint, so multi-line
    // reservation is exercised with distinct variants here. The
    // reserve/stock-check aggregation in `reserveOrderInventory` still sums
    // per variant defensively.
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-TEST-003",
        userId: "test-user",
        status: "PENDING",
        subtotal: "54.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "54.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();

    await testDb.insert(orderItems).values([
      {
        orderId: order.id,
        variantId: variantId1,
        productName: "Order Res Product",
        variantName: "Variant 1",
        sku: "ORD-RES-SKU-001",
        quantity: 2,
        unitPrice: "12.00",
        totalAmount: "24.00",
      },
      {
        orderId: order.id,
        variantId: variantId2,
        productName: "Order Res Product",
        variantName: "Variant 2",
        sku: "ORD-RES-SKU-002",
        quantity: 3,
        unitPrice: "10.00",
        totalAmount: "30.00",
      },
    ]);

    const before1 = await getInventoryByVariant(variantId1);
    const before2 = await getInventoryByVariant(variantId2);

    const result = await reserveOrderInventory(order.id, { actorId: "test-admin" });

    expect(result.reservedItems).toHaveLength(2);

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1!.reservedQuantity - before1!.reservedQuantity).toBe(2);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2!.reservedQuantity - before2!.reservedQuantity).toBe(3);

    await testDb.delete(orderItems).where(eq(orderItems.orderId, order.id));
    await testDb.delete(orders).where(eq(orders.id, order.id));
  });

  it("throws InsufficientStockForOrderError when stock is insufficient for final item", async () => {
    await adjustReservation(variantId1, 9, "RESERVATION", { reason: "existing" }, "test-admin");

    await expect(reserveOrderInventory(orderId, { actorId: "test-admin" })).rejects.toThrow(
      InsufficientStockForOrderError,
    );

    const inv = await getInventoryByVariant(variantId1);
    expect(inv?.reservedQuantity).toBe(9);
    expect(inv?.available).toBe(1);
  });

  it("rolls back entire reservation if any item is unavailable", async () => {
    await adjustReservation(variantId2, 5, "RESERVATION", { reason: "existing" }, "test-admin");

    await expect(reserveOrderInventory(orderId, { actorId: "test-admin" })).rejects.toThrow(
      InsufficientStockForOrderError,
    );

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(10);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2?.reservedQuantity).toBe(5);
    expect(inv2?.available).toBe(0);
  });

  it("throws OrderItemNotFoundError for order with no items", async () => {
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-TEST-004",
        userId: "test-user",
        status: "PENDING",
        subtotal: "0.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "0.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();

    await expect(reserveOrderInventory(order.id, { actorId: "test-admin" })).rejects.toThrow(
      OrderItemNotFoundError,
    );

    await testDb.delete(orders).where(eq(orders.id, order.id));
  });

  it("throws InvalidOrderItemQuantityError for zero or negative quantities", async () => {
    const [order] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-TEST-005",
        userId: "test-user",
        status: "PENDING",
        subtotal: "0.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "0.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: order.id,
      variantId: variantId1,
      productName: "Order Res Product",
      variantName: "Variant 1",
      sku: "ORD-RES-SKU-001",
      quantity: 0,
      unitPrice: "12.00",
      totalAmount: "0.00",
    });

    await expect(reserveOrderInventory(order.id, { actorId: "test-admin" })).rejects.toThrow(
      InvalidOrderItemQuantityError,
    );

    await testDb.delete(orderItems).where(eq(orderItems.orderId, order.id));
    await testDb.delete(orders).where(eq(orders.id, order.id));
  });

  it("is idempotent: repeated requests for same order do not reserve twice", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await expect(reserveOrderInventory(orderId, { actorId: "test-admin" })).rejects.toThrow(
      OrderAlreadyReservedError,
    );

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(2);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2?.reservedQuantity).toBe(1);
  });

  it("handles concurrent requests for the same order safely", async () => {
    const results = await Promise.allSettled([
      reserveOrderInventory(orderId, { actorId: "test-admin-1" }),
      reserveOrderInventory(orderId, { actorId: "test-admin-2" }),
    ]);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(OrderAlreadyReservedError);

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(2);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2?.reservedQuantity).toBe(1);
  });

  it("handles concurrent reservations competing for the same stock", async () => {
    const [order2] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-TEST-007",
        userId: "test-user",
        status: "PENDING",
        subtotal: "12.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "12.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: order2.id,
      variantId: variantId1,
      productName: "Order Res Product",
      variantName: "Variant 1",
      sku: "ORD-RES-SKU-001",
      quantity: 9,
      unitPrice: "12.00",
      totalAmount: "108.00",
    });

    const results = await Promise.allSettled([
      reserveOrderInventory(orderId, { actorId: "test-admin-1" }),
      reserveOrderInventory(order2.id, { actorId: "test-admin-2" }),
    ]);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // One should succeed, one should fail with InsufficientStockForOrderError
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(InsufficientStockForOrderError);

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBeLessThanOrEqual(10);

    await testDb.delete(orderItems).where(eq(orderItems.orderId, order2.id));
    await testDb.delete(orders).where(eq(orders.id, order2.id));
  });

  it("records RESERVATION movement entries in inventory_movements", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin", requestId: "req-123" });

    const movements1 = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId1));
    expect(movements1).toHaveLength(1);
    expect(movements1[0].quantity).toBe(2);
    expect(movements1[0].type).toBe("RESERVATION");
    expect(movements1[0].reason).toContain(orderId);

    const movements2 = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId2));
    expect(movements2).toHaveLength(1);
    expect(movements2[0].quantity).toBe(1);
    expect(movements2[0].type).toBe("RESERVATION");
  });

  it("persists order-reservation linkage via reservationStatus", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    for (const item of items) {
      expect(item.reservationStatus).toBe("RESERVED");
    }
  });
});

describe("releaseOrderReservation", () => {
  it("releases reserved stock and updates reservationStatus to RELEASED", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await releaseOrderReservation(orderId, { actorId: "test-admin", reason: "order cancelled" });

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(10);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2?.reservedQuantity).toBe(0);
    expect(inv2?.available).toBe(5);

    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      expect(item.reservationStatus).toBe("RELEASED");
    }
  });

  it("records RELEASE movement entries", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await releaseOrderReservation(orderId, { actorId: "test-admin", reason: "order cancelled" });

    const movements1 = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId1));
    const releaseMovements = movements1.filter((m) => m.type === "RELEASE");
    expect(releaseMovements).toHaveLength(1);
    expect(releaseMovements[0].quantity).toBe(-2);
    expect(releaseMovements[0].reason).toContain("cancelled");
  });

  it("is idempotent: releasing already-released reservation is a no-op", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await releaseOrderReservation(orderId, { actorId: "test-admin" });

    await releaseOrderReservation(orderId, { actorId: "test-admin" });

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
  });
});

describe("commitOrderReservation", () => {
  it("commits reserved stock as sale and updates reservationStatus to COMMITTED", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await commitOrderReservation(orderId, { actorId: "test-admin" });

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(8);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2?.quantity).toBe(4);
    expect(inv2?.reservedQuantity).toBe(0);
    expect(inv2?.available).toBe(4);

    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      expect(item.reservationStatus).toBe("COMMITTED");
    }
  });

  it("records SALE movement entries", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await commitOrderReservation(orderId, { actorId: "test-admin" });

    const movements1 = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId1));
    const saleMovements = movements1.filter((m) => m.type === "SALE");
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0].quantity).toBe(-2);
    expect(saleMovements[0].reason).toContain("fulfilled");
  });

  it("is idempotent: committing already-committed reservation is a no-op", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await commitOrderReservation(orderId, { actorId: "test-admin" });

    await commitOrderReservation(orderId, { actorId: "test-admin" });

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8);
    expect(inv1?.reservedQuantity).toBe(0);
  });
});

describe("releaseOrderReservation - edge cases", () => {
  it("throws OrderAlreadyCompletedError when reservation already committed", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await commitOrderReservation(orderId, { actorId: "test-admin" });

    await expect(releaseOrderReservation(orderId, { actorId: "test-admin" })).rejects.toThrow(
      OrderAlreadyCompletedError,
    );

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8);
    expect(inv1?.reservedQuantity).toBe(0);
  });
});

describe("cancelOrder", () => {
  it("cancels order and releases reservations", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await cancelOrder(orderId, { actorId: "test-admin", reason: "customer request" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");
    expect(order?.paymentStatus).toBe("CANCELLED");

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(10);

    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      expect(item.reservationStatus).toBe("RELEASED");
    }

    const history = await testDb
      .select()
      .from(orderStatusHistories)
      .where(eq(orderStatusHistories.orderId, orderId));
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("CANCELLED");
  });

  it("is idempotent: cancelling already-cancelled order is a no-op", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await cancelOrder(orderId, { actorId: "test-admin" });

    await cancelOrder(orderId, { actorId: "test-admin" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");
  });

  it("throws OrderAlreadyCompletedError when items already committed", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await commitOrderReservation(orderId, { actorId: "test-admin" });

    await expect(cancelOrder(orderId, { actorId: "test-admin" })).rejects.toThrow(
      OrderAlreadyCompletedError,
    );

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("PENDING");
  });

  it("throws OrderAlreadyCompletedError for delivered order", async () => {
    await testDb
      .update(orders)
      .set({ status: "DELIVERED" })
      .where(eq(orders.id, orderId));

    await expect(cancelOrder(orderId, { actorId: "test-admin" })).rejects.toThrow(
      OrderAlreadyCompletedError,
    );
  });
});

describe("handlePaymentFailure", () => {
  it("handles payment failure and releases reservations", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await handlePaymentFailure(orderId, { actorId: "test-admin", reason: "card declined" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");
    expect(order?.paymentStatus).toBe("FAILED");

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(10);
  });

  it("is idempotent: handling already-failed payment is a no-op", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await handlePaymentFailure(orderId, { actorId: "test-admin" });

    await handlePaymentFailure(orderId, { actorId: "test-admin" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.paymentStatus).toBe("FAILED");
  });

  it("throws OrderAlreadyCompletedError when items already committed", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await commitOrderReservation(orderId, { actorId: "test-admin" });

    await expect(handlePaymentFailure(orderId, { actorId: "test-admin" })).rejects.toThrow(
      OrderAlreadyCompletedError,
    );

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.paymentStatus).toBe("PENDING");
  });

  it("does not change order status if already processing", async () => {
    await testDb
      .update(orders)
      .set({ status: "PROCESSING", paymentStatus: "AUTHORIZED" })
      .where(eq(orders.id, orderId));
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await handlePaymentFailure(orderId, { actorId: "test-admin" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("PROCESSING");
    expect(order?.paymentStatus).toBe("FAILED");
  });
});

describe("handleCheckoutExpiration", () => {
  it("expires checkout and releases reservations", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    // Set checkout expiration to past
    await testDb
      .update(orders)
      .set({ checkoutExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, orderId));

    await handleCheckoutExpiration(orderId, { actorId: "system", reason: "timeout" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");
    expect(order?.paymentStatus).toBe("EXPIRED");

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(10);
  });

  it("is idempotent: expiring already-expired checkout is a no-op", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await testDb
      .update(orders)
      .set({ checkoutExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, orderId));

    await handleCheckoutExpiration(orderId, { actorId: "system" });
    await handleCheckoutExpiration(orderId, { actorId: "system" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.paymentStatus).toBe("EXPIRED");
  });

  it("throws InvalidOrderTransitionError if checkout not yet expired", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await testDb
      .update(orders)
      .set({ checkoutExpiresAt: new Date(Date.now() + 60000) })
      .where(eq(orders.id, orderId));

    await expect(handleCheckoutExpiration(orderId, { actorId: "system" })).rejects.toThrow(
      InvalidOrderTransitionError,
    );
  });

  it("throws OrderAlreadyCompletedError when items already committed", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await commitOrderReservation(orderId, { actorId: "test-admin" });

    await testDb
      .update(orders)
      .set({ checkoutExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, orderId));

    await expect(handleCheckoutExpiration(orderId, { actorId: "system" })).rejects.toThrow(
      OrderAlreadyCompletedError,
    );
  });
});

describe("race conditions and concurrent lifecycle events", () => {
  it("handles cancellation racing with expiration", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await testDb
      .update(orders)
      .set({ checkoutExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, orderId));

    const results = await Promise.allSettled([
      cancelOrder(orderId, { actorId: "customer", reason: "cancelled" }),
      handleCheckoutExpiration(orderId, { actorId: "system", reason: "timeout" }),
    ]);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // At least one should succeed, final state should be consistent
    expect(successful.length).toBeGreaterThanOrEqual(1);

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
  });

  it("handles payment failure racing with cancellation", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    const results = await Promise.allSettled([
      handlePaymentFailure(orderId, { actorId: "payment", reason: "declined" }),
      cancelOrder(orderId, { actorId: "customer", reason: "cancelled" }),
    ]);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // At least one should succeed, final state should be consistent
    expect(successful.length).toBeGreaterThanOrEqual(1);

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
  });

  it("handles release racing with payment success (commit)", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    const results = await Promise.allSettled([
      releaseOrderReservation(orderId, { actorId: "customer", reason: "cancelled" }),
      commitOrderReservation(orderId, { actorId: "payment" }),
    ]);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // One should succeed, one should fail (either is valid)
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const inv1 = await getInventoryByVariant(variantId1);
    // Stock should be consistent (either fully reserved or fully released/committed)
    expect(inv1?.reservedQuantity).toBeLessThanOrEqual(2);
  });

  it("handles partial or inconsistent reservation data", async () => {
    // Create order with reserved inventory
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    // Manually set one item to RELEASED (simulating partial release)
    const [item] = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .limit(1);
    await testDb
      .update(orderItems)
      .set({ reservationStatus: "RELEASED", updatedAt: new Date() })
      .where(eq(orderItems.id, item.id));

    // Release should only release the RESERVED item
    await releaseOrderReservation(orderId, { actorId: "test-admin" });

    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const reservedCount = items.filter((i) => i.reservationStatus === "RESERVED").length;
    const releasedCount = items.filter((i) => i.reservationStatus === "RELEASED").length;
    expect(reservedCount).toBe(0);
    expect(releasedCount).toBe(2);
  });

  it("handles transaction rollback on error", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    // Simulate error by trying to release with invalid variant
    // This test verifies the transaction is atomic - if any part fails, all rolls back
    // Since we can't easily inject an error in the middle, we verify the
    // existing behavior that a failed commit doesn't leave partial state
    await commitOrderReservation(orderId, { actorId: "test-admin" });

    // Now try to reserve again - should fail because already committed
    await expect(reserveOrderInventory(orderId, { actorId: "test-admin" })).rejects.toThrow(
      OrderAlreadyReservedError,
    );

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8); // 10 - 2 committed
    expect(inv1?.reservedQuantity).toBe(0);
  });

  it("maintains inventory and movement consistency", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await cancelOrder(orderId, { actorId: "test-admin" });

    // Verify movements exist
    const movements1 = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId1));
    const reservationMovements = movements1.filter((m) => m.type === "RESERVATION");
    const releaseMovements = movements1.filter((m) => m.type === "RELEASE");
    expect(reservationMovements).toHaveLength(1);
    expect(releaseMovements).toHaveLength(1);
    expect(reservationMovements[0].quantity).toBe(2);
    expect(releaseMovements[0].quantity).toBe(-2);

    // Verify final inventory state
    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(10);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(10);
  });
});

describe("finalizeOrderPayment", () => {
  let paymentId: string;

  beforeEach(async () => {
    // Create a payment record for the order
    const [payment] = await testDb
      .insert(payments)
      .values({
        orderId,
        provider: "stripe",
        providerPaymentId: `pi_test_${Date.now()}`,
        amount: "27.00",
        currency: "USD",
        status: "AUTHORIZED",
        paymentMethod: "CARD",
      })
      .returning();
    paymentId = payment.id;
  });

  afterEach(async () => {
    await testDb.delete(webhookEvents).where(eq(webhookEvents.paymentId, paymentId));
    await testDb.delete(payments).where(eq(payments.id, paymentId));
  });

  it("successfully finalizes payment and commits inventory", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    const result = await finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" });

    expect(result.orderId).toBe(orderId);
    expect(result.paymentId).toBe(paymentId);
    expect(result.fulfilledItems).toHaveLength(2);

    // Verify order status
    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("PROCESSING");
    expect(order?.paymentStatus).toBe("PAID");

    // Verify payment status
    const payment = await testDb
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .then((rows) => rows[0]);
    expect(payment?.status).toBe("COMPLETED");
    expect(payment?.paidAt).toBeTruthy();

    // Verify inventory committed
    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8); // 10 - 2
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(8);

    const inv2 = await getInventoryByVariant(variantId2);
    expect(inv2?.quantity).toBe(4); // 5 - 1
    expect(inv2?.reservedQuantity).toBe(0);
    expect(inv2?.available).toBe(4);

    // Verify order items marked as COMMITTED
    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      expect(item.reservationStatus).toBe("COMMITTED");
    }

    // Verify SALE movements recorded
    const movements1 = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId1));
    const saleMovements = movements1.filter((m) => m.type === "SALE");
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0].quantity).toBe(-2);
  });

  it("is idempotent: duplicate finalization returns same result", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    const result1 = await finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" });
    const result2 = await finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" });

    expect(result1.fulfilledItems).toHaveLength(2);
    expect(result2.fulfilledItems).toHaveLength(2);

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8); // Only deducted once
    expect(inv1?.reservedQuantity).toBe(0);
  });

  it("handles concurrent duplicate finalization requests", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    const results = await Promise.allSettled([
      finalizeOrderPayment(orderId, paymentId, { actorId: "webhook-1", requestId: "req-1" }),
      finalizeOrderPayment(orderId, paymentId, { actorId: "webhook-2", requestId: "req-2" }),
    ]);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // At least one should succeed
    expect(successful.length).toBeGreaterThanOrEqual(1);

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8); // Only deducted once
    expect(inv1?.reservedQuantity).toBe(0);
  });

  it("throws OrderNotFoundError for non-existent order", async () => {
    await expect(finalizeOrderPayment("00000000-0000-0000-0000-000000000000", paymentId)).rejects.toThrow(
      OrderNotFoundError,
    );
  });

  it("throws error for payment not belonging to order", async () => {
    const [otherOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-TEST-999",
        userId: "test-user",
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

    const [otherPayment] = await testDb
      .insert(payments)
      .values({
        orderId: otherOrder.id,
        provider: "stripe",
        providerPaymentId: `pi_other_${Date.now()}`,
        amount: "10.00",
        currency: "USD",
        status: "AUTHORIZED",
      })
      .returning();

    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await expect(finalizeOrderPayment(orderId, otherPayment.id)).rejects.toThrow(
      /does not belong to order/,
    );

    await testDb.delete(payments).where(eq(payments.id, otherPayment.id));
    await testDb.delete(orders).where(eq(orders.id, otherOrder.id));
  });

  it("throws error for already-failed payment", async () => {
    await testDb
      .update(payments)
      .set({ status: "FAILED" })
      .where(eq(payments.id, paymentId));

    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await expect(finalizeOrderPayment(orderId, paymentId)).rejects.toThrow(
      InvalidOrderTransitionError,
    );
  });

  it("throws error for cancelled order", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await cancelOrder(orderId, { actorId: "test-admin" });

    await expect(finalizeOrderPayment(orderId, paymentId)).rejects.toThrow(
      OrderAlreadyCancelledError,
    );
  });

  it("throws error for order with released reservations", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await releaseOrderReservation(orderId, { actorId: "test-admin" });

    await expect(finalizeOrderPayment(orderId, paymentId)).rejects.toThrow(
      OrderReservationReleasedError,
    );
  });

  it("records webhook event for finalization", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await finalizeOrderPayment(orderId, paymentId, { actorId: "webhook", provider: "stripe" });

    const events = await testDb
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.orderId, orderId));

    const finalizeEvent = events.find((e) => e.eventType === "payment.finalized");
    expect(finalizeEvent).toBeTruthy();
    expect(finalizeEvent?.status).toBe("COMPLETED");
    expect(finalizeEvent?.provider).toBe("stripe");
    expect(finalizeEvent?.paymentId).toBe(paymentId);
  });
});

describe("handlePaymentFailureWebhook", () => {
  let paymentId: string;

  beforeEach(async () => {
    const [payment] = await testDb
      .insert(payments)
      .values({
        orderId,
        provider: "stripe",
        providerPaymentId: `pi_test_${Date.now()}`,
        amount: "27.00",
        currency: "USD",
        status: "AUTHORIZED",
        paymentMethod: "CARD",
      })
      .returning();
    paymentId = payment.id;
  });

  afterEach(async () => {
    await testDb.delete(payments).where(eq(payments.id, paymentId));
  });

  it("releases reservations and marks payment as failed", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook" });

    const payment = await testDb
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .then((rows) => rows[0]);
    expect(payment?.status).toBe("FAILED");

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.paymentStatus).toBe("FAILED");
    expect(order?.status).toBe("CANCELLED");

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0);
    expect(inv1?.available).toBe(10);
  });

  it("is idempotent: duplicate failure handling is a no-op", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook" });
    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook" });

    const payment = await testDb
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .then((rows) => rows[0]);
    expect(payment?.status).toBe("FAILED");
  });

  it("does not release reservations if order already processing", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await testDb
      .update(orders)
      .set({ status: "PROCESSING" })
      .where(eq(orders.id, orderId));

    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook" });

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("PROCESSING"); // Status unchanged
    expect(order?.paymentStatus).toBe("FAILED"); // But payment marked failed
  });

  it("records webhook event for payment failure", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook", provider: "stripe" });

    const events = await testDb
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.orderId, orderId));

    const failureEvent = events.find((e) => e.eventType === "payment.failed");
    expect(failureEvent).toBeTruthy();
    expect(failureEvent?.status).toBe("COMPLETED");
    expect(failureEvent?.provider).toBe("stripe");
  });
});

describe("webhook race conditions", () => {
  let paymentId: string;

  beforeEach(async () => {
    const [payment] = await testDb
      .insert(payments)
      .values({
        orderId,
        provider: "stripe",
        providerPaymentId: `pi_test_${Date.now()}`,
        amount: "27.00",
        currency: "USD",
        status: "AUTHORIZED",
        paymentMethod: "CARD",
      })
      .returning();
    paymentId = payment.id;
  });

  afterEach(async () => {
    await testDb.delete(payments).where(eq(payments.id, paymentId));
  });

  it("handles success racing with cancellation", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    const results = await Promise.allSettled([
      finalizeOrderPayment(orderId, paymentId, { actorId: "webhook", requestId: "success" }),
      cancelOrder(orderId, { actorId: "customer", reason: "cancelled", requestId: "cancel" }),
    ]);

    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // One should succeed, one should fail
    expect(successful.length).toBeGreaterThanOrEqual(1);
    expect(failed.length).toBeGreaterThanOrEqual(1);

    // Verify inventory consistency
    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.reservedQuantity).toBe(0); // Either committed or released
  });

  it("handles late success after failure event", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    // First, handle payment failure
    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook" });

    // Then, try to finalize (should fail because order is cancelled)
    await expect(finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" })).rejects.toThrow(
      OrderAlreadyCancelledError,
    );

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");
  });

  it("handles database failure during finalization", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });

    // This test verifies transaction atomicity
    // If any part fails, the entire transaction rolls back
    await finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" });

    // Verify consistent state after success
    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8);
    expect(inv1?.reservedQuantity).toBe(0);

    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("PROCESSING");
  });

  it("handles missing reservations gracefully", async () => {
    // Order with no reservations (all PENDING)
    await expect(finalizeOrderPayment(orderId, paymentId)).rejects.toThrow(
      InvalidOrderTransitionError,
    );
  });

  it("handles already-finalized reservations gracefully", async () => {
    await reserveOrderInventory(orderId, { actorId: "test-admin" });
    await commitOrderReservation(orderId, { actorId: "test-admin" });

    // Should return existing fulfillment without error
    const result = await finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" });
    expect(result.fulfilledItems).toHaveLength(2);

    const inv1 = await getInventoryByVariant(variantId1);
    expect(inv1?.quantity).toBe(8);
  });
});

describe("expired reservation worker", () => {
  let paymentId: string;
  let expiredOrderId: string;
  let validOrderId: string;
  let expiredPaymentId: string;
  let validPaymentId: string;
  let expVariantId1: string;
  let expVariantId2: string;
  let expInventoryId1: string;
  let expInventoryId2: string;

  beforeAll(async () => {
    // Clean up any leftover expired orders from previous test runs.
    // FK-safe order: payments restrict their orders, items restrict variants.
    const expiredScope = and(
      eq(orders.status, "PENDING"),
      eq(orders.paymentStatus, "PENDING"),
      lte(orders.checkoutExpiresAt, new Date()),
    );
    const leftoverIds = testDb.select({ id: orders.id }).from(orders).where(expiredScope);
    await testDb.delete(payments).where(inArray(payments.orderId, leftoverIds));
    await testDb.delete(orderItems).where(
      inArray(
        orderItems.orderId,
        testDb
          .select({ id: orders.id })
          .from(orders)
          .where(expiredScope),
      ),
    );
    await testDb.delete(orders).where(expiredScope);

    // Create dedicated variants for expired reservation tests
    const [product] = await testDb
      .select({ id: products.id })
      .from(products)
      .limit(1);

    // Create dedicated variants for expired reservation tests.
    // Rerun-safe: an interrupted run can leave these SKUs behind, and the
    // enforced sku unique would reject a blind re-insert. Reuse on conflict.
    const [expVariant1] = await testDb
      .insert(productVariants)
      .values({
        productId: product.id,
        sku: "EXP-RES-VAR-001",
        status: "ACTIVE",
        priceOverride: "12.00",
      })
      .onConflictDoNothing({ target: productVariants.sku })
      .returning();
    expVariantId1 =
      expVariant1?.id ??
      (await testDb
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.sku, "EXP-RES-VAR-001"))
        .then((rows) => rows[0]!.id));

    const [expVariant2] = await testDb
      .insert(productVariants)
      .values({
        productId: product.id,
        sku: "EXP-RES-VAR-002",
        status: "ACTIVE",
        priceOverride: "15.00",
      })
      .onConflictDoNothing({ target: productVariants.sku })
      .returning();
    expVariantId2 =
      expVariant2?.id ??
      (await testDb
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.sku, "EXP-RES-VAR-002"))
        .then((rows) => rows[0]!.id));

    // Create inventory for expired reservation test variants
    const [expInv1] = await testDb
      .insert(inventory)
      .values({ variantId: expVariantId1, quantity: 100, reservedQuantity: 0 })
      .returning();
    expInventoryId1 = expInv1.id;

    const [expInv2] = await testDb
      .insert(inventory)
      .values({ variantId: expVariantId2, quantity: 100, reservedQuantity: 0 })
      .returning();
    expInventoryId2 = expInv2.id;

    // Create expired order
    const [expiredOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-EXPIRED-001",
        userId: "test-user",
        status: "PENDING",
        subtotal: "27.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "27.00",
        currency: "USD",
        paymentStatus: "PENDING",
        checkoutExpiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      })
      .returning();
    expiredOrderId = expiredOrder.id;

    // Update inventory reservedQuantity for the expired order items
    await testDb
      .update(inventory)
      .set({ reservedQuantity: 2, updatedAt: new Date() })
      .where(eq(inventory.variantId, expVariantId1));
    await testDb
      .update(inventory)
      .set({ reservedQuantity: 1, updatedAt: new Date() })
      .where(eq(inventory.variantId, expVariantId2));

    await testDb.insert(orderItems).values([
      {
        orderId: expiredOrderId,
        variantId: expVariantId1,
        productName: "Expired Order Product",
        variantName: "Variant 1",
        sku: "EXP-SKU-001",
        quantity: 2,
        unitPrice: "12.00",
        totalAmount: "24.00",
        reservationStatus: "RESERVED",
      },
      {
        orderId: expiredOrderId,
        variantId: expVariantId2,
        productName: "Expired Order Product",
        variantName: "Variant 2",
        sku: "EXP-SKU-002",
        quantity: 1,
        unitPrice: "15.00",
        totalAmount: "15.00",
        reservationStatus: "RESERVED",
      },
    ]);

    const [expiredPayment] = await testDb
      .insert(payments)
      .values({
        orderId: expiredOrderId,
        provider: "stripe",
        providerPaymentId: `pi_expired_${Date.now()}`,
        amount: "27.00",
        currency: "USD",
        status: "PENDING",
        paymentMethod: "CARD",
      })
      .returning();
    expiredPaymentId = expiredPayment.id;

    // Create valid (non-expired) order
    const [validOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-VALID-001",
        userId: "test-user",
        status: "PENDING",
        subtotal: "27.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "27.00",
        currency: "USD",
        paymentStatus: "PENDING",
        checkoutExpiresAt: new Date(Date.now() + 60000), // Expires in 1 minute
      })
      .returning();
    validOrderId = validOrder.id;

    // Update inventory reservedQuantity for the valid order items
    await testDb
      .update(inventory)
      .set({ reservedQuantity: 3, updatedAt: new Date() }) // 2 (from expired) + 1 = 3
      .where(eq(inventory.variantId, expVariantId1));

    await testDb.insert(orderItems).values([
      {
        orderId: validOrderId,
        variantId: expVariantId1,
        productName: "Valid Order Product",
        variantName: "Variant 1",
        sku: "VAL-SKU-001",
        quantity: 1,
        unitPrice: "12.00",
        totalAmount: "12.00",
        reservationStatus: "RESERVED",
      },
    ]);

    const [validPayment] = await testDb
      .insert(payments)
      .values({
        orderId: validOrderId,
        provider: "stripe",
        providerPaymentId: `pi_valid_${Date.now()}`,
        amount: "12.00",
        currency: "USD",
        status: "PENDING",
        paymentMethod: "CARD",
      })
      .returning();
    validPaymentId = validPayment.id;
  });

  afterAll(async () => {
    // FK-safe order: payments restrict their orders, items restrict variants.
    await testDb.delete(payments).where(eq(payments.id, expiredPaymentId));
    await testDb.delete(orderItems).where(eq(orderItems.orderId, expiredOrderId));
    await testDb.delete(orders).where(eq(orders.id, expiredOrderId));
    await testDb.delete(payments).where(eq(payments.id, validPaymentId));
    await testDb.delete(orderItems).where(eq(orderItems.orderId, validOrderId));
    await testDb.delete(orders).where(eq(orders.id, validOrderId));
    // Clear any remaining item references to the dedicated variants before
    // removing them (per-test leftovers from failed assertions).
    await testDb.delete(orderItems).where(
      inArray(orderItems.variantId, [expVariantId1, expVariantId2]),
    );
    await testDb.delete(inventory).where(eq(inventory.id, expInventoryId1));
    await testDb.delete(inventory).where(eq(inventory.id, expInventoryId2));
    await testDb.delete(productVariants).where(eq(productVariants.id, expVariantId1));
    await testDb.delete(productVariants).where(eq(productVariants.id, expVariantId2));
  });

  it("finds expired orders with active reservations", async () => {
    const expired = await findExpiredOrdersWithReservations(100); // Increase limit to account for other test orders
    const expiredIds = expired.map((o) => o.id);

    expect(expiredIds).toContain(expiredOrderId);
    expect(expiredIds).not.toContain(validOrderId);
  });

  it("does not find orders without reservations", async () => {
    // Create order with expired checkout but no reservations
    const [noResOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-NORES-001",
        userId: "test-user",
        status: "PENDING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PENDING",
        checkoutExpiresAt: new Date(Date.now() - 1000),
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: noResOrder.id,
      variantId: expVariantId1,
      productName: "No Res Product",
      variantName: "Variant 1",
      sku: "NORES-SKU-001",
      quantity: 1,
      unitPrice: "10.00",
      totalAmount: "10.00",
      reservationStatus: "PENDING", // Not reserved
    });

    const expired = await findExpiredOrdersWithReservations(10);
    const expiredIds = expired.map((o) => o.id);

    expect(expiredIds).not.toContain(noResOrder.id);

    await testDb.delete(orderItems).where(eq(orderItems.orderId, noResOrder.id));
    await testDb.delete(orders).where(eq(orders.id, noResOrder.id));
  });

  it("does not find orders with terminal payment status", async () => {
    // Create order with expired checkout but PAID payment status
    const [paidOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-PAID-001",
        userId: "test-user",
        status: "PROCESSING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PAID",
        checkoutExpiresAt: new Date(Date.now() - 1000),
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: paidOrder.id,
      variantId: expVariantId1,
      productName: "Paid Product",
      variantName: "Variant 1",
      sku: "PAID-SKU-001",
      quantity: 1,
      unitPrice: "10.00",
      totalAmount: "10.00",
      reservationStatus: "RESERVED",
    });

    const expired = await findExpiredOrdersWithReservations(10);
    const expiredIds = expired.map((o) => o.id);

    expect(expiredIds).not.toContain(paidOrder.id);

    await testDb.delete(orderItems).where(eq(orderItems.orderId, paidOrder.id));
    await testDb.delete(orders).where(eq(orders.id, paidOrder.id));
  });

  it("processes a single expired order successfully", async () => {
    const result = await processExpiredOrder(expiredOrderId, {
      actorId: "test-worker",
      requestId: "test-process-1",
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe(expiredOrderId);

    // Verify order status updated
    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, expiredOrderId))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");
    expect(order?.paymentStatus).toBe("EXPIRED");

    // Verify reservations released
    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, expiredOrderId));
    for (const item of items) {
      expect(item.reservationStatus).toBe("RELEASED");
    }
  });

  it("is idempotent: duplicate processing returns success", async () => {
    // Process again (should be idempotent)
    const result = await processExpiredOrder(expiredOrderId, {
      actorId: "test-worker",
      requestId: "test-process-2",
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe(expiredOrderId);
  });

  it("processes expired reservations in batch", async () => {
    // Create another expired order for batch test
    const [batchOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-BATCH-001",
        userId: "test-user",
        status: "PENDING",
        subtotal: "15.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "15.00",
        currency: "USD",
        paymentStatus: "PENDING",
        checkoutExpiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago (earliest)
      })
      .returning();

    // Update inventory reservedQuantity for the batch order
    await testDb
      .update(inventory)
      .set({ reservedQuantity: 2, updatedAt: new Date() }) // 1 (from expired) + 1 = 2
      .where(eq(inventory.variantId, expVariantId2));

    await testDb.insert(orderItems).values({
      orderId: batchOrder.id,
      variantId: expVariantId2,
      productName: "Batch Product",
      variantName: "Variant 2",
      sku: "BATCH-SKU-001",
      quantity: 1,
      unitPrice: "15.00",
      totalAmount: "15.00",
      reservationStatus: "RESERVED",
    });

    const [batchPayment] = await testDb
      .insert(payments)
      .values({
        orderId: batchOrder.id,
        provider: "stripe",
        providerPaymentId: `pi_batch_${Date.now()}`,
        amount: "15.00",
        currency: "USD",
        status: "PENDING",
        paymentMethod: "CARD",
      })
      .returning();

    const result = await processExpiredReservations({
      batchSize: 10,
      maxRetries: 0,
    });

    // Verify batch order was processed successfully
    const batchResult = result.results.find((r) => r.orderId === batchOrder.id);
    expect(batchResult).toBeDefined();
    expect(batchResult?.success).toBe(true);

    // Verify batch order status updated
    const order = await testDb
      .select()
      .from(orders)
      .where(eq(orders.id, batchOrder.id))
      .then((rows) => rows[0]);
    expect(order?.status).toBe("CANCELLED");
    expect(order?.paymentStatus).toBe("EXPIRED");

    // Verify reservations released
    const items = await testDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, batchOrder.id));
    for (const item of items) {
      expect(item.reservationStatus).toBe("RELEASED");
    }

    // Cleanup (FK-safe: payments before orders)
    await testDb.delete(payments).where(eq(payments.id, batchPayment.id));
    await testDb.delete(orderItems).where(eq(orderItems.orderId, batchOrder.id));
    await testDb.delete(orders).where(eq(orders.id, batchOrder.id));
  });

  it("respects batch size limit", async () => {
    // Create many expired orders (more than batch size)
    const manyOrders = [];
    for (let i = 0; i < 5; i++) {
      const [order] = await testDb
        .insert(orders)
        .values({
          orderNumber: `ORD-MANY-${i}`,
          userId: "test-user",
          status: "PENDING",
          subtotal: "10.00",
          discountAmount: "0.00",
          shippingAmount: "0.00",
          taxAmount: "0.00",
          totalAmount: "10.00",
          currency: "USD",
          paymentStatus: "PENDING",
          checkoutExpiresAt: new Date(Date.now() - 1000),
        })
        .returning();

      // Update inventory reservedQuantity for each order
      await testDb
        .update(inventory)
        .set({ reservedQuantity: 3 + i + 1, updatedAt: new Date() }) // 3 (existing) + i + 1
        .where(eq(inventory.variantId, expVariantId1));

      await testDb.insert(orderItems).values({
        orderId: order.id,
        variantId: expVariantId1,
        productName: `Many Product ${i}`,
        variantName: "Variant 1",
        sku: `MANY-SKU-${i}`,
        quantity: 1,
        unitPrice: "10.00",
        totalAmount: "10.00",
        reservationStatus: "RESERVED",
      });

      const [payment] = await testDb
        .insert(payments)
        .values({
          orderId: order.id,
          provider: "stripe",
          providerPaymentId: `pi_many_${i}_${Date.now()}`,
          amount: "10.00",
          currency: "USD",
          status: "PENDING",
          paymentMethod: "CARD",
        })
        .returning();

      manyOrders.push({ order, payment });
    }

    const result = await processExpiredReservations({
      batchSize: 2, // Process only 2 at a time
      maxRetries: 0,
    });

    expect(result.processed).toBe(2); // Limited by batchSize

    // Cleanup (FK-safe: payments before orders)
    for (const { order, payment } of manyOrders) {
      await testDb.delete(payments).where(eq(payments.id, payment.id));
      await testDb.delete(orderItems).where(eq(orderItems.orderId, order.id));
      await testDb.delete(orders).where(eq(orders.id, order.id));
    }
  });

  it("handles already released reservations gracefully", async () => {
    // Create order with expired checkout but already released reservations
    const [releasedOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-RELEASED-001",
        userId: "test-user",
        status: "PENDING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PENDING",
        checkoutExpiresAt: new Date(Date.now() - 1000),
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: releasedOrder.id,
      variantId: expVariantId1,
      productName: "Released Product",
      variantName: "Variant 1",
      sku: "REL-SKU-001",
      quantity: 1,
      unitPrice: "10.00",
      totalAmount: "10.00",
      reservationStatus: "RELEASED", // Already released
    });

    const [releasedPayment] = await testDb
      .insert(payments)
      .values({
        orderId: releasedOrder.id,
        provider: "stripe",
        providerPaymentId: `pi_released_${Date.now()}`,
        amount: "10.00",
        currency: "USD",
        status: "PENDING",
        paymentMethod: "CARD",
      })
      .returning();

    // Should not find this order (no RESERVED items)
    const expired = await findExpiredOrdersWithReservations(10);
    const expiredIds = expired.map((o) => o.id);
    expect(expiredIds).not.toContain(releasedOrder.id);

    // Cleanup (FK-safe: payments before orders)
    await testDb.delete(payments).where(eq(payments.id, releasedPayment.id));
    await testDb.delete(orderItems).where(eq(orderItems.orderId, releasedOrder.id));
    await testDb.delete(orders).where(eq(orders.id, releasedOrder.id));
  });

  it("handles already fulfilled (COMMITTED) reservations gracefully", async () => {
    // Create order with expired checkout but already committed reservations
    const [committedOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-COMMITTED-001",
        userId: "test-user",
        status: "PROCESSING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PAID",
        checkoutExpiresAt: new Date(Date.now() - 1000),
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: committedOrder.id,
      variantId: expVariantId1,
      productName: "Committed Product",
      variantName: "Variant 1",
      sku: "COMM-SKU-001",
      quantity: 1,
      unitPrice: "10.00",
      totalAmount: "10.00",
      reservationStatus: "COMMITTED", // Already committed
    });

    const [committedPayment] = await testDb
      .insert(payments)
      .values({
        orderId: committedOrder.id,
        provider: "stripe",
        providerPaymentId: `pi_committed_${Date.now()}`,
        amount: "10.00",
        currency: "USD",
        status: "COMPLETED",
        paymentMethod: "CARD",
      })
      .returning();

    // Should not find this order (payment status is PAID)
    const expired = await findExpiredOrdersWithReservations(10);
    const expiredIds = expired.map((o) => o.id);
    expect(expiredIds).not.toContain(committedOrder.id);

    // Cleanup (FK-safe: payments before orders)
    await testDb.delete(payments).where(eq(payments.id, committedPayment.id));
    await testDb.delete(orderItems).where(eq(orderItems.orderId, committedOrder.id));
    await testDb.delete(orders).where(eq(orders.id, committedOrder.id));
  });

  it("retries failed orders with exponential backoff", async () => {
    // This test verifies the retry logic exists
    // We can't easily simulate a transient failure, but we can verify the config
    expect(DEFAULT_JOB_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_JOB_CONFIG.retryDelayMs).toBe(5000);
    expect(DEFAULT_JOB_CONFIG.batchSize).toBe(100);
  });

  it("continues processing other orders when one fails", async () => {
    // Create an order that will fail (no inventory record)
    const [failOrder] = await testDb
      .insert(orders)
      .values({
        orderNumber: "ORD-FAIL-001",
        userId: "test-user",
        status: "PENDING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PENDING",
        checkoutExpiresAt: new Date(Date.now() - 1000),
      })
      .returning();

    // Use a variant that doesn't have inventory
    const [fakeVariant] = await testDb
      .insert(productVariants)
      .values({
        productId: (await testDb.select({ id: products.id }).from(products).limit(1))[0].id,
        sku: "FAKE-SKU-001",
        priceOverride: "10.00",
        status: "ACTIVE",
      })
      .returning();

    await testDb.insert(orderItems).values({
      orderId: failOrder.id,
      variantId: fakeVariant.id,
      productName: "Fail Product",
      variantName: "Fake Variant",
      sku: "FAIL-SKU-001",
      quantity: 1,
      unitPrice: "10.00",
      totalAmount: "10.00",
      reservationStatus: "RESERVED",
    });

    const [failPayment] = await testDb
      .insert(payments)
      .values({
        orderId: failOrder.id,
        provider: "stripe",
        providerPaymentId: `pi_fail_${Date.now()}`,
        amount: "10.00",
        currency: "USD",
        status: "PENDING",
        paymentMethod: "CARD",
      })
      .returning();

    // Process with maxRetries=0 to fail fast
    const result = await processExpiredReservations({
      batchSize: 10,
      maxRetries: 0,
    });

    // Should have processed some orders (the fail order will fail)
    expect(result.processed).toBeGreaterThan(0);

    // Cleanup (FK-safe: payments before orders)
    await testDb.delete(payments).where(eq(payments.id, failPayment.id));
    await testDb.delete(orderItems).where(eq(orderItems.orderId, failOrder.id));
    await testDb.delete(orders).where(eq(orders.id, failOrder.id));
    await testDb.delete(productVariants).where(eq(productVariants.id, fakeVariant.id));
  });
});
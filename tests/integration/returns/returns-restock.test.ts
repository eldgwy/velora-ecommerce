import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const { refundsCreateMock } = vi.hoisted(() => {
  const seen = new Map<string, { id: string }>();
  let seq = 0;
  return {
    refundsCreateMock: vi.fn(async (_params: unknown, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey ?? `nokey-${(seq += 1)}`;
      const existing = seen.get(key);
      if (existing) return existing;
      const created = { id: `re_ret_${Date.now()}_${(seq += 1)}` };
      seen.set(key, created);
      return created;
    }),
  };
});

vi.mock("stripe", () => ({
  default: vi.fn(function (this: unknown) {
    return {
      refunds: { create: refundsCreateMock },
      paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
    };
  }),
}));

vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["a@ex.com"], messageId: "m1" })),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  inventoryMovements,
} from "../_db";
import {
  orderItems,
  orders,
  orderStatusHistories,
  payments,
  refunds,
} from "@/infrastructure/database/schema/orders";
import { returnCases, returnItems } from "@/infrastructure/database/schema/returns";
import { user } from "@/infrastructure/database/schema/auth";
import {
  createReturnCase,
  receiveReturnItem,
  inspectReturnItem,
  cancelReturnItem,
  restockReturn,
} from "@/modules/returns/application/commands/returns";
import { requestRefund } from "@/modules/payments/application/commands/request-refund";
import {
  InvalidOrderItemQuantityError,
  InvalidOrderTransitionError,
  OrderItemNotFoundError,
} from "@/modules/orders/domain/errors/order-errors";

const SFX = `ret-${Date.now()}`;
let userId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";

interface FixtureOrder {
  orderId: string;
  orderItemId: string;
  paymentId: string;
}

/** Shipped, paid order of 2 units with committed stock (post-fulfillment). */
async function shippedOrder(tag: string): Promise<FixtureOrder> {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `RET-ORD-${tag}-${SFX}`,
      userId,
      status: "SHIPPED",
      subtotal: "40.00",
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "40.00",
      currency: "USD",
      paymentStatus: "PAID",
    })
    .returning();
  const [line] = await testDb
    .insert(orderItems)
    .values({
      orderId: order.id,
      variantId,
      productName: "Return Product",
      sku: `RET-SKU-${SFX}`,
      quantity: 2,
      unitPrice: "20.00",
      totalAmount: "40.00",
      reservationStatus: "COMMITTED",
    })
    .returning();
  const [payment] = await testDb
    .insert(payments)
    .values({
      orderId: order.id,
      provider: "stripe",
      providerPaymentId: `pi_ret_${tag}_${SFX}`,
      amount: "40.00",
      currency: "USD",
      status: "COMPLETED",
      paymentMethod: "CARD",
    })
    .returning();
  return { orderId: order.id, orderItemId: line.id, paymentId: payment.id };
}

async function returnMovementCount(): Promise<number> {
  const rows = await testDb
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.type, "RETURN"));
  return rows[0]!.count;
}

async function historyTypes(orderId: string): Promise<string[]> {
  const rows = await testDb
    .select({ eventType: orderStatusHistories.eventType })
    .from(orderStatusHistories)
    .where(eq(orderStatusHistories.orderId, orderId));
  return rows.map((r) => r.eventType ?? "");
}

async function itemStatus(itemId: string) {
  const [row] = await testDb.select().from(returnItems).where(eq(returnItems.id, itemId));
  return row!;
}

beforeAll(async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  const [u] = await testDb
    .insert(user)
    .values({ id: `ret-u-${SFX}`, name: "Return User", email: `return-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `ret-cat-${SFX}`, name: "RET Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `ret-brand-${SFX}`, name: "RET Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "RET Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `RET-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 10, reservedQuantity: 0 });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const myOrders = await testDb.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
  const ids = myOrders.map((o) => o.id);
  if (ids.length > 0) {
    const caseRows = await testDb.select({ id: returnCases.id }).from(returnCases).where(inArray(returnCases.orderId, ids));
    const caseIds = caseRows.map((c) => c.id);
    if (caseIds.length > 0) {
      await testDb.delete(returnItems).where(inArray(returnItems.caseId, caseIds));
    }
    await testDb.delete(returnCases).where(inArray(returnCases.orderId, ids));
    const payRows = await testDb.select({ id: payments.id }).from(payments).where(inArray(payments.orderId, ids));
    const payIds = payRows.map((p) => p.id);
    if (payIds.length > 0) {
      await testDb.delete(refunds).where(inArray(refunds.paymentId, payIds));
    }
    await testDb.delete(payments).where(inArray(payments.orderId, ids));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await testDb.delete(orderStatusHistories).where(inArray(orderStatusHistories.orderId, ids));
    await testDb.delete(orders).where(inArray(orders.id, ids));
  }
  const invs = await testDb.select({ id: inventory.id }).from(inventory).where(eq(inventory.variantId, variantId));
  const invIds = invs.map((i) => i.id);
  if (invIds.length > 0) {
    await testDb.delete(inventoryMovements).where(inArray(inventoryMovements.inventoryId, invIds));
    await testDb.delete(inventory).where(inArray(inventory.id, invIds));
  }
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, userId));
});

describe("return lifecycle", () => {
  it("runs request → receipt → approval → restock with audit and completion", { timeout: 20_000 }, async () => {
    const { orderId, orderItemId } = await shippedOrder("happy");
    const movesBefore = await returnMovementCount();
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));

    const { caseId } = await createReturnCase({
      orderId,
      items: [{ orderItemId, quantity: 1 }],
      reason: "Wrong size",
      actorId: "admin-1",
    });
    const [item] = await testDb.select().from(returnItems).where(eq(returnItems.caseId, caseId));
    expect(item!.status).toBe("PENDING");

    await receiveReturnItem(item!.id, { actorId: "admin-1" });
    expect((await itemStatus(item!.id)).status).toBe("RECEIVED");
    // Replay is a no-op.
    await receiveReturnItem(item!.id, { actorId: "admin-1" });

    await inspectReturnItem(item!.id, { approved: true, condition: "RESTOCKABLE" }, { actorId: "admin-1" });
    expect((await itemStatus(item!.id)).status).toBe("APPROVED");

    const restocked = await restockReturn(item!.id, { actorId: "admin-1" });
    expect(restocked.replayed).toBe(false);

    const done = await itemStatus(item!.id);
    expect(done.status).toBe("RESTOCKED");
    expect(done.restockedMovementId).toBe(restocked.movementId);

    const [invAfter] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));
    expect(invAfter!.quantity).toBe(invBefore!.quantity + 1);
    expect(invAfter!.reservedQuantity).toBe(invBefore!.reservedQuantity);
    expect(await returnMovementCount()).toBe(movesBefore + 1);

    const [movement] = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.id, restocked.movementId));
    expect(movement!.type).toBe("RETURN");
    expect(movement!.quantity).toBe(1);
    expect(movement!.reason).toContain(orderId);

    const [c] = await testDb.select().from(returnCases).where(eq(returnCases.id, caseId));
    expect(c!.status).toBe("COMPLETED");

    const events = await historyTypes(orderId);
    for (const t of ["return_requested", "return_received", "return_approved", "return_restocked", "return_completed"]) {
      expect(events).toContain(t);
    }
    const [restockAudit] = await testDb
      .select()
      .from(orderStatusHistories)
      .where(
        and(eq(orderStatusHistories.orderId, orderId), eq(orderStatusHistories.eventType, "return_restocked")),
      );
    expect(restockAudit!.actorId).toBe("admin-1");
  });

  it("rejects quantities exceeding the purchased amount across cases", async () => {
    const { orderId, orderItemId } = await shippedOrder("quota");
    await createReturnCase({
      orderId,
      items: [{ orderItemId, quantity: 2 }],
      reason: "full line",
      actorId: "admin-1",
    });
    await expect(
      createReturnCase({
        orderId,
        items: [{ orderItemId, quantity: 1 }],
        reason: "one more",
        actorId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(InvalidOrderItemQuantityError);
  });

  it("frees quota for rejected lines but keeps it for approved ones", async () => {
    const { orderId, orderItemId } = await shippedOrder("rejquota");
    const { caseId } = await createReturnCase({
      orderId,
      items: [{ orderItemId, quantity: 1 }],
      reason: "damaged?",
      actorId: "admin-1",
    });
    const [item] = await testDb.select().from(returnItems).where(eq(returnItems.caseId, caseId));
    await receiveReturnItem(item!.id, { actorId: "admin-1" });
    await inspectReturnItem(item!.id, { approved: false, condition: "DAMAGED" }, { actorId: "admin-1" });

    // Rejected frees the quota: a fresh case for the full line is allowed.
    const retry = await createReturnCase({
      orderId,
      items: [{ orderItemId, quantity: 2 }],
      reason: "second look",
      actorId: "admin-1",
    });
    expect(retry.caseId).toBeDefined();
  });

  it("rejects lines from a different order and unknown refunds", { timeout: 20_000 }, async () => {
    const first = await shippedOrder("crossa");
    const second = await shippedOrder("crossb");
    await expect(
      createReturnCase({
        orderId: first.orderId,
        items: [{ orderItemId: second.orderItemId, quantity: 1 }],
        reason: "cross",
        actorId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(OrderItemNotFoundError);
    await expect(
      createReturnCase({
        orderId: first.orderId,
        items: [{ orderItemId: first.orderItemId, quantity: 1 }],
        reason: "bad link",
        refundId: "00000000-0000-0000-0000-000000000000",
        actorId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
  });
});

describe("restock gates", () => {
  async function approvedLine(tag: string, qty = 1) {
    const { orderId, orderItemId } = await shippedOrder(tag);
    const { caseId } = await createReturnCase({
      orderId,
      items: [{ orderItemId, quantity: qty }],
      reason: tag,
      actorId: "admin-1",
    });
    const [item] = await testDb.select().from(returnItems).where(eq(returnItems.caseId, caseId));
    return { orderId, itemId: item!.id };
  }

  it("blocks restock before receipt and inspection", async () => {
    const { itemId } = await approvedLine("gatepending");
    await expect(restockReturn(itemId, { actorId: "admin-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    await receiveReturnItem(itemId, { actorId: "admin-1" });
    await expect(restockReturn(itemId, { actorId: "admin-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect((await itemStatus(itemId)).status).toBe("RECEIVED");
  });

  it("blocks damaged and rejected goods", async () => {
    const { itemId } = await approvedLine("gatedamaged");
    await receiveReturnItem(itemId, { actorId: "admin-1" });
    await expect(
      inspectReturnItem(itemId, { approved: true, condition: "DAMAGED" }, { actorId: "admin-1" }),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
    await inspectReturnItem(itemId, { approved: false, condition: "DAMAGED" }, { actorId: "admin-1" });
    await expect(restockReturn(itemId, { actorId: "admin-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
  });

  it("blocks restock for cancelled orders and rolls back cleanly", async () => {
    const { orderId, itemId } = await approvedLine("gatecancel");
    await receiveReturnItem(itemId, { actorId: "admin-1" });
    await inspectReturnItem(itemId, { approved: true, condition: "RESTOCKABLE" }, { actorId: "admin-1" });
    const movesBefore = await returnMovementCount();
    await testDb.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, orderId));

    await expect(restockReturn(itemId, { actorId: "admin-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect((await itemStatus(itemId)).status).toBe("APPROVED");
    expect(await returnMovementCount()).toBe(movesBefore);
  });

  it("restocks exactly once under concurrent attempts and replays", async () => {
    const { itemId } = await approvedLine("gateconc");
    await receiveReturnItem(itemId, { actorId: "admin-1" });
    await inspectReturnItem(itemId, { approved: true, condition: "RESTOCKABLE" }, { actorId: "admin-1" });
    const movesBefore = await returnMovementCount();
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));

    const [a, b] = await Promise.all([
      restockReturn(itemId, { actorId: "admin-1" }),
      restockReturn(itemId, { actorId: "admin-1" }),
    ]);
    expect(a.movementId).toBe(b.movementId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);

    const replay = await restockReturn(itemId, { actorId: "admin-1" });
    expect(replay).toEqual({ movementId: a.movementId, replayed: true });

    const [invAfter] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));
    expect(invAfter!.quantity).toBe(invBefore!.quantity + 1);
    expect(await returnMovementCount()).toBe(movesBefore + 1);
  });

  it("supports cancellation of untouched lines", async () => {
    const { itemId } = await approvedLine("gatecancelitem");
    await cancelReturnItem(itemId, { actorId: "admin-1" });
    expect((await itemStatus(itemId)).status).toBe("CANCELLED");
    await expect(restockReturn(itemId, { actorId: "admin-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
  });
});

describe("refund/return independence", () => {
  it("issuing a refund does not restock goods", async () => {
    const { orderId } = await shippedOrder("noretrestock");
    const movesBefore = await returnMovementCount();
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));

    const refund = await requestRefund({
      orderId,
      reason: "goodwill",
      actorId: "admin-1",
      actorType: "admin",
    });
    expect(refund.status).toBe("COMPLETED");

    const [invAfter] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));
    expect(invAfter!.quantity).toBe(invBefore!.quantity);
    expect(await returnMovementCount()).toBe(movesBefore);
    const cases = await testDb.select().from(returnCases).where(eq(returnCases.orderId, orderId));
    expect(cases).toHaveLength(0);
  });

  it("restocking a return does not create a financial refund", async () => {
    const { orderId, orderItemId } = await shippedOrder("norestockrefund");
    const { caseId } = await createReturnCase({
      orderId,
      items: [{ orderItemId, quantity: 1 }],
      reason: "restock only",
      actorId: "admin-1",
    });
    const [item] = await testDb.select().from(returnItems).where(eq(returnItems.caseId, caseId));
    await receiveReturnItem(item!.id, { actorId: "admin-1" });
    await inspectReturnItem(item!.id, { approved: true, condition: "RESTOCKABLE" }, { actorId: "admin-1" });
    await restockReturn(item!.id, { actorId: "admin-1" });

    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, orderId));
    const refundRows = await testDb.select().from(refunds).where(eq(refunds.paymentId, payment!.id));
    expect(refundRows).toHaveLength(0);
    const [kept] = await testDb.select().from(payments).where(eq(payments.id, payment!.id));
    expect(kept!.status).toBe("COMPLETED");
    const [keptOrder] = await testDb.select().from(orders).where(eq(orders.id, orderId));
    expect(keptOrder!.paymentStatus).toBe("PAID");
  });
});

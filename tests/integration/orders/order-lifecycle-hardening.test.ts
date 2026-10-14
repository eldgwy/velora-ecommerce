import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  inventoryMovements,
  testDb,
} from "../_db";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import {
  orderItems,
  orders,
  orderStatusHistories,
  payments,
} from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import { placeOrder } from "@/modules/checkout/application/commands/create-order";
import {
  getOrderDetail,
} from "@/modules/orders/application/queries/orders";
import {
  cancelOrderAsCustomer,
  deliverOrder,
  shipOrder,
} from "@/modules/orders/application/commands/order-transitions";
import {
  cancelOrder,
  handlePaymentFailure,
} from "@/modules/orders/application/commands/order-lifecycle";
import {
  finalizeOrderPayment,
  handlePaymentFailureWebhook,
} from "@/modules/orders/application/commands/finalize-payment";
import {
  InvalidOrderTransitionError,
  OrderAlreadyCancelledError,
} from "@/modules/orders/domain/errors/order-errors";

const SFX = `olh-${Date.now()}`;
const key = () => randomUUID();

const users: Record<string, string> = {};
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";

function buyInput() {
  return {
    shippingAddress: {
      newAddress: {
        country: "US",
        city: "Springfield",
        state: "IL",
        postalCode: "62701",
        addressLine1: "1 Main St",
      },
    },
    billingAddress: { sameAsShipping: true as const },
    shippingMethod: "STANDARD" as const,
    couponCode: null,
    contactPhone: null,
    paymentMethod: "cod" as const,
    notes: null,
  };
}

async function stockedOrder(userKey: string, qty: number) {
  await addItemToCart(
    { kind: "user", userId: users[userKey]! },
    { variantId, quantity: qty },
  );
  const created = await placeOrder(
    { id: users[userKey]!, name: `Owner ${userKey}`, email: `${userKey}-${SFX}@ex.com` },
    buyInput(),
    key(),
  );
  const [payment] = await testDb
    .select()
    .from(payments)
    .where(eq(payments.orderId, created.orderId));
  return { orderId: created.orderId, paymentId: payment!.id };
}

async function inventoryState() {
  const [inv] = await testDb
    .select({ quantity: inventory.quantity, reservedQuantity: inventory.reservedQuantity })
    .from(inventory)
    .where(eq(inventory.variantId, variantId));
  return inv!;
}

async function movementCount(type: "SALE" | "RELEASE" | "RESERVATION", orderId: string) {
  const rows = await testDb
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.type, type),
        sql`${inventoryMovements.reason} LIKE ${`%${orderId}%`}`,
      ),
    );
  return rows.length;
}

beforeAll(async () => {
  for (const n of ["w1", "w2"]) {
    const [u] = await testDb
      .insert(user)
      .values({ id: `olh-u-${n}-${SFX}`, name: `Owner ${n}`, email: `${n}-${SFX}@ex.com` })
      .returning();
    users[n] = u.id;
  }
  const [cat] = await testDb
    .insert(categories)
    .values({ slug: `olh-cat-${SFX}`, name: "OLH Cat" })
    .returning();
  const [br] = await testDb
    .insert(brands)
    .values({ slug: `olh-brand-${SFX}`, name: "OLH Brand" })
    .returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ name: "OLH Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `OLH-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 30, reservedQuantity: 0 });
}, 30000);

afterAll(async () => {
  const myUserIds = Object.values(users);
  const myOrders = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.userId, myUserIds));
  const myOrderIds = myOrders.map((o) => o.id);
  if (myOrderIds.length > 0) {
    await testDb.delete(payments).where(inArray(payments.orderId, myOrderIds));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, myOrderIds));
    await testDb.delete(orderStatusHistories).where(inArray(orderStatusHistories.orderId, myOrderIds));
    await testDb.delete(orders).where(inArray(orders.id, myOrderIds));
  }
  const { orderNotifications } = await import("@/infrastructure/database/schema/orders");
  if (myOrderIds.length > 0) {
    await testDb.delete(orderNotifications).where(inArray(orderNotifications.orderId, myOrderIds));
  }
  const myCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(inArray(carts.userId, myUserIds));
  const myCartIds = myCarts.map((c) => c.id);
  if (myCartIds.length > 0) {
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, myCartIds));
    await testDb.delete(carts).where(inArray(carts.id, myCartIds));
  }
  await testDb.delete(inventoryMovements).where(
    inArray(
      inventoryMovements.inventoryId,
      testDb.select({ id: inventory.id }).from(inventory).where(eq(inventory.variantId, variantId)),
    ),
  );
  await testDb.delete(inventory).where(eq(inventory.variantId, variantId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  const { customerProfiles, addresses } = await import("@/infrastructure/database/schema/customers");
  const profiles = await testDb
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(inArray(customerProfiles.userId, myUserIds));
  const pIds = profiles.map((p) => p.id);
  if (pIds.length > 0) {
    await testDb.delete(addresses).where(inArray(addresses.customerId, pIds));
    await testDb.delete(customerProfiles).where(inArray(customerProfiles.id, pIds));
  }
  await testDb.delete(user).where(inArray(user.id, myUserIds));
});

describe("concurrent cancel vs payment finalization", () => {
  it("lets exactly one win with balanced inventory either way", async () => {
    const { orderId, paymentId } = await stockedOrder("w1", 2);
    const before = await inventoryState();

    const [cancelOutcome, finalizeOutcome] = await Promise.allSettled([
      cancelOrderAsCustomer(orderId, users.w1!),
      finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" }),
    ]);

    const winners = [cancelOutcome, finalizeOutcome].filter((o) => o.status === "fulfilled");
    const losers = [cancelOutcome, finalizeOutcome].filter((o) => o.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const [order] = await testDb.select().from(orders).where(eq(orders.id, orderId));
    const after = await inventoryState();

    if (cancelOutcome.status === "fulfilled") {
      // Cancel won: stock released, order cancelled, finalizer rejected loudly.
      expect(order!.status).toBe("CANCELLED");
      expect(after.quantity).toBe(before.quantity);
      expect(after.reservedQuantity).toBe(before.reservedQuantity - 2);
      expect(finalizeOutcome).toMatchObject({ status: "rejected" });
    } else {
      // Finalize won: stock committed, order paid; cancel rejected loudly.
      expect(order!.status).toBe("PROCESSING");
      expect(order!.paymentStatus).toBe("PAID");
      expect(after.quantity).toBe(before.quantity - 2);
      expect(after.reservedQuantity).toBe(before.reservedQuantity - 2);
      expect(cancelOutcome).toMatchObject({ status: "rejected" });
    }

    // Either way the ledger holds exactly one decisive movement set for the
    // quantity: never a sale plus a release of the same units.
    const sales = await movementCount("SALE", orderId);
    const releases = await movementCount("RELEASE", orderId);
    expect(sales + releases).toBeLessThanOrEqual(1);
    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const statuses = new Set(items.map((i) => i.reservationStatus));
    expect(statuses.size).toBe(1);
  });
});

describe("concurrent duplicate finalization", () => {
  it("commits stock exactly once under concurrent duplicate webhooks", async () => {
    const { orderId, paymentId } = await stockedOrder("w2", 1);
    const before = await inventoryState();

    const [first, second] = await Promise.all([
      finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" }),
      finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" }),
    ]);

    expect(first.fulfilledItems).toHaveLength(1);
    expect(second.fulfilledItems).toHaveLength(1);

    const after = await inventoryState();
    expect(after.quantity).toBe(before.quantity - 1);
    expect(after.reservedQuantity).toBe(before.reservedQuantity - 1);
    expect(await movementCount("SALE", orderId)).toBe(1);

    const [order] = await testDb.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe("PROCESSING");
    expect(order!.paymentStatus).toBe("PAID");
  });
});

describe("failure handlers never overwrite captured money", () => {
  it("webhook failure after completed payment is a no-op", async () => {
    const { orderId, paymentId } = await stockedOrder("w1", 1);
    await finalizeOrderPayment(orderId, paymentId, { actorId: "webhook" });
    const salesBefore = await movementCount("SALE", orderId);

    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook" });
    await handlePaymentFailureWebhook(orderId, paymentId, { actorId: "webhook" });

    const [payment] = await testDb.select().from(payments).where(eq(payments.id, paymentId));
    const [order] = await testDb.select().from(orders).where(eq(orders.id, orderId));
    expect(payment!.status).toBe("COMPLETED");
    expect(order!.status).toBe("PROCESSING");
    expect(order!.paymentStatus).toBe("PAID");
    expect(await movementCount("SALE", orderId)).toBe(salesBefore);
    expect(await movementCount("RELEASE", orderId)).toBe(0);
  });

  it("lifecycle failure handler on a PAID order is a no-op", async () => {
    const { orderId } = await stockedOrder("w2", 1);
    const [paymentBefore] = await testDb
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
    await testDb
      .update(orders)
      .set({ paymentStatus: "PAID" })
      .where(eq(orders.id, orderId));

    await handlePaymentFailure(orderId, { actorId: "test" });

    const [order] = await testDb.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.paymentStatus).toBe("PAID");
    const [paymentAfter] = await testDb
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
    expect(paymentAfter!.status).toBe(paymentBefore!.status);
    expect(await movementCount("RELEASE", orderId)).toBe(0);
  });
});

describe("audit history exactness", () => {
  it("writes no row for rejected transitions", async () => {
    const { orderId } = await stockedOrder("w1", 1);
    const countBefore = (
      await testDb.select({ id: orderStatusHistories.id }).from(orderStatusHistories).where(eq(orderStatusHistories.orderId, orderId))
    ).length;

    // PENDING → SHIPPED / DELIVERED skip stages: rejected, nothing recorded.
    await expect(shipOrder(orderId, { actorId: "staff-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    await expect(deliverOrder(orderId, { actorId: "staff-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );

    const countMid = (
      await testDb.select({ id: orderStatusHistories.id }).from(orderStatusHistories).where(eq(orderStatusHistories.orderId, orderId))
    ).length;
    expect(countMid).toBe(countBefore);

    // The one permitted staff path from PENDING writes exactly one row.
    await cancelOrder(orderId, { actorId: "staff-1", reason: "test" });
    const countAfter = (
      await testDb.select({ id: orderStatusHistories.id }).from(orderStatusHistories).where(eq(orderStatusHistories.orderId, orderId))
    ).length;
    expect(countAfter - countBefore).toBe(1);
  });

  it("exposes actor and correlation on the timeline", async () => {
    const { orderId } = await stockedOrder("w2", 1);
    await cancelOrderAsCustomer(orderId, users.w2!, { correlationId: "corr-123" });

    const detail = await getOrderDetail(orderId, { userId: users.w2! });
    const cancelled = detail.history.find((h) => h.status === "CANCELLED");
    expect(cancelled?.actorType).toBe("customer");
    expect(cancelled?.actorId).toBe(users.w2!);
    expect(cancelled?.correlationId).toBe("corr-123");
    expect(cancelled?.previousStatus).toBe("PENDING");
  });
});

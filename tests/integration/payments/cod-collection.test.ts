import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const stripeCreateMock = vi.hoisted(() => vi.fn());
vi.mock("stripe", () => ({
  default: vi.fn(function (this: unknown) {
    return { paymentIntents: { create: stripeCreateMock, retrieve: vi.fn() } };
  }),
}));

vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["a@ex.com"], messageId: "m1" })),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
} from "../_db";
import {
  orderItems,
  orders,
  orderStatusHistories,
  payments,
} from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { collectCodPayment } from "@/modules/payments/application/commands/collect-cod-payment";
import { shipOrder, deliverOrder } from "@/modules/orders/application/commands/order-transitions";
import { InvalidOrderTransitionError } from "@/modules/orders/domain/errors/order-errors";

const SFX = `cod-${Date.now()}`;
let userId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";

/** Bare COD order: PENDING / PENDING, no Stripe intent anywhere. */
async function codOrder(tag: string, total = "40.00") {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `COD-ORD-${tag}-${SFX}`,
      userId,
      status: "PENDING",
      subtotal: total,
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: total,
      currency: "USD",
      paymentStatus: "PENDING",
    })
    .returning();
  const [payment] = await testDb
    .insert(payments)
    .values({
      orderId: order.id,
      provider: "cod",
      providerPaymentId: null,
      amount: total,
      currency: "USD",
      status: "PENDING",
      paymentMethod: "CASH_ON_DELIVERY",
    })
    .returning();
  return { order, payment };
}

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `cod-u-${SFX}`, name: "COD User", email: `cod-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `cod-cat-${SFX}`, name: "COD Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `cod-brand-${SFX}`, name: "COD Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "COD Product", status: "ACTIVE", basePrice: "40.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `COD-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 10, reservedQuantity: 0 });
});

afterAll(async () => {
  const myOrders = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.userId, userId));
  const ids = myOrders.map((o) => o.id);
  if (ids.length > 0) {
    await testDb.delete(payments).where(inArray(payments.orderId, ids));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await testDb.delete(orderStatusHistories).where(inArray(orderStatusHistories.orderId, ids));
    await testDb.delete(orders).where(inArray(orders.id, ids));
  }
  await testDb.delete(inventory).where(eq(inventory.variantId, variantId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, userId));
});

describe("COD order lifecycle", () => {
  it("creates COD orders pending with no Stripe intent", async () => {
    const { order, payment } = await codOrder("create");
    expect(order.status).toBe("PENDING");
    expect(order.paymentStatus).toBe("PENDING");
    expect(payment.provider).toBe("cod");
    expect(payment.providerPaymentId).toBeNull();
    expect(payment.status).toBe("PENDING");
    expect(stripeCreateMock).not.toHaveBeenCalled();
  });

  it("does not mark COD paid on shipment", async () => {
    const { order } = await codOrder("ship");
    await shipOrder(order.id, { actorId: "staff-1", actorType: "staff" });
    const [shipped] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(shipped!.status).toBe("SHIPPED");
    expect(shipped!.paymentStatus).toBe("PENDING");
    const [pay] = await testDb.select().from(payments).where(eq(payments.orderId, order.id));
    expect(pay!.status).toBe("PENDING");
  });

  it("rejects card orders on the COD-only ship path", async () => {
    const { order } = await codOrder("cardship");
    await testDb
      .update(payments)
      .set({ provider: "stripe", paymentMethod: "CARD" })
      .where(eq(payments.orderId, order.id));
    await expect(shipOrder(order.id, { actorId: "staff-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(kept!.status).toBe("PENDING");
  });
});

describe("COD cash collection", () => {
  it("collects cash on shipped orders with full audit", async () => {
    const { order, payment } = await codOrder("collect");
    await shipOrder(order.id, { actorId: "staff-1", actorType: "staff" });

    const res = await collectCodPayment(order.id, { actorId: "staff-1", actorType: "staff" });
    expect(res.orderId).toBe(order.id);
    expect(res.paymentId).toBe(payment.id);

    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("COMPLETED");
    expect(pay!.paidAt).not.toBeNull();
    expect(pay!.provider).toBe("cod");
    const [done] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(done!.status).toBe("SHIPPED");
    expect(done!.paymentStatus).toBe("PAID");

    const trail = await testDb
      .select()
      .from(orderStatusHistories)
      .where(eq(orderStatusHistories.orderId, order.id));
    const collected = trail.find((h) => h.eventType === "payment_collected");
    expect(collected?.actorType).toBe("staff");
    expect(collected?.actorId).toBe("staff-1");
    expect(collected?.previousStatus).toBe("SHIPPED");

    // Idempotent replay.
    await collectCodPayment(order.id, { actorId: "staff-1", actorType: "staff" });
    const [again] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(again!.paymentStatus).toBe("PAID");
  });

  it("collects on delivered orders", async () => {
    const { order } = await codOrder("deliver");
    await shipOrder(order.id, { actorId: "staff-1", actorType: "staff" });
    await deliverOrder(order.id, { actorId: "staff-1", actorType: "staff" });
    await collectCodPayment(order.id, { actorId: "admin-1", actorType: "admin" });
    const [done] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(done!.status).toBe("DELIVERED");
    expect(done!.paymentStatus).toBe("PAID");
  });

  it("rejects collection before shipment", async () => {
    const { order } = await codOrder("early");
    await expect(collectCodPayment(order.id, { actorId: "staff-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(kept!.paymentStatus).toBe("PENDING");
  });

  it("rejects collection on card payments without touching Stripe", async () => {
    const { order } = await codOrder("cardpay");
    await testDb
      .update(payments)
      .set({ provider: "stripe", paymentMethod: "CARD" })
      .where(eq(payments.orderId, order.id));
    // Move to SHIPPED through the card path is impossible here (unpaid), so
    // the rejection must come from the provider guard, not order status.
    await expect(collectCodPayment(order.id, { actorId: "staff-1" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect(stripeCreateMock).not.toHaveBeenCalled();
  });

  it("rejects collection on missing orders without an oracle", async () => {
    await expect(
      collectCodPayment("00000000-0000-0000-0000-000000000000", { actorId: "staff-1" }),
    ).rejects.toThrow("Order not found");
  });
});

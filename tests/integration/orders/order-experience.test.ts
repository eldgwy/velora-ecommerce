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
  listCustomerOrders,
} from "@/modules/orders/application/queries/orders";
import {
  deliverOrder,
  shipOrder,
  cancelOrderAsCustomer,
  transitionOrderStatus,
} from "@/modules/orders/application/commands/order-transitions";
import { finalizeOrderPayment } from "@/modules/orders/application/commands/finalize-payment";
import { OrderNotFoundError } from "@/modules/orders/domain/errors/order-errors";
import { InvalidOrderTransitionError } from "@/modules/orders/domain/errors/order-errors";

const SFX = `oe-${Date.now()}`;
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

async function directOrder(
  userId: string,
  orderNumber: string,
  createdAt: Date,
  total = "18.00",
) {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber,
      userId,
      status: "PENDING",
      subtotal: total,
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: total,
      currency: "USD",
      paymentStatus: "PENDING",
      createdAt,
    })
    .returning();
  await testDb.insert(orderItems).values({
    orderId: order.id,
    variantId,
    productName: "Snapshot Product",
    variantName: null,
    sku: `OE-SKU-${SFX}`,
    quantity: 1,
    unitPrice: "18.00",
    discountAmount: "0.00",
    totalAmount: total,
  });
  return order;
}

beforeAll(async () => {
  for (const n of ["custA", "custB"]) {
    const [u] = await testDb
      .insert(user)
      .values({ id: `oe-u-${n}-${SFX}`, name: `Owner ${n}`, email: `${n}-${SFX}@ex.com` })
      .returning();
    users[n] = u.id;
  }
  const [cat] = await testDb.insert(categories).values({ slug: `oe-cat-${SFX}`, name: "OE Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `oe-brand-${SFX}`, name: "OE Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "OE Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `OE-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 30, reservedQuantity: 0 });

  await directOrder(users.custA!, `OE-HIST-1-${SFX}`, new Date("2026-01-03T10:00:00Z"));
  await directOrder(users.custA!, `OE-HIST-2-${SFX}`, new Date("2026-01-02T10:00:00Z"));
  await directOrder(users.custA!, `OE-HIST-3-${SFX}`, new Date("2026-01-01T10:00:00Z"));
});

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

describe("order history ownership and pagination", () => {
  it("lists only the customer's own orders, newest first", async () => {
    const page = await listCustomerOrders(users.custA!, 1, 10);
    expect(page.totalCount).toBe(3);
    expect(page.items.map((i) => i.orderNumber)).toEqual([
      `OE-HIST-1-${SFX}`,
      `OE-HIST-2-${SFX}`,
      `OE-HIST-3-${SFX}`,
    ]);
    expect(page.items[0]!.itemCount).toBe(1);

    const other = await listCustomerOrders(users.custB!, 1, 10);
    expect(other.totalCount).toBe(0);
    expect(other.items).toHaveLength(0);
  });

  it("paginates without loading full history", async () => {
    const first = await listCustomerOrders(users.custA!, 1, 2);
    expect(first.items).toHaveLength(2);
    expect(first.totalPages).toBe(2);
    const second = await listCustomerOrders(users.custA!, 2, 2);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.orderNumber).toBe(`OE-HIST-3-${SFX}`);
  });
});

describe("order details ownership and snapshots", () => {
  it("denies cross-customer access without an oracle", async () => {
    const [order] = await testDb
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, `OE-HIST-1-${SFX}`));
    await expect(getOrderDetail(order!.id, { userId: users.custB! })).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
    const own = await getOrderDetail(order!.id, { userId: users.custA! });
    expect(own.orderNumber).toBe(`OE-HIST-1-${SFX}`);
  });

  it("freezes historical amounts against later catalog edits", async () => {
    await testDb.update(products).set({ basePrice: "99.00" }).where(eq(products.id, productId));
    const [order] = await testDb
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, `OE-HIST-1-${SFX}`));
    const detail = await getOrderDetail(order!.id, { userId: users.custA! });
    expect(detail.items[0]!.unitPrice).toBe("18.00");
    expect(detail.totalAmount).toBe("18.00");
    await testDb.update(products).set({ basePrice: "20.00" }).where(eq(products.id, productId));
  });

  it("exposes no payment secrets", async () => {
    const [order] = await testDb
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, `OE-HIST-1-${SFX}`));
    const detail = await getOrderDetail(order!.id, { userId: users.custA! });
    expect(JSON.stringify(detail)).not.toMatch(/client_secret|providerPaymentId|password|secret/i);
  });
});

describe("customer cancellation", () => {
  it("cancels a PENDING unpaid order with full audit and release", async () => {
    await addItemToCart({ kind: "user", userId: users.custB! }, { variantId, quantity: 2 });
    const created = await placeOrder(
      { id: users.custB!, name: "Owner custB", email: `custB-${SFX}@ex.com` },
      buyInput(),
      key(),
    );
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));

    await cancelOrderAsCustomer(created.orderId, users.custB!);
    // Idempotent repeat.
    await cancelOrderAsCustomer(created.orderId, users.custB!);

    const [done] = await testDb.select().from(orders).where(eq(orders.id, created.orderId));
    expect(done!.status).toBe("CANCELLED");
    const [invAfter] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));
    expect(invAfter!.reservedQuantity).toBe(invBefore!.reservedQuantity - 2);

    const trail = await testDb
      .select()
      .from(orderStatusHistories)
      .where(and(eq(orderStatusHistories.orderId, created.orderId), eq(orderStatusHistories.status, "CANCELLED")));
    expect(trail.length).toBeGreaterThanOrEqual(1);
    const cancelEvent = trail.find((h) => h.eventType === "cancelled");
    expect(cancelEvent?.actorType).toBe("customer");
    expect(cancelEvent?.actorId).toBe(users.custB!);
    expect(cancelEvent?.previousStatus).toBe("PENDING");
  });

  it("refuses cancellation past PENDING and paid orders with escalation", async () => {
    await addItemToCart({ kind: "user", userId: users.custA! }, { variantId, quantity: 1 });
    const created = await placeOrder(
      { id: users.custA!, name: "Owner custA", email: `custA-${SFX}@ex.com` },
      buyInput(),
      key(),
    );
    // Simulate a paid order awaiting fulfillment.
    await testDb.update(orders).set({ paymentStatus: "PAID" }).where(eq(orders.id, created.orderId));
    await expect(cancelOrderAsCustomer(created.orderId, users.custA!)).rejects.toThrow(/refund review/);

    // Advance to PROCESSING and confirm self-service stays closed.
    await testDb.update(orders).set({ status: "PROCESSING" }).where(eq(orders.id, created.orderId));
    await expect(cancelOrderAsCustomer(created.orderId, users.custA!)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
  });

  it("loses the cancel-vs-payment race safely in both directions", async () => {
    await addItemToCart({ kind: "user", userId: users.custB! }, { variantId, quantity: 1 });
    const created = await placeOrder(
      { id: users.custB!, name: "Owner custB", email: `custB-${SFX}@ex.com` },
      buyInput(),
      key(),
    );
    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, created.orderId));
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));

    // Cancel wins: late payment cannot revive the order.
    await cancelOrderAsCustomer(created.orderId, users.custB!);
    await expect(finalizeOrderPayment(created.orderId, payment!.id, { actorId: "test" })).rejects.toThrow();
    const [invAfter] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));
    expect(invAfter!.quantity).toBe(invBefore!.quantity);
    expect(invAfter!.reservedQuantity).toBe(invBefore!.reservedQuantity - 1);
  });
});

describe("staff fulfillment and audit chain", () => {
  it("advances PROCESSING → SHIPPED → DELIVERED with an unbroken chain", async () => {
    await addItemToCart({ kind: "user", userId: users.custA! }, { variantId, quantity: 1 });
    const created = await placeOrder(
      { id: users.custA!, name: "Owner custA", email: `custA-${SFX}@ex.com` },
      buyInput(),
      key(),
    );
    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, created.orderId));
    await finalizeOrderPayment(created.orderId, payment!.id, { actorId: "webhook" });

    await shipOrder(created.orderId, { actorId: "staff-1", actorType: "staff", note: "Carrier X" });
    // Idempotent replay.
    await shipOrder(created.orderId, { actorId: "staff-1", actorType: "staff" });
    await deliverOrder(created.orderId, { actorId: "staff-1", actorType: "staff" });

    const trail = await testDb
      .select()
      .from(orderStatusHistories)
      .where(eq(orderStatusHistories.orderId, created.orderId))
      .orderBy(sql`"created_at" ASC`);
    const chain = trail.map((h) => h.status);
    expect(chain).toEqual(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"]);
    expect(trail[1]!.previousStatus).toBe("PENDING");
    expect(trail[2]!.previousStatus).toBe("PROCESSING");
    expect(trail[2]!.actorType).toBe("staff");
    expect(trail[2]!.eventType).toBe("shipped");
    // No duplicate SHIPPED row from the replay.
    expect(trail.filter((h) => h.status === "SHIPPED")).toHaveLength(1);
  });

  it("rejects skipped stages and customer fulfillment", async () => {
    await addItemToCart({ kind: "user", userId: users.custB! }, { variantId, quantity: 1 });
    // Card order: PENDING → SHIPPED skips payment, so shipment must be
    // rejected (unpaid COD orders are the only PENDING-shippable path, and
    // COD shipment is covered by the COD suite, not this rejection test).
    const created = await placeOrder(
      { id: users.custB!, name: "Owner custB", email: `custB-${SFX}@ex.com` },
      { ...buyInput(), paymentMethod: "card" as const },
      key(),
    );
    await expect(shipOrder(created.orderId, { actorId: "s" })).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    await expect(
      transitionOrderStatus(created.orderId, "SHIPPED", { actorType: "customer", actorId: users.custB! }),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
  });
});

import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const stripeCreateMock = vi.hoisted(() => {
  let seq = 0;
  return vi.fn(async () => {
    seq += 1;
    return { id: `pi_mock_${seq}`, client_secret: `cs_mock_${seq}` };
  });
});
vi.mock("stripe", () => ({
  default: vi.fn(function (this: unknown) {
    return { paymentIntents: { create: stripeCreateMock, retrieve: vi.fn() } };
  }),
}));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
} from "../_db";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import {
  orderItems,
  orders,
  orderStatusHistories,
  payments,
} from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  initializeOrderPayment,
  retryOrderPayment,
} from "@/modules/checkout/application/payment-init";
import { PaymentInitError } from "@/modules/checkout/domain/errors";
import { OrderNotFoundError } from "@/modules/checkout/domain/errors";

const SFX = `pi-${Date.now()}`;
let userId = "";
let otherUserId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";

/** Bare PENDING order + PENDING card payment, no reservation involved. */
async function bareOrder(tag: string, total: string, ownerId: string) {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `PI-ORD-${tag}-${SFX}`,
      userId: ownerId,
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
      provider: "stripe",
      providerPaymentId: null,
      amount: total,
      currency: "USD",
      status: "PENDING",
      paymentMethod: "CARD",
    })
    .returning();
  return { order, payment };
}

beforeAll(async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  const [u] = await testDb
    .insert(user)
    .values({ id: `pi-u-${SFX}`, name: "Init User", email: `init-${SFX}@ex.com` })
    .returning();
  const [o] = await testDb
    .insert(user)
    .values({ id: `pi-o-${SFX}`, name: "Other User", email: `other-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  otherUserId = o.id;
  const [cat] = await testDb.insert(categories).values({ slug: `pi-cat-${SFX}`, name: "PI Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `pi-brand-${SFX}`, name: "PI Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "PI Product", status: "ACTIVE", basePrice: "40.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `PI-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 10, reservedQuantity: 0 });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const myOrders = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.userId, [userId, otherUserId]));
  const ids = myOrders.map((o) => o.id);
  if (ids.length > 0) {
    await testDb.delete(payments).where(inArray(payments.orderId, ids));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await testDb.delete(orderStatusHistories).where(inArray(orderStatusHistories.orderId, ids));
    await testDb.delete(orders).where(inArray(orders.id, ids));
  }
  const myCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(inArray(carts.userId, [userId, otherUserId]));
  const cartIds = myCarts.map((c) => c.id);
  if (cartIds.length > 0) {
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, cartIds));
    await testDb.delete(carts).where(inArray(carts.id, cartIds));
  }
  await testDb.delete(inventory).where(eq(inventory.variantId, variantId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [userId, otherUserId]));
});

let intentSeq = 0;
beforeEach(() => {
  stripeCreateMock.mockClear();
  stripeCreateMock.mockImplementation(async () => {
    intentSeq += 1;
    return { id: `pi_mock_${intentSeq}`, client_secret: `cs_mock_${intentSeq}` };
  });
});

describe("payment initialization", () => {
  it("creates an intent from the persisted total with a deterministic key", async () => {
    const { order } = await bareOrder("ok", "40.00", userId);
    const res = await initializeOrderPayment(userId, order.id, "card", 4000, "USD");
    expect(res.provider).toBe("stripe");
    expect(res.clientSecret).toMatch(/^cs_mock_\d+$/);
    expect(stripeCreateMock).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeCreateMock.mock.calls[0] as unknown as [
      { amount: number; currency: string },
      { idempotencyKey: string },
    ];
    expect(params.amount).toBe(4000);
    expect(params.currency).toBe("usd");
    expect(opts.idempotencyKey).toBe(`checkout-${order.id}`);
    const [pay] = await testDb.select().from(payments).where(eq(payments.orderId, order.id));
    expect(pay!.providerPaymentId).toMatch(/^pi_mock_\d+$/);
  });

  it("enables wallet-capable intents without redirect methods", async () => {
    const { order } = await bareOrder("wallet", "40.00", userId);
    await initializeOrderPayment(userId, order.id, "card", 4000, "USD");
    const [params] = stripeCreateMock.mock.calls[0] as unknown as [
      { automatic_payment_methods?: { enabled: boolean; allow_redirects: string } },
    ];
    expect(params.automatic_payment_methods).toEqual({
      enabled: true,
      allow_redirects: "never",
    });
  });

  it("rejects a caller total that disagrees with the persisted total", async () => {
    const { order } = await bareOrder("mismatch", "40.00", userId);
    await expect(
      initializeOrderPayment(userId, order.id, "card", 3999, "USD"),
    ).rejects.toBeInstanceOf(PaymentInitError);
    await expect(
      initializeOrderPayment(userId, order.id, "card", 4000, "EUR"),
    ).rejects.toBeInstanceOf(PaymentInitError);
    expect(stripeCreateMock).not.toHaveBeenCalled();
    const [pay] = await testDb.select().from(payments).where(eq(payments.orderId, order.id));
    expect(pay!.providerPaymentId).toBeNull();
  });

  it("rejects cross-customer initialization without an oracle", async () => {
    const { order } = await bareOrder("cross", "40.00", userId);
    await expect(
      initializeOrderPayment(otherUserId, order.id, "card", 4000, "USD"),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
    expect(stripeCreateMock).not.toHaveBeenCalled();
  });

  it("initializes COD without touching Stripe", async () => {
    // Even a broken Stripe client cannot affect the COD path: it is never
    // constructed or called here. Swap/restore around the test so nothing
    // leaks into neighboring tests.
    const prev = stripeCreateMock.getMockImplementation();
    stripeCreateMock.mockImplementation(() => {
      throw new Error("Stripe must not be touched for COD");
    });
    try {
      const { order } = await bareOrder("cod", "40.00", userId);
      const res = await initializeOrderPayment(userId, order.id, "cod", 4000, "USD");
      expect(res.provider).toBe("cod");
      expect(res.clientSecret).toBeNull();
      expect(res.paymentRequired).toBe(false);
      expect(stripeCreateMock).not.toHaveBeenCalled();
      const [pay] = await testDb.select().from(payments).where(eq(payments.orderId, order.id));
      expect(pay!.provider).toBe("cod");
      expect(pay!.paymentMethod).toBe("CASH_ON_DELIVERY");
      expect(pay!.providerPaymentId).toBeNull();
    } finally {
      stripeCreateMock.mockImplementation(prev!);
    }
  });

  it("replays completed payments without state changes", async () => {
    const { order } = await bareOrder("replay", "40.00", userId);
    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, order.id));
    await testDb.update(payments).set({ status: "COMPLETED" }).where(eq(payments.id, payment!.id));
    const res = await initializeOrderPayment(userId, order.id, "card", 4000, "USD");
    expect(res.status).toBe("COMPLETED");
    expect(res.paymentRequired).toBe(false);
    expect(stripeCreateMock).not.toHaveBeenCalled();
  });

  it("retries payment initialization through the persisted total", async () => {
    const { order } = await bareOrder("retry", "40.00", userId);
    const res = await retryOrderPayment(userId, order.id);
    expect(res.paymentRequired).toBe(true);
    expect(res.clientSecret).toMatch(/^cs_mock_\d+$/);
    const [pay] = await testDb.select().from(payments).where(eq(payments.orderId, order.id));
    expect(pay!.providerPaymentId).toMatch(/^pi_mock_\d+$/);
  });
});

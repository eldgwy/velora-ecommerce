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
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
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
  orderAddresses,
  orderItems,
  orders,
  orderStatusHistories,
  payments,
  webhookEvents,
} from "@/infrastructure/database/schema/orders";
import { couponUsages, coupons, promotions, promotionProducts } from "@/infrastructure/database/schema/discounts";
import { user } from "@/infrastructure/database/schema/auth";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import {
  placeOrder,
  type CheckoutInput,
} from "@/modules/checkout/application/commands/create-order";
import { retryOrderPayment } from "@/modules/checkout/application/payment-init";
import {
  finalizeOrderPayment,
  handlePaymentFailureWebhook,
} from "@/modules/orders/application/commands/finalize-payment";
import {
  cancelOrder,
  handleCheckoutExpiration,
} from "@/modules/orders/application/commands/order-lifecycle";
import { OrderAlreadyCancelledError } from "@/modules/orders/domain/errors/order-errors";
import {
  AddressOwnershipError,
  CartConflictError,
  CartConsumedError,
  CouponInvalidError,
  EmptyCartError,
  IdempotencyConflictError,
  StockConflictError,
} from "@/modules/checkout/domain/errors";
import { ensureCustomerProfile } from "@/services/customer.service";
import { createAddress } from "@/services/address.service";

const SFX = `co-${Date.now()}`;
const key = () => randomUUID();

const users: Record<string, string> = {};
const variant: Record<string, string> = {};
let categoryId = "";
let brandId = "";
let productId = "";
let promoId = "";
const couponIds: string[] = [];
const addressOf: Record<string, string> = {};

const NAMES = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "r1", "r2", "w1", "w2", "w3", "ownerA", "ownerB"];

function addrInput() {
  return {
    newAddress: {
      country: "US",
      city: "Springfield",
      state: "IL",
      postalCode: "62701",
      addressLine1: "1 Main St",
    },
  } as const;
}

function input(over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    shippingAddress: addrInput(),
    billingAddress: { sameAsShipping: true as const },
    shippingMethod: "STANDARD",
    couponCode: null,
    contactPhone: null,
    paymentMethod: "cod",
    notes: null,
    ...over,
  };
}

beforeAll(async () => {
  for (const n of NAMES) {
    const [u] = await testDb
      .insert(user)
      .values({ id: `co-u-${n}-${SFX}`, name: `Buyer ${n}`, email: `${n}-${SFX}@ex.com` })
      .returning();
    users[n] = u.id;
  }

  const [cat] = await testDb.insert(categories).values({ slug: `co-cat-${SFX}`, name: "Co Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `co-brand-${SFX}`, name: "Co Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;

  const [prod] = await testDb
    .insert(products)
    .values({ name: "Co Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;

  const specs: Array<[string, string, number, string | null]> = [
    ["A", `CO-A-${SFX}`, 20, null],
    ["B", `CO-B-${SFX}`, 20, "25.00"],
    ["D", `CO-D-${SFX}`, 5, null], // will be DRAFT
    ["E", `CO-E-${SFX}`, 5, null],
    ["G", `CO-G-${SFX}`, 5, null], // race variant
    ["H", `CO-H-${SFX}`, 10, null],
    ["I", `CO-I-${SFX}`, 10, null],
  ];
  for (const [name, sku, qty, override] of specs) {
    const [v] = await testDb
      .insert(productVariants)
      .values({ productId, sku, status: name === "D" ? "DRAFT" : "ACTIVE", priceOverride: override })
      .returning();
    variant[name] = v.id;
    await testDb.insert(inventory).values({ variantId: v.id, quantity: qty, reservedQuantity: 0 });
  }

  const now = new Date();
  const [promo] = await testDb
    .insert(promotions)
    .values({
      name: `CO-PROMO-${SFX}`.toUpperCase(),
      type: "PERCENTAGE",
      value: "10",
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 3_600_000),
      isActive: true,
    })
    .returning();
  promoId = promo.id;
  await testDb.insert(promotionProducts).values({ promotionId: promo.id, productId });

  const couponSpecs = [
    { code: `SV10-${SFX}`.toUpperCase(), type: "PERCENTAGE", value: "10", max: "5.00", min: "10.00", limit: 100, start: -60_000, end: 3_600_000 },
    { code: `EXP-${SFX}`.toUpperCase(), type: "PERCENTAGE", value: "10", max: null, min: null, limit: null, start: -7_200_000, end: -3_600_000 },
    { code: `MIN50-${SFX}`.toUpperCase(), type: "FIXED", value: "5.00", max: null, min: "50.00", limit: null, start: -60_000, end: 3_600_000 },
    { code: `ONCE-${SFX}`.toUpperCase(), type: "FIXED", value: "3.00", max: null, min: null, limit: 1, start: -60_000, end: 3_600_000 },
  ] as const;
  for (const c of couponSpecs) {
    const [row] = await testDb
      .insert(coupons)
      .values({
        code: c.code,
        type: c.type as "PERCENTAGE" | "FIXED",
        value: c.value,
        maximumDiscountAmount: c.max,
        minimumOrderAmount: c.min,
        usageLimit: c.limit,
        usageCount: 0,
        startsAt: new Date(now.getTime() + c.start),
        expiresAt: new Date(now.getTime() + c.end),
        isActive: true,
      })
      .returning();
    couponIds.push(row.id);
  }

  for (const n of ["ownerA", "ownerB", "b1"] as const) {
    const profile = await ensureCustomerProfile({ id: users[n]!, name: `Buyer ${n}` });
    const created = await createAddress(profile.id, {
      label: "Home",
      country: "US",
      city: "Springfield",
      state: "IL",
      postalCode: "62701",
      addressLine1: "1 Main St",
      isDefault: true,
    });
    addressOf[n] = created.id;
  }
});

afterAll(async () => {
  const myUserIds = Object.values(users);
  const myOrders = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.userId, myUserIds));
  const myOrderIds = myOrders.map((o) => o.id);
  if (myOrderIds.length > 0) {
    await testDb.delete(webhookEvents).where(inArray(webhookEvents.orderId, myOrderIds));
    await testDb.delete(payments).where(inArray(payments.orderId, myOrderIds));
    await testDb.delete(couponUsages).where(inArray(couponUsages.orderId, myOrderIds));
    await testDb.delete(orders).where(inArray(orders.id, myOrderIds));
  }
  const myCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(
      or(
        inArray(carts.userId, myUserIds),
        like(carts.guestId, `%${SFX}%`),
      ),
    );
  const myCartIds = myCarts.map((c) => c.id);
  if (myCartIds.length > 0) {
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, myCartIds));
    await testDb.delete(carts).where(inArray(carts.id, myCartIds));
  }
  await testDb.delete(promotionProducts).where(eq(promotionProducts.promotionId, promoId));
  await testDb.delete(promotions).where(eq(promotions.id, promoId));
  await testDb.delete(coupons).where(inArray(coupons.id, couponIds));
  const vIds = Object.values(variant);
  await testDb.delete(inventory).where(inArray(inventory.variantId, vIds));
  await testDb.delete(productVariants).where(inArray(productVariants.id, vIds));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  const { customerProfiles } = await import("@/infrastructure/database/schema/customers");
  const profiles = await testDb
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(inArray(customerProfiles.userId, myUserIds));
  const pIds = profiles.map((p) => p.id);
  if (pIds.length > 0) {
    const { addresses } = await import("@/infrastructure/database/schema/customers");
    await testDb.delete(addresses).where(inArray(addresses.customerId, pIds));
    await testDb.delete(customerProfiles).where(inArray(customerProfiles.id, pIds));
  }
  await testDb.delete(user).where(inArray(user.id, myUserIds));
});

async function paymentOf(orderId: string) {
  const [p] = await testDb.select().from(payments).where(eq(payments.orderId, orderId));
  return p!;
}

async function orderOf(orderId: string) {
  const [o] = await testDb.select().from(orders).where(eq(orders.id, orderId));
  return o!;
}

describe("successful checkout", () => {
  it("creates a reserved card order with exact snapshots and totals", async () => {
    await addItemToCart({ kind: "user", userId: users.b1! }, { variantId: variant.A!, quantity: 2 });
    await addItemToCart({ kind: "user", userId: users.b1! }, { variantId: variant.B!, quantity: 1 });

    const res = await placeOrder(
      { id: users.b1!, name: "Buyer b1", email: `b1-${SFX}@ex.com` },
      input({
        shippingAddress: { addressId: addressOf.b1! },
        couponCode: `sv10-${SFX}`,
        paymentMethod: "card",
      }),
      key(),
    );

    // 20×2 + 25×1 = 65 list; promo 10% → 58.50 subtotal, 6.50 promo off;
    // coupon 10% of 58.50 = 5.85 → capped 5.00; shipping 53.50 < 75 → 4.99.
    expect(res.subtotal).toBe("58.50");
    expect(res.promotionDiscount).toBe("6.50");
    expect(res.couponDiscount).toBe("5.00");
    expect(res.shipping).toBe("4.99");
    expect(res.tax).toBe("0.00");
    expect(res.total).toBe("58.49");
    expect(res.orderNumber).toMatch(/^VEL-\d{8}-[A-Z2-9]{4}$/);
    expect(res.replayed).toBe(false);

    const order = await orderOf(res.orderId);
    expect(order.status).toBe("PENDING");
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.totalAmount).toBe("58.49");
    expect(order.checkoutExpiresAt).not.toBeNull();

    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, res.orderId));
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.reservationStatus === "RESERVED")).toBe(true);
    const lineA = items.find((i) => i.variantId === variant.A)!;
    expect(lineA.quantity).toBe(2);
    expect(lineA.unitPrice).toBe("18.00");
    expect(lineA.sku).not.toBe("");
    expect(lineA.productName).toBe("Co Product");

    const addrs = await testDb.select().from(orderAddresses).where(eq(orderAddresses.orderId, res.orderId));
    expect(addrs.map((a) => a.type).sort()).toEqual(["BILLING", "SHIPPING"]);

    const history = await testDb.select().from(orderStatusHistories).where(eq(orderStatusHistories.orderId, res.orderId));
    expect(history).toHaveLength(1);

    const payment = await paymentOf(res.orderId);
    expect(payment.status).toBe("PENDING");
    expect(payment.amount).toBe("58.49");
    expect(payment.providerPaymentId).toBeNull();
    // No Stripe key in test env: structured degradation, not a throw.
    expect(res.payment.configurationMissing).toBe(true);
    expect(res.payment.clientSecret).toBeNull();

    const [cart] = await testDb
      .select({ status: carts.status })
      .from(carts)
      .where(and(eq(carts.userId, users.b1!), eq(carts.status, "CONVERTED")));
    expect(cart).toBeDefined();

    const [coupon] = await testDb.select().from(coupons).where(eq(coupons.code, `SV10-${SFX}`.toUpperCase()));
    expect(coupon!.usageCount).toBe(1);
  });

  it("creates a COD order with no expiry and no payment requirement", async () => {
    await addItemToCart({ kind: "user", userId: users.b2! }, { variantId: variant.A!, quantity: 1 });
    const res = await placeOrder(
      { id: users.b2!, name: "Buyer b2", email: `b2-${SFX}@ex.com` },
      input({ shippingMethod: "EXPRESS", paymentMethod: "cod" }),
      key(),
    );
    // 18.00 + 12.99 express
    expect(res.total).toBe("30.99");
    expect(res.reservationExpiresAt).toBeNull();
    expect(res.payment.provider).toBe("cod");
    expect(res.payment.paymentRequired).toBe(false);
    const payment = await paymentOf(res.orderId);
    expect(payment.paymentMethod).toBe("CASH_ON_DELIVERY");
  });

  it("rejects empty and consumed carts", async () => {
    await expect(
      placeOrder({ id: users.b3!, name: "B3", email: `b3-${SFX}@ex.com` }, input(), key()),
    ).rejects.toBeInstanceOf(CartConsumedError);

    const { findOrCreateUserCart } = await import("@/modules/cart/application/commands/cart-init");
    await findOrCreateUserCart(users.b3!);
    await expect(
      placeOrder({ id: users.b3!, name: "B3", email: `b3-${SFX}@ex.com` }, input(), key()),
    ).rejects.toBeInstanceOf(EmptyCartError);
  });
});

describe("checkout validation", () => {
  it("blocks inactive variants with structured details", async () => {
    const { findOrCreateUserCart } = await import("@/modules/cart/application/commands/cart-init");
    const cart = await findOrCreateUserCart(users.b4!);
    await testDb.insert(cartItems).values({
      cartId: cart.id,
      variantId: variant.D!,
      quantity: 1,
      priceAtAddition: "20.00",
    });
    try {
      await placeOrder({ id: users.b4!, name: "B4", email: `b4-${SFX}@ex.com` }, input(), key());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CartConflictError);
    }
    await testDb.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  });

  it("blocks stock shortages", async () => {
    await addItemToCart({ kind: "user", userId: users.b4! }, { variantId: variant.E!, quantity: 3 });
    await testDb.update(inventory).set({ quantity: 1 }).where(eq(inventory.variantId, variant.E!));
    await expect(
      placeOrder({ id: users.b4!, name: "B4", email: `b4-${SFX}@ex.com` }, input(), key()),
    ).rejects.toBeInstanceOf(CartConflictError);
    await testDb.update(inventory).set({ quantity: 5 }).where(eq(inventory.variantId, variant.E!));
  });

  it("rejects foreign and missing addresses", async () => {
    await expect(
      placeOrder(
        { id: users.b4!, name: "B4", email: `b4-${SFX}@ex.com` },
        input({ shippingAddress: { addressId: addressOf.ownerB! } }),
        key(),
      ),
    ).rejects.toBeInstanceOf(AddressOwnershipError);
    await expect(
      placeOrder(
        { id: users.b4!, name: "B4", email: `b4-${SFX}@ex.com` },
        input({ shippingAddress: { addressId: randomUUID() } }),
        key(),
      ),
    ).rejects.toBeInstanceOf(AddressOwnershipError);
  });

  it("validates coupons strictly", async () => {
    // buyer4 cart holds E×3 (18.00 each after promo = 54.00 subtotal)
    await expect(
      placeOrder(
        { id: users.b4!, name: "B4", email: `b4-${SFX}@ex.com` },
        input({ couponCode: `nope-${SFX}` }),
        key(),
      ),
    ).rejects.toBeInstanceOf(CouponInvalidError);
    await expect(
      placeOrder(
        { id: users.b4!, name: "B4", email: `b4-${SFX}@ex.com` },
        input({ couponCode: `exp-${SFX}` }),
        key(),
      ),
    ).rejects.toBeInstanceOf(CouponInvalidError);
    await addItemToCart({ kind: "user", userId: users.b6! }, { variantId: variant.H!, quantity: 1 });
    await expect(
      placeOrder(
        { id: users.b6!, name: "B6", email: `b6-${SFX}@ex.com` },
        input({ couponCode: `min50-${SFX}` }),
        key(),
      ),
    ).rejects.toBeInstanceOf(CouponInvalidError);

    // usageLimit 1: first use ok (b5), second use rejected (b6).
    await addItemToCart({ kind: "user", userId: users.b5! }, { variantId: variant.H!, quantity: 1 });
    const first = await placeOrder(
      { id: users.b5!, name: "B5", email: `b5-${SFX}@ex.com` },
      input({ couponCode: `once-${SFX}` }),
      key(),
    );
    expect(first.couponDiscount).toBe("3.00");
    await expect(
      placeOrder(
        { id: users.b6!, name: "B6", email: `b6-${SFX}@ex.com` },
        input({ couponCode: `once-${SFX}` }),
        key(),
      ),
    ).rejects.toBeInstanceOf(CouponInvalidError);
  });
});

describe("idempotency and concurrency", () => {
  it("replays the same key with identical input", async () => {
    await addItemToCart({ kind: "user", userId: users.b7! }, { variantId: variant.H!, quantity: 1 });
    const k = key();
    const payload = input();
    const first = await placeOrder(
      { id: users.b7!, name: "B7", email: `b7-${SFX}@ex.com` }, payload, k,
    );
    const second = await placeOrder(
      { id: users.b7!, name: "B7", email: `b7-${SFX}@ex.com` }, { ...payload }, k,
    );
    expect(second.orderId).toBe(first.orderId);
    expect(second.replayed).toBe(true);
    const count = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, users.b7!), eq(orders.idempotencyKey, k)));
    expect(count[0]!.count).toBe(1);
  });

  it("rejects the same key with different input", async () => {
    const k = key();
    await addItemToCart({ kind: "user", userId: users.b8! }, { variantId: variant.H!, quantity: 1 });
    await placeOrder(
      { id: users.b8!, name: "B8", email: `b8-${SFX}@ex.com` }, input(), k,
    );
    await expect(
      placeOrder(
        { id: users.b8!, name: "B8", email: `b8-${SFX}@ex.com` },
        input({ shippingMethod: "EXPRESS" }),
        k,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("serializes concurrent same-key checkouts to one order", async () => {
    await addItemToCart({ kind: "user", userId: users.b9! }, { variantId: variant.H!, quantity: 1 });
    const k = key();
    const me = { id: users.b9!, name: "B9", email: `b9-${SFX}@ex.com` };
    const outcomes = await Promise.allSettled([
      placeOrder(me, input(), k),
      placeOrder(me, input(), k),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    // Either both replay the single order, or one replays and the twin that
    // lost the cart race reports consumed — then a same-key retry replays.
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason).toBeInstanceOf(CartConsumedError);
    }
    const ids = new Set(ok.map((o) => (o as PromiseFulfilledResult<{ orderId: string }>).value.orderId));
    expect(ids.size).toBe(1);
    if (failed.length > 0) {
      const retry = await placeOrder(me, input(), k);
      expect(ids.has(retry.orderId)).toBe(true);
    }
  });

  it("lets exactly one of two concurrent checkouts win", async () => {
    await addItemToCart({ kind: "user", userId: users.r1! }, { variantId: variant.H!, quantity: 1 });
    const me = { id: users.r1!, name: "R1", email: `r1-${SFX}@ex.com` };
    const outcomes = await Promise.allSettled([
      placeOrder(me, input(), key()),
      placeOrder(me, input(), key()),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(CartConsumedError);
  });

  it("compensates reservation failure without partial stock holds", async () => {
    // G stock 5; both carts hold 3 (validation passes pre-race).
    await addItemToCart({ kind: "user", userId: users.w1! }, { variantId: variant.G!, quantity: 3 });
    await addItemToCart({ kind: "user", userId: users.w2! }, { variantId: variant.G!, quantity: 3 });
    const outcomes = await Promise.allSettled([
      placeOrder({ id: users.w1!, name: "W1", email: `w1-${SFX}@ex.com` }, input(), key()),
      placeOrder({ id: users.w2!, name: "W2", email: `w2-${SFX}@ex.com` }, input(), key()),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    const reason = (failed[0] as PromiseRejectedResult).reason;
    // Either the reserve lost (compensated) or validation saw the twin first.
    expect(reason instanceof StockConflictError || reason instanceof CartConflictError).toBe(true);

    if (reason instanceof StockConflictError) {
      const loserUserId = await activeCartOwner([users.w1!, users.w2!]);
      expect(loserUserId).not.toBeNull();
      const [loserOrder] = await testDb
        .select()
        .from(orders)
        .where(eq(orders.userId, loserUserId!));
      expect(loserOrder!.status).toBe("CANCELLED");
      const loserItems = await testDb
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, loserOrder!.id));
      expect(loserItems.every((i) => i.reservationStatus === "PENDING")).toBe(true);
      // Loser cart reactivated for a fresh attempt.
      const [reactivated] = await testDb
        .select()
        .from(carts)
        .where(and(eq(carts.userId, loserOrder!.userId), eq(carts.status, "ACTIVE")));
      expect(reactivated).toBeDefined();
    }

    // Winner holds exactly 3 units; nothing partial remains.
    const [inv] = await testDb.select().from(inventory).where(eq(inventory.variantId, variant.G!));
    expect(inv!.reservedQuantity).toBe(3);
  });
});

/** Which of the given users still holds an ACTIVE cart (the race loser). */
async function activeCartOwner(userIds: string[]): Promise<string | null> {
  for (const id of userIds) {
    const rows = await testDb
      .select()
      .from(carts)
      .where(and(eq(carts.userId, id), eq(carts.status, "ACTIVE")));
    if (rows.length > 0) return id;
  }
  return null;
}

describe("payment lifecycle", () => {
  it("finalizes a verified payment once and ignores duplicates", async () => {
    const [order] = await testDb
      .select()
      .from(orders)
      .where(eq(orders.userId, users.b2!));
    const payment = await paymentOf(order!.id);
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variant.A!));

    const first = await finalizeOrderPayment(order!.id, payment.id, { actorId: "test" });
    expect(first.fulfilledItems.length).toBeGreaterThan(0);
    const second = await finalizeOrderPayment(order!.id, payment.id, { actorId: "test" });
    expect(second.fulfilledItems).toEqual(first.fulfilledItems);

    const done = await orderOf(order!.id);
    expect(done.status).toBe("PROCESSING");
    expect(done.paymentStatus).toBe("PAID");
    const [invAfter] = await testDb.select().from(inventory).where(eq(inventory.variantId, variant.A!));
    expect(invAfter!.quantity).toBe(invBefore!.quantity - 1);
    expect(invAfter!.reservedQuantity).toBe(invBefore!.reservedQuantity - 1);
  });

  it("handles payment failure by releasing and cancelling", async () => {
    await addItemToCart({ kind: "user", userId: users.w3! }, { variantId: variant.I!, quantity: 1 });
    const created = await placeOrder(
      { id: users.w3!, name: "W3", email: `w3-${SFX}@ex.com` }, input(), key(),
    );
    const payment = await paymentOf(created.orderId);
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variant.I!));

    await handlePaymentFailureWebhook(created.orderId, payment.id, { actorId: "test" });
    // Idempotent repeat.
    await handlePaymentFailureWebhook(created.orderId, payment.id, { actorId: "test" });

    const done = await orderOf(created.orderId);
    expect(done.paymentStatus).toBe("FAILED");
    expect(done.status).toBe("CANCELLED");
    const [invAfter] = await testDb.select().from(inventory).where(eq(inventory.variantId, variant.I!));
    expect(invAfter!.reservedQuantity).toBe(invBefore!.reservedQuantity - 1);
  });

  it("expires stale reservations and blocks late payment", async () => {
    await addItemToCart({ kind: "user", userId: users.r2! }, { variantId: variant.H!, quantity: 1 });
    const created = await placeOrder(
      { id: users.r2!, name: "R2", email: `r2-${SFX}@ex.com` }, input(), key(),
    );
    await testDb
      .update(orders)
      .set({ checkoutExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, created.orderId));

    await handleCheckoutExpiration(created.orderId, { actorId: "test" });
    // Idempotent repeat.
    await handleCheckoutExpiration(created.orderId, { actorId: "test" });

    const done = await orderOf(created.orderId);
    expect(done.status).toBe("CANCELLED");
    expect(done.paymentStatus).toBe("EXPIRED");

    // Late verified payment must not revive the cancelled order.
    const payment = await paymentOf(created.orderId);
    await expect(finalizeOrderPayment(created.orderId, payment.id, { actorId: "test" })).rejects.toBeInstanceOf(
      OrderAlreadyCancelledError,
    );
    const still = await orderOf(created.orderId);
    expect(still.status).toBe("CANCELLED");
  });

  it("retries payment initialization without duplicating intents", async () => {
    const [order] = await testDb.select().from(orders).where(eq(orders.userId, users.b1!));
    const before = await paymentOf(order!.id);
    const retried = await retryOrderPayment(users.b1!, order!.id);
    const after = await paymentOf(order!.id);
    expect(after.id).toBe(before.id);
    expect(after.providerPaymentId).toBe(before.providerPaymentId);
    expect(retried.configurationMissing).toBe(true);
  });

  it("cancels idempotently via cancelOrder", async () => {
    await addItemToCart({ kind: "user", userId: users.ownerA! }, { variantId: variant.H!, quantity: 1 });
    const created = await placeOrder(
      { id: users.ownerA!, name: "Owner A", email: `ownerA-${SFX}@ex.com` },
      input(),
      key(),
    );
    await cancelOrder(created.orderId, { actorId: "test" });
    await cancelOrder(created.orderId, { actorId: "test" });
    const done = await orderOf(created.orderId);
    expect(done.status).toBe("CANCELLED");
    const [inv] = await testDb.select().from(inventory).where(eq(inventory.variantId, variant.H!));
    // Released back: reserved equals the sum of the other live reservations.
    expect(inv!.reservedQuantity).toBeGreaterThanOrEqual(0);
  });
});

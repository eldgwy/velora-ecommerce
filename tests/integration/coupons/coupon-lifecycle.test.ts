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
import { and, eq, inArray, like, or } from "drizzle-orm";
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
} from "@/infrastructure/database/schema/orders";
import { coupons, couponUsages } from "@/infrastructure/database/schema/discounts";
import { user } from "@/infrastructure/database/schema/auth";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import {
  placeOrder,
  type CheckoutInput,
} from "@/modules/checkout/application/commands/create-order";
import { previewCheckout } from "@/modules/checkout/application/queries/checkout-preview";
import { cancelOrderAsCustomer } from "@/modules/orders/application/commands/order-transitions";
import { handlePaymentFailure, handleCheckoutExpiration } from "@/modules/orders/application/commands/order-lifecycle";
import { setCouponActive, updateCoupon } from "@/modules/coupons/application/commands/coupons";
import { CouponInvalidError } from "@/modules/checkout/domain/errors";

const SFX = `cl-${Date.now()}`;
const key = () => randomUUID();

const users: Record<string, string> = {};
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";
const couponIds: string[] = [];

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

function me(n: string) {
  return { id: users[n]!, name: `Buyer ${n}`, email: `${n}-${SFX}@ex.com` };
}

async function stockCart(userKey: string, qty = 1) {
  await addItemToCart({ kind: "user", userId: users[userKey]! }, { variantId, quantity: qty });
}

async function usageCount(code: string): Promise<number> {
  const [c] = await testDb.select().from(coupons).where(eq(coupons.code, code));
  return c!.usageCount;
}

async function usageRowsForUser(couponCode: string, userKey: string) {
  const [c] = await testDb.select().from(coupons).where(eq(coupons.code, couponCode));
  return testDb
    .select()
    .from(couponUsages)
    .where(and(eq(couponUsages.couponId, c!.id), eq(couponUsages.userId, users[userKey]!)));
}

beforeAll(async () => {
  for (const n of ["a", "b", "c", "d", "e", "f"]) {
    const [u] = await testDb
      .insert(user)
      .values({ id: `cl-u-${n}-${SFX}`, name: `Buyer ${n}`, email: `${n}-${SFX}@ex.com` })
      .returning();
    users[n] = u.id;
  }
  const [cat] = await testDb.insert(categories).values({ slug: `cl-cat-${SFX}`, name: "CL Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `cl-brand-${SFX}`, name: "CL Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ name: "CL Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `CL-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 50, reservedQuantity: 0 });
}, 30000);

afterAll(async () => {
  const myUserIds = Object.values(users);
  const myOrders = await testDb.select({ id: orders.id }).from(orders).where(inArray(orders.userId, myUserIds));
  const myOrderIds = myOrders.map((o) => o.id);
  if (myOrderIds.length > 0) {
    await testDb.delete(payments).where(inArray(payments.orderId, myOrderIds));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, myOrderIds));
    await testDb.delete(orderAddresses).where(inArray(orderAddresses.orderId, myOrderIds));
    await testDb.delete(orderStatusHistories).where(inArray(orderStatusHistories.orderId, myOrderIds));
    await testDb.delete(couponUsages).where(inArray(couponUsages.orderId, myOrderIds));
    await testDb.delete(orders).where(inArray(orders.id, myOrderIds));
  }
  const myCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(or(inArray(carts.userId, myUserIds), like(carts.guestId, `%${SFX}%`)));
  const myCartIds = myCarts.map((c) => c.id);
  if (myCartIds.length > 0) {
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, myCartIds));
    await testDb.delete(carts).where(inArray(carts.id, myCartIds));
  }
  await testDb.delete(coupons).where(inArray(coupons.id, couponIds));
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
  const profileIds = profiles.map((p) => p.id);
  if (profileIds.length > 0) {
    await testDb.delete(addresses).where(inArray(addresses.customerId, profileIds));
    await testDb.delete(customerProfiles).where(inArray(customerProfiles.id, profileIds));
  }
  await testDb.delete(user).where(inArray(user.id, myUserIds));
});

async function makeCoupon(
  tag: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const code = `CL-${tag}-${SFX}`.toUpperCase();
  const [row] = await testDb
    .insert(coupons)
    .values({
      code,
      type: "FIXED",
      value: "3.00",
      usageCount: 0,
      isActive: true,
      ...extra,
    })
    .returning();
  couponIds.push(row.id);
  return code;
}

describe("per-user limits", () => {
  it("enforces the limit across sequential orders and frees other users", async () => {
    const code = await makeCoupon("peruser", { perUserLimit: 1 });
    await stockCart("a");
    const first = await placeOrder(me("a"), input({ couponCode: code }), key());
    expect(first.payment).toBeDefined();
    expect(await usageCount(code)).toBe(1);

    await stockCart("a");
    await expect(placeOrder(me("a"), input({ couponCode: code }), key())).rejects.toBeInstanceOf(
      CouponInvalidError,
    );

    await stockCart("b");
    await placeOrder(me("b"), input({ couponCode: code }), key());
    expect(await usageCount(code)).toBe(2);
  });

  it("lets exactly one checkout win the last global usage", async () => {
    // The coupon lock serializes Tx1: the loser observes the winner's
    // consumption and fails as an expected business error. Per-user checks
    // run inside the same locked transaction, so they share the guarantee.
    const code2 = await makeCoupon("globrace", { usageLimit: 1 });
    await stockCart("d");
    await stockCart("e");
    const [r1, r2] = await Promise.allSettled([
      placeOrder(me("d"), input({ couponCode: code2 }), key()),
      placeOrder(me("e"), input({ couponCode: code2 }), key()),
    ]);
    const ok = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(CouponInvalidError);
    expect(await usageCount(code2)).toBe(1);
  });
});

describe("duplicate submissions", () => {
  it("replays the same key without a second usage record", async () => {
    const code = await makeCoupon("idedup", { perUserLimit: 5 });
    await stockCart("f");
    const idem = key();
    const first = await placeOrder(me("f"), input({ couponCode: code }), idem);
    expect(first.replayed).toBe(false);
    const second = await placeOrder(me("f"), input({ couponCode: code }), idem);
    expect(second.replayed).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(await usageCount(code)).toBe(1);
    const rows = await usageRowsForUser(code, "f");
    expect(rows.filter((r) => r.orderId === first.orderId)).toHaveLength(1);
  });
});

describe("capacity release", () => {
  it("customer cancellation frees global and per-user capacity", async () => {
    const code = await makeCoupon("relcancel", { usageLimit: 1, perUserLimit: 1 });
    await stockCart("a");
    const created = await placeOrder(me("a"), input({ couponCode: code }), key());
    expect(await usageCount(code)).toBe(1);

    await cancelOrderAsCustomer(created.orderId, users.a!);
    expect(await usageCount(code)).toBe(0);
    const rows = await usageRowsForUser(code, "a");
    expect(rows).toHaveLength(0);

    // Capacity reusable by the same user.
    await stockCart("a");
    await placeOrder(me("a"), input({ couponCode: code }), key());
    expect(await usageCount(code)).toBe(1);
  });

  it("payment failure frees capacity", async () => {
    const code = await makeCoupon("relfail", { perUserLimit: 1 });
    await stockCart("b");
    const created = await placeOrder(me("b"), input({ couponCode: code }), key());
    expect(await usageCount(code)).toBe(1);

    await handlePaymentFailure(created.orderId, { actorId: "test" });
    expect(await usageCount(code)).toBe(0);

    await stockCart("b");
    await placeOrder(me("b"), input({ couponCode: code }), key());
    expect(await usageCount(code)).toBe(1);
  });

  it("checkout expiry frees capacity", async () => {
    const code = await makeCoupon("relexp", { perUserLimit: 1 });
    await stockCart("c");
    const created = await placeOrder(me("c"), input({ couponCode: code }), key());
    await testDb
      .update(orders)
      .set({ checkoutExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, created.orderId));

    await handleCheckoutExpiration(created.orderId, { actorId: "test" });
    expect(await usageCount(code)).toBe(0);

    await stockCart("c");
    await placeOrder(me("c"), input({ couponCode: code }), key());
    expect(await usageCount(code)).toBe(1);
  });

  it("repeat release calls never drive counters negative", async () => {
    const code = await makeCoupon("relidem", {});
    await stockCart("d");
    const created = await placeOrder(me("d"), input({ couponCode: code }), key());
    await cancelOrderAsCustomer(created.orderId, users.d!);
    await handlePaymentFailure(created.orderId, { actorId: "test" }).catch(() => undefined);
    const [c] = await testDb.select().from(coupons).where(eq(coupons.code, code));
    expect(c!.usageCount).toBe(0);
  });
});

describe("mid-flight invalidation", () => {
  it("deactivation between preview and order blocks placement", async () => {
    const code = await makeCoupon("deact", {});
    await stockCart("e");
    const preview = await previewCheckout(me("e"), input({ couponCode: code }));
    expect(preview.couponValid).toBe(true);

    const [c] = await testDb.select().from(coupons).where(eq(coupons.code, code));
    await setCouponActive(c!.id, false);

    await expect(placeOrder(me("e"), input({ couponCode: code }), key())).rejects.toBeInstanceOf(
      CouponInvalidError,
    );
    expect(await usageCount(code)).toBe(0);
  });

  it("expiration between preview and order blocks placement", async () => {
    const code = await makeCoupon("expwin", {
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await stockCart("f");
    const preview = await previewCheckout(me("f"), input({ couponCode: code }));
    expect(preview.couponValid).toBe(true);

    const [c] = await testDb.select().from(coupons).where(eq(coupons.code, code));
    await updateCoupon({
      id: c!.id,
      code,
      type: "FIXED",
      value: "3.00",
      isActive: true,
      startsAt: new Date(Date.now() - 7_200_000),
      expiresAt: new Date(Date.now() - 3_600_000),
    });

    await stockCart("f");
    await expect(placeOrder(me("f"), input({ couponCode: code }), key())).rejects.toBeInstanceOf(
      CouponInvalidError,
    );
  });
});

describe("snapshot integrity", () => {
  it("orders keep frozen discounts after coupon rename, edit, and deactivation", async () => {
    const code = await makeCoupon("snap", {});
    await stockCart("a");
    const created = await placeOrder(me("a"), input({ couponCode: code }), key());

    const [before] = await testDb.select().from(orders).where(eq(orders.id, created.orderId));
    const [usageBefore] = await testDb
      .select()
      .from(couponUsages)
      .where(eq(couponUsages.orderId, created.orderId));
    expect(usageBefore!.code).toBe(code);
    expect(usageBefore!.type).toBe("FIXED");
    expect(usageBefore!.value).toBe("3.00");

    const [c] = await testDb.select().from(coupons).where(eq(coupons.code, code));
    await updateCoupon({
      id: c!.id,
      code: `CL-SNAP2-${SFX}`.toUpperCase(),
      type: "PERCENTAGE",
      value: "50",
      isActive: true,
    });
    await setCouponActive(c!.id, false);

    const [after] = await testDb.select().from(orders).where(eq(orders.id, created.orderId));
    expect(after!.totalAmount).toBe(before!.totalAmount);
    expect(after!.discountAmount).toBe(before!.discountAmount);
    const [usageAfter] = await testDb
      .select()
      .from(couponUsages)
      .where(eq(couponUsages.orderId, created.orderId));
    expect(usageAfter!.code).toBe(code);
    expect(usageAfter!.discountAmount).toBe(usageBefore!.discountAmount);

    // Payment was initialized from the persisted snapshot total.
    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, created.orderId));
    expect(payment!.amount).toBe(before!.totalAmount);
  });
});

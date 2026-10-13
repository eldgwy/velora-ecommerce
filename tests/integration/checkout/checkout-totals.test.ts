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
import { eq, inArray, like, or, sql } from "drizzle-orm";
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
  payments,
} from "@/infrastructure/database/schema/orders";
import { coupons, promotions, promotionProducts } from "@/infrastructure/database/schema/discounts";import { user } from "@/infrastructure/database/schema/auth";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import {
  placeOrder,
  type CheckoutInput,
} from "@/modules/checkout/application/commands/create-order";
import { previewCheckout } from "@/modules/checkout/application/queries/checkout-preview";
import {
  AddressOwnershipError,
  CouponInvalidError,
  TotalChangedError,
} from "@/modules/checkout/domain/errors";

const SFX = `ct-${Date.now()}`;
const key = () => randomUUID();

const users: Record<string, string> = {};
const variant: Record<string, string> = {};
let categoryId = "";
let brandId = "";
let productId = "";
let promoId = "";
let t3addrId = "";
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

async function orderCount(userId: string): Promise<number> {
  const rows = await testDb
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.userId, userId));
  return rows[0]!.count;
}

beforeAll(async () => {
  for (const n of ["t1", "t2", "t3", "t4", "t5", "t6"]) {
    const [u] = await testDb
      .insert(user)
      .values({ id: `ct-u-${n}-${SFX}`, name: `Buyer ${n}`, email: `${n}-${SFX}@ex.com` })
      .returning();
    users[n] = u.id;
  }

  const [cat] = await testDb.insert(categories).values({ slug: `ct-cat-${SFX}`, name: "CT Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `ct-brand-${SFX}`, name: "CT Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;

  const [prod] = await testDb
    .insert(products)
    .values({ name: "CT Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;

  const [w] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `CT-W-${SFX}`, status: "ACTIVE", weightGrams: 1500 })
    .returning();
  const [nv] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `CT-N-${SFX}`, status: "ACTIVE", priceOverride: "25.00" })
    .returning();
  variant.W = w.id;
  variant.N = nv.id;
  await testDb.insert(inventory).values([
    { variantId: w.id, quantity: 20, reservedQuantity: 0 },
    { variantId: nv.id, quantity: 20, reservedQuantity: 0 },
  ]);

  const now = new Date();
  const [promo] = await testDb
    .insert(promotions)
    .values({
      name: `CT-PROMO-${SFX}`.toUpperCase(),
      type: "PERCENTAGE",
      value: "10",
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 3_600_000),
      isActive: true,
    })
    .returning();
  promoId = promo.id;
  await testDb.insert(promotionProducts).values({ promotionId: promo.id, productId });

  for (const c of [
    { code: `CT10-${SFX}`.toUpperCase(), type: "PERCENTAGE", value: "10", max: "5.00", min: "10.00", limit: 100 },
    { code: `CTONCE-${SFX}`.toUpperCase(), type: "FIXED", value: "3.00", max: null, min: null, limit: 1 },
  ] as const) {
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
        startsAt: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() + 3_600_000),
        isActive: true,
      })
      .returning();
    couponIds.push(row.id);
  }

  await addItemToCart({ kind: "user", userId: users.t1! }, { variantId: variant.W!, quantity: 2 });
  await addItemToCart({ kind: "user", userId: users.t1! }, { variantId: variant.N!, quantity: 1 });
  await addItemToCart({ kind: "user", userId: users.t5! }, { variantId: variant.W!, quantity: 1 });
  await addItemToCart({ kind: "user", userId: users.t6! }, { variantId: variant.W!, quantity: 1 });
  await addItemToCart({ kind: "user", userId: users.t6! }, { variantId: variant.N!, quantity: 1 });

  // One saved address owned by t3 for the cross-customer preview test.
  const { ensureCustomerProfile } = await import("@/services/customer.service");
  const { createAddress } = await import("@/services/address.service");
  const t3profile = await ensureCustomerProfile({ id: users.t3!, name: "Buyer t3" });
  const t3addr = await createAddress(t3profile.id, {
    label: "Home",
    country: "US",
    city: "Springfield",
    state: "IL",
    postalCode: "62701",
    addressLine1: "1 Main St",
    isDefault: true,
  });
  t3addrId = t3addr.id;
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
    await testDb.delete(orderAddresses).where(inArray(orderAddresses.orderId, myOrderIds));
    await testDb.delete(orders).where(inArray(orders.id, myOrderIds));
  }
  const { couponUsages } = await import("@/infrastructure/database/schema/discounts");
  if (myOrderIds.length > 0) {
    await testDb.delete(couponUsages).where(inArray(couponUsages.orderId, myOrderIds));
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

describe("preview and placement consistency", () => {
  const payload = () =>
    input({ couponCode: `ct10-${SFX}`, paymentMethod: "card" });

  it("computes identical totals in preview and placement with full snapshot", async () => {
    const [couponBefore] = await testDb.select().from(coupons).where(eq(coupons.code, `CT10-${SFX}`.toUpperCase()));
    const preview = await previewCheckout(me("t1"), payload());
    // Preview validates without consuming usage.
    const [couponAfterPreview] = await testDb.select().from(coupons).where(eq(coupons.code, `CT10-${SFX}`.toUpperCase()));
    expect(couponAfterPreview!.usageCount).toBe(couponBefore!.usageCount);
    expect(preview.cartValid).toBe(true);
    expect(preview.couponValid).toBe(true);
    expect(preview.subtotalCents).toBe(5850);
    expect(preview.promotionDiscountCents).toBe(650);
    expect(preview.couponDiscountCents).toBe(500);
    expect(preview.shippingCents).toBe(499);
    expect(preview.taxCents).toBe(0);
    expect(preview.totalCents).toBe(5849);
    expect(preview.taxConfigured).toBe(false);
    expect(preview.taxJurisdiction).toBe("UNCONFIGURED");
    expect(preview.weightKnown).toBe(false); // variant N has no weight
    expect(preview.pricingPolicyVersion).toBe("2");

    const placed = await placeOrder(me("t1"), payload(), key(), {
      expectedTotalCents: preview.totalCents,
    });
    expect(placed.replayed).toBe(false);
    expect(placed.total).toBe("58.49");
    expect(placed.taxJurisdiction).toBe("UNCONFIGURED");
    expect(placed.shippingMethod).toBe("STANDARD");
    expect(placed.pricingPolicyVersion).toBe("2");

    const [order] = await testDb.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order!.shippingMethod).toBe("STANDARD");
    expect(order!.taxJurisdiction).toBe("UNCONFIGURED");
    expect(order!.taxRateBps).toBe(0);
    expect(order!.taxableBase).toBe("53.50");
    expect(order!.pricingPolicyVersion).toBe("2");

    const lines = await testDb.select().from(orderItems).where(eq(orderItems.orderId, placed.orderId));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.promotionId).toBe(promoId);
    }

    // Stripe amount equals the persisted authoritative total.
    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, placed.orderId));
    expect(payment!.amount).toBe(order!.totalAmount);

    // Same-as-shipping snapshot equality.
    const addrs = await testDb.select().from(orderAddresses).where(eq(orderAddresses.orderId, placed.orderId));
    const ship = addrs.find((a) => a.type === "SHIPPING")!;
    const bill = addrs.find((a) => a.type === "BILLING")!;
    expect(bill.country).toBe(ship.country);
    expect(bill.city).toBe(ship.city);
    expect(bill.postalCode).toBe(ship.postalCode);
  });

  it("reports weight-known state without changing default-config totals", async () => {
    // Variant W carries 1500 g; N is weightless → mixed carts are unknown.
    const mixed = await previewCheckout(me("t6"), input());
    expect(mixed.weightKnown).toBe(false);
    expect(mixed.shippingCents).toBe(499);

    // Weight-only cart: known, same fee schedule (no weight limits configured).
    const weighed = await previewCheckout(me("t5"), input());
    expect(weighed.weightKnown).toBe(true);
    expect(weighed.subtotalCents).toBe(1800); // effective price already nets the promo
    expect(weighed.promotionDiscountCents).toBe(200);
    expect(weighed.shippingCents).toBe(499);
    expect(weighed.totalCents).toBe(1800 + 499);
  });
});

describe("total-change confirmation", () => {
  it("aborts placement on a stale expected total without creating an order", async () => {
    await addItemToCart({ kind: "user", userId: users.t2! }, { variantId: variant.W!, quantity: 1 });
    const before = await orderCount(users.t2!);
    await expect(
      placeOrder(me("t2"), input(), key(), { expectedTotalCents: 1 }),
    ).rejects.toBeInstanceOf(TotalChangedError);
    expect(await orderCount(users.t2!)).toBe(before);
  });

  it("places when the expected total matches the server total", async () => {
    const preview = await previewCheckout(me("t2"), input());
    const placed = await placeOrder(me("t2"), input(), key(), {
      expectedTotalCents: preview.totalCents,
    });
    expect(placed.total).toBe("22.99"); // 1800 effective + 499 shipping
  });
});

describe("coupon race and preview honesty", () => {
  it("lets exactly one checkout consume the last coupon usage", async () => {
    await addItemToCart({ kind: "user", userId: users.t3! }, { variantId: variant.W!, quantity: 1 });
    await addItemToCart({ kind: "user", userId: users.t4! }, { variantId: variant.W!, quantity: 1 });
    const code = `ctonce-${SFX}`;
    const outcomes = await Promise.allSettled([
      placeOrder(me("t3"), input({ couponCode: code }), key()),
      placeOrder(me("t4"), input({ couponCode: code }), key()),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(CouponInvalidError);

    const [coupon] = await testDb.select().from(coupons).where(eq(coupons.code, `CTONCE-${SFX}`.toUpperCase()));
    expect(coupon!.usageCount).toBe(1);
  });

  it("marks invalid coupons in preview without consuming them", async () => {
    const preview = await previewCheckout(me("t5"), input({ couponCode: "NOPE-999" }));
    expect(preview.couponValid).toBe(false);
    expect(preview.couponDiscountCents).toBe(0);
    expect(preview.couponMessage).toMatch(/not recognized/i);
  });

  it("rejects cross-customer addresses in preview", async () => {
    await expect(
      previewCheckout(me("t5"), input({ shippingAddress: { addressId: t3addrId } })),
    ).rejects.toBeInstanceOf(AddressOwnershipError);
  });
});

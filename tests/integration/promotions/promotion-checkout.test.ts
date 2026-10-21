import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray, like, or } from "drizzle-orm";
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
import {
  promotionProducts,
  promotions,
  coupons,
  couponUsages,
} from "@/infrastructure/database/schema/discounts";
import { user } from "@/infrastructure/database/schema/auth";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import {
  placeOrder,
  type CheckoutInput,
} from "@/modules/checkout/application/commands/create-order";
import { previewCheckout } from "@/modules/checkout/application/queries/checkout-preview";
import {
  createPromotion,
  mapProductToPromotion,
  setPromotionActive,
  unmapProductFromPromotion,
  updatePromotion,
} from "@/modules/promotions/application/commands/promotions";
import { TotalChangedError } from "@/modules/checkout/domain/errors";

const SFX = `pp-${Date.now()}`;
const key = () => randomUUID();

const users: Record<string, string> = {};
let categoryId = "";
let brandId = "";
let productId = "";
let product2Id = "";
let variantId = "";
let variant2Id = "";
const promotionIds: string[] = [];

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

async function track(id: string): Promise<string> {
  promotionIds.push(id);
  return id;
}

beforeAll(async () => {
  for (const n of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    const [u] = await testDb
      .insert(user)
      .values({ id: `pp-u-${n}-${SFX}`, name: `Buyer ${n}`, email: `${n}-${SFX}@ex.com` })
      .returning();
    users[n] = u.id;
  }
  const [cat] = await testDb.insert(categories).values({ slug: `pp-cat-${SFX}`, name: "PP Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `pp-brand-${SFX}`, name: "PP Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [p1] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "PP Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  const [p2] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "PP Product 2", status: "ACTIVE", basePrice: "30.00", categoryId, brandId })
    .returning();
  productId = p1.id;
  product2Id = p2.id;
  const [v1] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `PP-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  const [v2] = await testDb
    .insert(productVariants)
    .values({ productId: product2Id, sku: `PP-SKU2-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v1.id;
  variant2Id = v2.id;
  await testDb.insert(inventory).values([
    { variantId, quantity: 50, reservedQuantity: 0 },
    { variantId: variant2Id, quantity: 50, reservedQuantity: 0 },
  ]);
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
  await testDb.delete(promotionProducts).where(
    inArray(promotionProducts.productId, [productId, product2Id]),
  );
  await testDb.delete(promotions).where(inArray(promotions.id, promotionIds));
  await testDb.delete(inventory).where(
    inArray(inventory.variantId, [variantId, variant2Id]),
  );
  await testDb.delete(productVariants).where(
    inArray(productVariants.id, [variantId, variant2Id]),
  );
  await testDb.delete(products).where(inArray(products.id, [productId, product2Id]));
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

async function makeActivePromo(
  tag: string,
  terms: { type: "PERCENTAGE" | "FIXED"; value: string },
  productIds: string[] = [productId],
): Promise<string> {
  const { id } = await createPromotion({
    name: `PP ${tag} ${SFX}`,
    type: terms.type,
    value: terms.value,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3_600_000),
    isActive: true,
  });
  await track(id);
  for (const pid of productIds) await mapProductToPromotion(id, pid);
  return id;
}

// Promotion mappings persist across tests in this file; each test starts
// from a clean slate so expectations isolate to the promos it creates.
beforeEach(async () => {
  await testDb.delete(promotionProducts).where(
    inArray(promotionProducts.productId, [productId, product2Id]),
  );
});

describe("promotion windows and eligibility", () => {
  it("applies an active promotion and snapshots the line", async () => {
    const promoId = await makeActivePromo("win", { type: "PERCENTAGE", value: "10" });
    await addItemToCart({ kind: "user", userId: users.a! }, { variantId, quantity: 2 });
    const created = await placeOrder(me("a"), input(), key());

    // 2 × $20 → $36 effective; 10% → $4 promo; + $4.99 shipping.
    expect(created.subtotal).toBe("36.00");
    expect(created.promotionDiscount).toBe("4.00");
    expect(created.total).toBe("40.99");

    const [line] = await testDb.select().from(orderItems).where(eq(orderItems.orderId, created.orderId));
    expect(line!.unitPrice).toBe("18.00");
    expect(line!.discountAmount).toBe("4.00");
    expect(line!.totalAmount).toBe("36.00");
    expect(line!.promotionId).toBe(promoId);
    expect(line!.regularUnitPrice).toBe("20.00");
    expect(line!.promotionName).toBe(`PP win ${SFX}`);

    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, created.orderId));
    expect(payment!.amount).toBe("40.99");
  });

  it("ignores future, expired, inactive, and unmapped promotions", async () => {
    const now = Date.now();
    const future = await createPromotion({
      name: `PP future ${SFX}`, type: "PERCENTAGE", value: "50",
      startsAt: new Date(now + 3_600_000), endsAt: new Date(now + 7_200_000), isActive: true,
    });
    const expired = await createPromotion({
      name: `PP expired ${SFX}`, type: "PERCENTAGE", value: "50",
      startsAt: new Date(now - 7_200_000), endsAt: new Date(now - 3_600_000), isActive: true,
    });
    const off = await createPromotion({
      name: `PP off ${SFX}`, type: "PERCENTAGE", value: "50", isActive: false,
    });
    const other = await createPromotion({
      name: `PP other ${SFX}`, type: "PERCENTAGE", value: "50",
      startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000), isActive: true,
    });
    for (const r of [future, expired, off, other]) await track(r.id);
    // First three map to the bought product; the live one maps elsewhere.
    await mapProductToPromotion(future.id, productId);
    await mapProductToPromotion(expired.id, productId);
    await mapProductToPromotion(off.id, productId);
    await mapProductToPromotion(other.id, product2Id);

    await addItemToCart({ kind: "user", userId: users.b! }, { variantId, quantity: 1 });
    const created = await placeOrder(me("b"), input(), key());
    expect(created.promotionDiscount).toBe("0.00");
    expect(created.subtotal).toBe("20.00");
    const [line] = await testDb.select().from(orderItems).where(eq(orderItems.orderId, created.orderId));
    expect(line!.promotionId).toBeNull();
    expect(line!.unitPrice).toBe("20.00");
  });

  it("clamps fixed discounts at zero and totals quantities", async () => {
    await makeActivePromo("big", { type: "FIXED", value: "100.00" });
    await addItemToCart({ kind: "user", userId: users.c! }, { variantId, quantity: 3 });
    const created = await placeOrder(me("c"), input(), key());
    // 3 × $20 free; shipping still applies.
    expect(created.promotionDiscount).toBe("60.00");
    expect(created.total).toBe("4.99");
    const [line] = await testDb.select().from(orderItems).where(eq(orderItems.orderId, created.orderId));
    expect(line!.unitPrice).toBe("0.00");
  });
});

describe("overlap selection", () => {
  it("applies the lowest price and breaks ties by id", { timeout: 20_000 }, async () => {
    // 10% of $20 = $2 off (→ $18) vs $3 fixed (→ $17): fixed wins.
    const pct = await makeActivePromo("ov-pct", { type: "PERCENTAGE", value: "10" });
    const fix = await makeActivePromo("ov-fix", { type: "FIXED", value: "3.00" });
    await addItemToCart({ kind: "user", userId: users.d! }, { variantId, quantity: 1 });
    const created = await placeOrder(me("d"), input(), key());
    expect(created.promotionDiscount).toBe("3.00");
    const [line] = await testDb.select().from(orderItems).where(eq(orderItems.orderId, created.orderId));
    expect(line!.promotionId).toBe(fix);
    expect([pct, fix]).toContain(line!.promotionId);

    // Tie: 10% ($2) vs $2 fixed — lowest id wins, deterministically.
    const tieA = await makeActivePromo("ov-tiea", { type: "PERCENTAGE", value: "10" });
    const tieB = await makeActivePromo("ov-tieb", { type: "FIXED", value: "2.00" });
    const expected = [tieA, tieB].sort()[0];
    // Remove the stronger promos so the tie pair decides alone.
    await unmapProductFromPromotion(fix, productId);
    await unmapProductFromPromotion(pct, productId);
    await addItemToCart({ kind: "user", userId: users.e! }, { variantId, quantity: 1 });
    const tied = await placeOrder(me("e"), input(), key());
    const [tline] = await testDb.select().from(orderItems).where(eq(orderItems.orderId, tied.orderId));
    expect(tline!.promotionId).toBe(expected);
    expect(tline!.discountAmount).toBe("2.00");
  });
});

describe("preview agreement and mid-flight changes", () => {
  it("preview and placement select the same promotion", async () => {
    await makeActivePromo("agree", { type: "PERCENTAGE", value: "15" });
    await addItemToCart({ kind: "user", userId: users.f! }, { variantId, quantity: 1 });
    const preview = await previewCheckout(me("f"), input());
    expect(preview.promotionDiscountCents).toBe(300);

    const created = await placeOrder(
      me("f"),
      input(),
      key(),
      { expectedTotalCents: preview.totalCents },
    );
    expect(created.promotionDiscount).toBe("3.00");
    expect(created.total).toBe("21.99");
  });

  it("expiry between preview and placement fails closed via confirmation", async () => {
    const promoId = await makeActivePromo("midflight", { type: "PERCENTAGE", value: "20" });
    await addItemToCart({ kind: "user", userId: users.g! }, { variantId, quantity: 1 });
    const preview = await previewCheckout(me("g"), input());
    expect(preview.promotionDiscountCents).toBe(400);

    await setPromotionActive(promoId, false);
    // Stale confirmation no longer matches the recomputed total.
    await expect(
      placeOrder(me("g"), input(), key(), { expectedTotalCents: preview.totalCents }),
    ).rejects.toBeInstanceOf(TotalChangedError);

    // Fresh placement proceeds without the promotion.
    await addItemToCart({ kind: "user", userId: users.h! }, { variantId, quantity: 1 });
    const created = await placeOrder(me("h"), input(), key());
    expect(created.promotionDiscount).toBe("0.00");
  });

  it("replays the same key without duplicating the discount", async () => {
    await makeActivePromo("replay", { type: "FIXED", value: "2.50" });
    await addItemToCart({ kind: "user", userId: users.a! }, { variantId, quantity: 1 });
    const idem = key();
    const first = await placeOrder(me("a"), input(), idem);
    const second = await placeOrder(me("a"), input(), idem);
    expect(second.replayed).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(second.promotionDiscount).toBe(first.promotionDiscount);
  });
});

describe("coupon precedence and snapshots", () => {
  it("computes coupons on the promotional subtotal", async () => {
    await makeActivePromo("prec", { type: "PERCENTAGE", value: "10" });
    const [coupon] = await testDb
      .insert(coupons)
      .values({
        code: `PP-CPN-${SFX}`.toUpperCase(),
        type: "PERCENTAGE",
        value: "10",
        usageCount: 0,
        isActive: true,
      })
      .returning();
    try {
      await addItemToCart({ kind: "user", userId: users.b! }, { variantId, quantity: 1 });
      // $20 → $18 promo; 10% coupon on $18 = $1.80; + $4.99 shipping.
      const created = await placeOrder(me("b"), input({ couponCode: coupon.code }), key());
      expect(created.promotionDiscount).toBe("2.00");
      expect(created.couponDiscount).toBe("1.80");
      expect(created.total).toBe("21.19");
    } finally {
      await testDb.delete(couponUsages).where(eq(couponUsages.couponId, coupon.id));
      await testDb.delete(coupons).where(eq(coupons.id, coupon.id));
    }
  });

  it("freezes snapshots across promotion edits and deletion", async () => {
    const promoId = await makeActivePromo("froze", { type: "PERCENTAGE", value: "25" });
    await addItemToCart({ kind: "user", userId: users.c! }, { variantId, quantity: 1 });
    const created = await placeOrder(me("c"), input(), key());
    const [before] = await testDb.select().from(orderItems).where(eq(orderItems.orderId, created.orderId));
    expect(before!.regularUnitPrice).toBe("20.00");
    expect(before!.unitPrice).toBe("15.00");

    const [promo] = await testDb.select().from(promotions).where(eq(promotions.id, promoId));
    await updatePromotion({
      id: promoId,
      name: `PP froze-renamed ${SFX}`,
      type: "FIXED",
      value: "1.00",
      isActive: true,
    });
    await unmapProductFromPromotion(promoId, productId);
    await setPromotionActive(promoId, false);
    expect(promo!.name).not.toBe(`PP froze-renamed ${SFX}`);

    const [after] = await testDb.select().from(orderItems).where(eq(orderItems.orderId, created.orderId));
    expect(after!.unitPrice).toBe("15.00");
    expect(after!.discountAmount).toBe("5.00");
    expect(after!.regularUnitPrice).toBe("20.00");
    expect(after!.promotionId).toBe(promoId);
    expect(after!.promotionName).toBe(`PP froze ${SFX}`);
    const [order] = await testDb.select().from(orders).where(eq(orders.id, created.orderId));
    expect(order!.totalAmount).toBe("19.99");
  });
});

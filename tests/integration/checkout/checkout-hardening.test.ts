import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
}));

// Partial mock: only validateCouponForCheckout is stubbed per-test; every
// other export (consume/release) keeps its real implementation.
const couponStubs = vi.hoisted(() => ({
  impl: null as null | ((tx: unknown, code: string, subtotal: number) => Promise<never>),
}));
vi.mock("@/modules/checkout/application/coupon", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/checkout/application/coupon")>();
  return {
    ...actual,
    validateCouponForCheckout: async (tx: unknown, code: string, subtotal: number) => {
      if (couponStubs.impl) return couponStubs.impl(tx, code, subtotal);
      return actual.validateCouponForCheckout(tx as never, code, subtotal);
    },
  };
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
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
import { CouponInvalidError } from "@/modules/checkout/domain/errors";

const SFX = `ch-${Date.now()}`;

let userId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";
let couponId = "";
const CODE = `FULL-${Date.now()}`;

function input(over: Partial<CheckoutInput> = {}): CheckoutInput {
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
    shippingMethod: "STANDARD",
    couponCode: null,
    contactPhone: null,
    paymentMethod: "cod",
    notes: null,
    ...over,
  };
}

function me() {
  return { id: userId, name: "Hardening User", email: `hard-${SFX}@ex.com` };
}

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `ch-u-${SFX}`, name: "Hardening User", email: `hard-${SFX}@ex.com` })
    .returning();
  userId = u.id;

  const [cat] = await testDb
    .insert(categories)
    .values({ slug: `ch-cat-${SFX}`, name: "Hardening Cat" })
    .returning();
  const [br] = await testDb
    .insert(brands)
    .values({ slug: `ch-brand-${SFX}`, name: "Hardening Brand" })
    .returning();
  categoryId = cat.id;
  brandId = br.id;

  const [prod] = await testDb
    .insert(products)
    .values({ name: "Hardening Mug", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;

  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `CH-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 50, reservedQuantity: 0 });

  // FIXED coupon covering the whole merchandise subtotal (1 × $20.00).
  const [coupon] = await testDb
    .insert(coupons)
    .values({
      code: CODE,
      type: "FIXED",
      value: "20.00",
      usageLimit: 100,
      usageCount: 0,
      isActive: true,
    })
    .returning();
  couponId = coupon.id;

  await addItemToCart({ kind: "user", userId }, { variantId, quantity: 1 });
}, 30000);

beforeEach(() => {
  couponStubs.impl = null;
});

afterAll(async () => {
  const myOrders = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.userId, userId));
  const myOrderIds = myOrders.map((o) => o.id);
  if (myOrderIds.length > 0) {
    await testDb.delete(payments).where(inArray(payments.orderId, myOrderIds));
    await testDb.delete(couponUsages).where(inArray(couponUsages.orderId, myOrderIds));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, myOrderIds));
    await testDb.delete(orders).where(inArray(orders.id, myOrderIds));
  }
  const myCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.userId, userId));
  const myCartIds = myCarts.map((c) => c.id);
  if (myCartIds.length > 0) {
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, myCartIds));
    await testDb.delete(carts).where(inArray(carts.id, myCartIds));
  }
  await testDb.delete(coupons).where(eq(coupons.id, couponId));
  await testDb.delete(inventory).where(eq(inventory.variantId, variantId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  const { customerProfiles, addresses } = await import(
    "@/infrastructure/database/schema/customers"
  );
  const profiles = await testDb
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId));
  const pIds = profiles.map((p) => p.id);
  if (pIds.length > 0) {
    await testDb.delete(addresses).where(inArray(addresses.customerId, pIds));
    await testDb.delete(customerProfiles).where(inArray(customerProfiles.id, pIds));
  }
  await testDb.delete(user).where(eq(user.id, userId));
});

describe("preview coupon error classification", () => {
  it("reports coupon-domain failures as coupon-invalid without consuming usage", async () => {
    couponStubs.impl = async () => {
      throw new CouponInvalidError("That coupon has expired.");
    };
    const preview = await previewCheckout(me(), input({ couponCode: CODE }));
    expect(preview.couponValid).toBe(false);
    expect(preview.couponMessage).toMatch(/expired/i);
    expect(preview.couponDiscountCents).toBe(0);

    const [coupon] = await testDb.select().from(coupons).where(eq(coupons.id, couponId));
    expect(coupon!.usageCount).toBe(0);
  });

  it("rethrows infrastructure failures instead of misreporting them", async () => {
    couponStubs.impl = async () => {
      throw new Error("connection terminated");
    };
    await expect(previewCheckout(me(), input({ couponCode: CODE }))).rejects.toThrow(
      /connection terminated/,
    );
  });
});

describe("full-discount end-to-end consistency", () => {
  it("floors the taxable base at zero and persists preview-identical totals", async () => {
    const preview = await previewCheckout(me(), input({ couponCode: CODE }));
    expect(preview.couponValid).toBe(true);
    expect(preview.subtotalCents).toBe(2000);
    expect(preview.couponDiscountCents).toBe(2000);
    expect(preview.discountedBaseCents).toBe(0);
    expect(preview.taxableBaseCents).toBe(0);
    expect(preview.taxCents).toBe(0);
    // STANDARD under the free-shipping threshold: fee still applies.
    expect(preview.shippingCents).toBe(499);
    expect(preview.totalCents).toBe(499);

    const placed = await placeOrder(
      me(),
      input({ couponCode: CODE }),
      randomUUID(),
      { expectedTotalCents: preview.totalCents },
    );
    expect(placed.total).toBe("4.99");
    expect(placed.taxableBase).toBe("0.00");

    const [order] = await testDb.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order!.subtotal).toBe("20.00");
    expect(order!.discountAmount).toBe("20.00");
    expect(order!.shippingAmount).toBe("4.99");
    expect(order!.taxAmount).toBe("0.00");
    expect(order!.totalAmount).toBe("4.99");
    expect(order!.taxableBase).toBe("0.00");
    expect(order!.taxJurisdiction).toBe("UNCONFIGURED");
    expect(order!.pricingPolicyVersion).toBe("2");

    const [payment] = await testDb.select().from(payments).where(eq(payments.orderId, placed.orderId));
    expect(payment!.amount).toBe(order!.totalAmount);
  });
});

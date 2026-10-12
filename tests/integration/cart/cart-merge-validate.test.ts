import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

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
import { orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  promotions,
  promotionProducts,
} from "@/infrastructure/database/schema/discounts";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import { mergeGuestCartIntoUserCart } from "@/modules/cart/application/commands/merge-guest-cart";
import { findOrCreateGuestCart } from "@/modules/cart/application/commands/cart-init";
import { getCartDetail } from "@/modules/cart/application/queries/get-cart";
import { validateCartForCheckout } from "@/modules/cart/application/queries/validate-cart";

const SFX = `c2-${Date.now()}`;

/** SFX-tagged guest token so cleanup can find this file's guest carts. */
function gid(): string {
  return `g-${SFX}-${randomUUID()}`;
}

let userId = "";
let productId = "";
let vA = ""; // stock 10, base price 20.00
let vB = ""; // stock 3
let vInactive = ""; // DRAFT variant
let categoryId = "";
let brandId = "";

async function userCartId(): Promise<string> {
  const [row] = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.userId, userId), eq(carts.status, "ACTIVE")));
  return row!.id;
}

async function guestItemQty(guestId: string, variantId: string): Promise<number | null> {
  const [guest] = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.guestId, guestId), eq(carts.status, "ACTIVE")));
  if (!guest) return null;
  const [item] = await testDb
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, guest.id), eq(cartItems.variantId, variantId)));
  return item?.quantity ?? null;
}

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `cart-u-${SFX}`, name: "Merge User", email: `merge-${SFX}@ex.com` })
    .returning();
  userId = u.id;

  const [cat] = await testDb
    .insert(categories)
    .values({ slug: `m-cat-${SFX}`, name: "Merge Cat" })
    .returning();
  const [br] = await testDb
    .insert(brands)
    .values({ slug: `m-brand-${SFX}`, name: "Merge Brand" })
    .returning();
  categoryId = cat.id;
  brandId = br.id;

  const [prod] = await testDb
    .insert(products)
    .values({
      name: "Merge Product",
      status: "ACTIVE",
      basePrice: "20.00",
      categoryId,
      brandId,
    })
    .returning();
  productId = prod.id;

  const [a] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `M-SKU-A-${SFX}`, status: "ACTIVE" })
    .returning();
  const [b] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `M-SKU-B-${SFX}`, status: "ACTIVE" })
    .returning();
  const [d] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `M-SKU-D-${SFX}`, status: "DRAFT" })
    .returning();
  vA = a.id;
  vB = b.id;
  vInactive = d.id;

  await testDb.insert(inventory).values([
    { variantId: vA, quantity: 10, reservedQuantity: 0 },
    { variantId: vB, quantity: 3, reservedQuantity: 0 },
    { variantId: vInactive, quantity: 10, reservedQuantity: 0 },
  ]);
});

afterAll(async () => {
  // Scoped cleanup (see cart-lifecycle.test.ts): only this file's rows.
  const myCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(or(eq(carts.userId, userId), like(carts.guestId, `%${SFX}%`)));
  const myCartIds = myCarts.map((c) => c.id);
  if (myCartIds.length > 0) {
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, myCartIds));
    await testDb.delete(carts).where(inArray(carts.id, myCartIds));
  }
  const myPromos = await testDb
    .select({ id: promotions.id })
    .from(promotions)
    .where(like(promotions.name, `%${SFX}%`));
  const myPromoIds = myPromos.map((p) => p.id);
  if (myPromoIds.length > 0) {
    await testDb.delete(promotionProducts).where(inArray(promotionProducts.promotionId, myPromoIds));
    await testDb.delete(promotions).where(inArray(promotions.id, myPromoIds));
  }
  const variantIds = [vA, vB, vInactive].filter(Boolean);
  if (variantIds.length > 0) {
    await testDb.delete(inventory).where(inArray(inventory.variantId, variantIds));
    await testDb.delete(productVariants).where(inArray(productVariants.id, variantIds));
  }
  if (productId) await testDb.delete(products).where(eq(products.id, productId));
  if (brandId) await testDb.delete(brands).where(eq(brands.id, brandId));
  if (categoryId) await testDb.delete(categories).where(eq(categories.id, categoryId));
  if (userId) await testDb.delete(user).where(eq(user.id, userId));
});

describe("guest-to-user merge", () => {
  it("moves guest items into an empty authenticated cart and consumes it", async () => {
    const guestId = gid();
    await addItemToCart({ kind: "guest", guestId }, { variantId: vA, quantity: 2 });

    const result = await mergeGuestCartIntoUserCart(userId, guestId);

    expect(result.mergedItems).toHaveLength(1);
    expect(result.mergedItems[0]!.quantity).toBe(2);
    expect(result.mergedItems[0]!.wasExisting).toBe(false);
    expect(result.guestCartConsumed).toBe(true);

    const detail = await getCartDetail({ kind: "user", userId });
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]!.quantity).toBe(2);
  });

  it("combines quantities for an existing variant", async () => {
    const guestId = gid();
    await addItemToCart({ kind: "guest", guestId }, { variantId: vA, quantity: 3 });

    const result = await mergeGuestCartIntoUserCart(userId, guestId);

    expect(result.mergedItems).toHaveLength(1);
    expect(result.mergedItems[0]!.quantity).toBe(5); // 2 + 3
    expect(result.mergedItems[0]!.wasExisting).toBe(true);
    expect(result.guestCartConsumed).toBe(true);
  });

  it("reports inactive variants and retains them in the guest cart", async () => {
    const guestId = gid();
    await addItemToCart({ kind: "guest", guestId }, { variantId: vB, quantity: 1 });
    // vInactive cannot be added via addItem; insert directly to simulate a
    // variant that went inactive after the guest added it.
    const guestCart = await findOrCreateGuestCart(guestId);
    await testDb.insert(cartItems).values({
      cartId: guestCart.id,
      variantId: vInactive,
      quantity: 1,
      priceAtAddition: "20.00",
    });

    const result = await mergeGuestCartIntoUserCart(userId, guestId);

    expect(result.mergedItems.map((m) => m.variantId)).toContain(vB);
    expect(result.unavailableItems.map((m) => m.variantId)).toContain(vInactive);
    expect(result.unavailableItems[0]!.reason).toBe("inactive");
    expect(result.guestCartConsumed).toBe(false);
    // Retained for user resolution, not silently discarded.
    expect(await guestItemQty(guestId, vInactive)).toBe(1);
  });

  it("caps quantities at available stock, retains the remainder, and conserves units", async () => {
    const guestId = gid();
    // vB stock is 3; user cart already holds 1 from the previous test.
    await addItemToCart({ kind: "guest", guestId }, { variantId: vB, quantity: 3 });

    const result = await mergeGuestCartIntoUserCart(userId, guestId);

    // requested 1 + 3 = 4 > available 3 → capped at 3, remainder 1 retained
    expect(result.adjustedItems).toHaveLength(1);
    expect(result.adjustedItems[0]!.adjustedQuantity).toBe(3);
    expect(result.adjustedItems[0]!.requestedQuantity).toBe(4);
    expect(result.itemsRequiringAction).toHaveLength(1);
    expect(result.guestCartConsumed).toBe(false);

    const detail = await getCartDetail({ kind: "user", userId });
    const line = detail.items.find((i) => i.variantId === vB)!;
    const remainder = await guestItemQty(guestId, vB);
    expect(line.quantity + (remainder ?? 0)).toBe(4); // conservation
  });

  it("is idempotent: repeats only process leftovers without duplication", async () => {
    const guestId = gid();
    await addItemToCart({ kind: "guest", guestId }, { variantId: vA, quantity: 1 });

    const before = await getCartDetail({ kind: "user", userId });
    const beforeQty = before.items.find((i) => i.variantId === vA)!.quantity;

    const first = await mergeGuestCartIntoUserCart(userId, guestId);
    expect(first.guestCartConsumed).toBe(true);

    const second = await mergeGuestCartIntoUserCart(userId, guestId);
    expect(second.mergedItems).toHaveLength(0);
    expect(second.guestCartConsumed).toBe(true);

    const after = await getCartDetail({ kind: "user", userId });
    // vA was 5, +1 merged once (stock 10 allows 6) — never doubled.
    expect(after.items.find((i) => i.variantId === vA)!.quantity).toBe(beforeQty + 1);
  });

  it("serializes concurrent merges without duplicating quantities", async () => {
    const guestId = gid();
    await addItemToCart({ kind: "guest", guestId }, { variantId: vA, quantity: 1 });
    const before = await getCartDetail({ kind: "user", userId });
    const beforeQty = before.items.find((i) => i.variantId === vA)!.quantity;

    const [r1, r2] = await Promise.all([
      mergeGuestCartIntoUserCart(userId, guestId),
      mergeGuestCartIntoUserCart(userId, guestId),
    ]);
    const mergedTotal =
      r1.mergedItems.reduce((s, m) => s + m.quantity, 0) +
      r2.mergedItems.reduce((s, m) => s + m.quantity, 0);

    const after = await getCartDetail({ kind: "user", userId });
    const afterQty = after.items.find((i) => i.variantId === vA)!.quantity;
    // Exactly one merge moved the unit (or capped at stock 10).
    expect(afterQty - beforeQty).toBeLessThanOrEqual(1);
    expect(mergedTotal).toBeLessThanOrEqual(beforeQty + 1);
  });

  it("returns empty success when there is no guest cart", async () => {
    const result = await mergeGuestCartIntoUserCart(userId, `ghost-${SFX}`);
    expect(result.mergedItems).toHaveLength(0);
    expect(result.guestCartConsumed).toBe(true);
  });
});

describe("pre-checkout validation", () => {
  it("detects price changes while preserving the snapshot", async () => {
    await testDb
      .update(products)
      .set({ basePrice: "25.00" })
      .where(eq(products.id, productId));

    const result = await validateCartForCheckout({ kind: "user", userId });
    const line = result.items.find((i) => i.variantId === vA)!;
    expect(line.priceChanged).toBe(true);
    expect(line.priceAtAddition).toBe("20.00");
    expect(line.currentPrice).toBe("25.00");
    // Totals use the current authoritative price, not the snapshot.
    expect(Number(result.subtotal)).toBeGreaterThan(0);
  });

  it("flags inactive variants and stock shortages together", async () => {
    // Drain vB stock below the cart quantity (cart holds 3 of vB).
    await testDb
      .update(inventory)
      .set({ quantity: 1 })
      .where(eq(inventory.variantId, vB));

    const cartId = await userCartId();
    const guestCart = await findOrCreateGuestCart(`never-merged-${SFX}`);
    void guestCart;
    // Directly stage an inactive-variant line in the user cart.
    await testDb
      .insert(cartItems)
      .values({ cartId, variantId: vInactive, quantity: 1, priceAtAddition: "20.00" })
      .onConflictDoNothing();

    const result = await validateCartForCheckout({ kind: "user", userId });
    expect(result.valid).toBe(false);
    const types = result.errors.map((e) => e.type);
    expect(types).toContain("insufficient_stock");
    expect(types).toContain("variant_inactive");
    const short = result.items.find((i) => i.variantId === vB)!;
    expect(short.inStock).toBe(false);
    expect(short.maxAvailable).toBe(1);
  });

  it("computes subtotal and promotion discounts server-side", async () => {
    const now = new Date();
    const [promo] = await testDb
      .insert(promotions)
      .values({
        name: `M-Promo-${SFX}`,
        type: "PERCENTAGE",
        value: "10",
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 3_600_000),
        isActive: true,
      })
      .returning();
    await testDb.insert(promotionProducts).values({ promotionId: promo.id, productId });

    const result = await validateCartForCheckout({ kind: "user", userId });
    // Only billable (in-stock) lines contribute; discount = 10% of list.
    expect(Number(result.discountTotal)).toBeGreaterThan(0);
    expect(result.payableTotal).toBe(
      (Number(result.subtotal) - Number(result.discountTotal)).toFixed(2),
    );
  });

  it("surfaces expired promotions instead of silently dropping them", async () => {
    // Scoped swap: replace only this suite's promotion mapping (unscoped
    // deletes would wipe parallel suites' promotions in the shared DB).
    await testDb.delete(promotionProducts).where(eq(promotionProducts.productId, productId));
    const myPromos = await testDb
      .select({ id: promotions.id })
      .from(promotions)
      .where(like(promotions.name, `%${SFX}%`));
    const myPromoIds = myPromos.map((p) => p.id);
    if (myPromoIds.length > 0) {
      await testDb.delete(promotionProducts).where(inArray(promotionProducts.promotionId, myPromoIds));
      await testDb.delete(promotions).where(inArray(promotions.id, myPromoIds));
    }
    const now = new Date();
    const [promo] = await testDb
      .insert(promotions)
      .values({
        name: `M-Expired-${SFX}`,
        type: "PERCENTAGE",
        value: "50",
        startsAt: new Date(now.getTime() - 7_200_000),
        endsAt: new Date(now.getTime() - 3_600_000),
        isActive: true,
      })
      .returning();
    await testDb.insert(promotionProducts).values({ promotionId: promo.id, productId });

    const result = await validateCartForCheckout({ kind: "user", userId });
    const flagged = result.items.filter((i) =>
      i.warnings.some((w) => w.type === "promotion_expired"),
    );
    expect(flagged.length).toBeGreaterThan(0);
    await testDb.delete(promotionProducts).where(eq(promotionProducts.promotionId, promo.id));
    await testDb.delete(promotions).where(eq(promotions.id, promo.id));
  });

  it("creates no orders and reserves no stock", async () => {
    const [invBefore] = await testDb
      .select()
      .from(inventory)
      .where(eq(inventory.variantId, vA));
    // Scoped to this suite's user: parallel suites create their own orders
    // in the shared test database.
    const ordersBefore = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, userId));

    await validateCartForCheckout({ kind: "user", userId });
    await validateCartForCheckout({ kind: "user", userId });

    const [invAfter] = await testDb
      .select()
      .from(inventory)
      .where(eq(inventory.variantId, vA));
    const ordersAfter = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, userId));
    expect(invAfter!.reservedQuantity).toBe(invBefore!.reservedQuantity);
    expect(ordersAfter[0]!.count).toBe(ordersBefore[0]!.count);
  });

  it("rejects an empty cart with a structured error", async () => {
    const result = await validateCartForCheckout({
      kind: "guest",
      guestId: `empty-${SFX}`,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.type).toBe("empty_cart");
  });
});

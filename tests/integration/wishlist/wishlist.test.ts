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
  brands,
  categories,
  inventory,
  products,
  productVariants,
  testDb,
} from "../_db";
import { carts } from "@/infrastructure/database/schema/cart";
import { user } from "@/infrastructure/database/schema/auth";
import {
  wishlistItems,
  wishlists,
} from "@/infrastructure/database/schema/wishlist";
import {
  addProductToWishlist,
  getOrCreateWishlist,
  moveProductToCart,
  removeProductFromWishlist,
} from "@/modules/wishlist/application/commands/wishlist";
import {
  getSavedProductIds,
  getWishlistDetail,
} from "@/modules/wishlist/application/queries/wishlist";
import { ProductNotAvailableError } from "@/modules/wishlist/domain/errors";

const SFX = `wl-${Date.now()}`;

let userA = "";
let userB = "";
let categoryId = "";
let brandId = "";
let activeProductId = "";
let draftProductId = "";
let archivedProductId = "";
let activeVariantId = "";

beforeAll(async () => {
  for (const [key, name] of [["A", "Wishlist A"], ["B", "Wishlist B"]] as const) {
    const [u] = await testDb
      .insert(user)
      .values({ id: `wl-u-${key}-${SFX}`, name, email: `wl-${key}-${SFX}@ex.com` })
      .returning();
    if (key === "A") userA = u.id;
    else userB = u.id;
  }

  const [cat] = await testDb
    .insert(categories)
    .values({ slug: `wl-cat-${SFX}`, name: "Wishlist Cat" })
    .returning();
  const [br] = await testDb
    .insert(brands)
    .values({ slug: `wl-brand-${SFX}`, name: "Wishlist Brand" })
    .returning();
  categoryId = cat.id;
  brandId = br.id;

  const makeProduct = async (name: string, status: "ACTIVE" | "DRAFT" | "ARCHIVE") => {
    const [p] = await testDb
      .insert(products)
      .values({ name, status, basePrice: "49.00", categoryId, brandId })
      .returning();
    return p.id;
  };
  activeProductId = await makeProduct("Wishlist Jacket", "ACTIVE");
  draftProductId = await makeProduct("Wishlist Draft", "DRAFT");
  archivedProductId = await makeProduct("Wishlist Retired", "ARCHIVE");

  const [variant] = await testDb
    .insert(productVariants)
    .values({ productId: activeProductId, sku: `WL-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  activeVariantId = variant.id;
  await testDb
    .insert(inventory)
    .values({ variantId: activeVariantId, quantity: 10, reservedQuantity: 0 });
});

afterAll(async () => {
  // FK-safe teardown: items before wishlists and products.
  const lists = await testDb
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(inArray(wishlists.userId, [userA, userB]));
  const listIds = lists.map((l) => l.id);
  if (listIds.length > 0) {
    await testDb.delete(wishlistItems).where(inArray(wishlistItems.wishlistId, listIds));
    await testDb.delete(wishlists).where(inArray(wishlists.id, listIds));
  }
  const userCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(inArray(carts.userId, [userA, userB]));
  const cartIds = userCarts.map((c) => c.id);
  if (cartIds.length > 0) {
    const { cartItems } = await import("@/infrastructure/database/schema/cart");
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, cartIds));
    await testDb.delete(carts).where(inArray(carts.id, cartIds));
  }
  await testDb.delete(inventory).where(eq(inventory.variantId, activeVariantId));
  // A parallel suite must never reference foreign variants, but if a stray
  // order_items row ever attaches to our fixtures mid-teardown, the variant
  // RESTRICT would fail the whole cleanup. Sweep strays scoped strictly to
  // our own variant ids before removing them.
  const { orderItems } = await import("@/infrastructure/database/schema/orders");
  await testDb.delete(orderItems).where(eq(orderItems.variantId, activeVariantId));
  await testDb.delete(productVariants).where(eq(productVariants.id, activeVariantId));
  for (const pid of [activeProductId, draftProductId, archivedProductId]) {
    await testDb.delete(products).where(eq(products.id, pid));
  }
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [userA, userB]));
});

describe("wishlist creation and ownership", () => {
  it("creates one wishlist per customer and returns it on repeat calls", async () => {
    const first = await getOrCreateWishlist(userA);
    const second = await getOrCreateWishlist(userA);
    expect(first.id).toBe(second.id);
    expect(first.userId).toBe(userA);
  });

  it("keeps wishlists isolated between customers", async () => {
    const mine = await getOrCreateWishlist(userA);
    const theirs = await getOrCreateWishlist(userB);
    expect(mine.id).not.toBe(theirs.id);
  });
});

describe("add product", () => {
  it("saves an eligible product", async () => {
    const { item, wasExisting } = await addProductToWishlist(userA, activeProductId);
    expect(wasExisting).toBe(false);
    expect(item.productId).toBe(activeProductId);
  });

  it("treats repeated adds as idempotent", async () => {
    const { item, wasExisting } = await addProductToWishlist(userA, activeProductId);
    expect(wasExisting).toBe(true);
    expect(item.productId).toBe(activeProductId);

    const wishlist = await getOrCreateWishlist(userA);
    const rows = await testDb
      .select()
      .from(wishlistItems)
      .where(
        and(
          eq(wishlistItems.wishlistId, wishlist.id),
          eq(wishlistItems.productId, activeProductId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("rejects draft, archived, and missing products", async () => {
    await expect(addProductToWishlist(userA, draftProductId)).rejects.toBeInstanceOf(
      ProductNotAvailableError,
    );
    await expect(addProductToWishlist(userA, archivedProductId)).rejects.toBeInstanceOf(
      ProductNotAvailableError,
    );
    await expect(addProductToWishlist(userA, randomUUID())).rejects.toBeInstanceOf(
      ProductNotAvailableError,
    );
  });

  it("enforces wishlist_items_wishlist_product_unique at the database", async () => {
    const wishlist = await getOrCreateWishlist(userB);
    await testDb.insert(wishlistItems).values({
      wishlistId: wishlist.id,
      productId: activeProductId,
    });
    try {
      await testDb.insert(wishlistItems).values({
        wishlistId: wishlist.id,
        productId: activeProductId,
      });
      expect.unreachable("duplicate insert must fail");
    } catch (error) {
      // Drizzle wraps the driver error; the unique-violation code (23505)
      // travels on the cause chain.
      let code: unknown;
      let current: unknown = error;
      for (let i = 0; i < 4 && current; i += 1) {
        if (typeof current === "object" && current !== null && "code" in current) {
          code = (current as { code?: unknown }).code;
          break;
        }
        current =
          typeof current === "object" && current !== null && "cause" in current
            ? (current as { cause?: unknown }).cause
            : null;
      }
      expect(code).toBe("23505");
      // Tie the behavior to the exact required index name. (Drizzle
      // `uniqueIndex` materializes as a unique *index*, visible in
      // pg_indexes rather than pg_constraint.)
      const rows = (await testDb.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'wishlist_items_wishlist_product_unique'
        ) AS "exists"
      `)) as unknown as Array<{ exists: boolean }>;
      expect(rows[0]?.exists).toBe(true);
    }
  });

  it("serializes concurrent adds to a single row", async () => {
    const [p] = await testDb
      .insert(products)
      .values({ name: "Race Tee", status: "ACTIVE", basePrice: "29.00", categoryId, brandId })
      .returning();
    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, () => addProductToWishlist(userB, p.id)),
      );
      expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);

      const wishlist = await getOrCreateWishlist(userB);
      const rows = await testDb
        .select()
        .from(wishlistItems)
        .where(
          and(
            eq(wishlistItems.wishlistId, wishlist.id),
            eq(wishlistItems.productId, p.id),
          ),
        );
      expect(rows).toHaveLength(1);
    } finally {
      await removeProductFromWishlist(userB, p.id);
      await testDb.delete(products).where(eq(products.id, p.id));
    }
  });
});

describe("remove product", () => {
  it("removes only the requested item", async () => {
    const { removed } = await removeProductFromWishlist(userA, activeProductId);
    expect(removed).toBe(true);
    const detail = await getWishlistDetail(userA);
    expect(detail.items.map((i) => i.productId)).not.toContain(activeProductId);
  });

  it("reports absent items without error", async () => {
    const { removed } = await removeProductFromWishlist(userA, activeProductId);
    expect(removed).toBe(false);
  });

  it("cannot affect another customer's wishlist", async () => {
    // userB still has activeProductId saved (unique-constraint test above).
    const { removed } = await removeProductFromWishlist(userA, activeProductId);
    expect(removed).toBe(false);
    const theirs = await getWishlistDetail(userB);
    expect(theirs.items.map((i) => i.productId)).toContain(activeProductId);
    // Clean up for later tests.
    await removeProductFromWishlist(userB, activeProductId);
  });
});

describe("get wishlist", () => {
  it("returns an empty wishlist for new customers", async () => {
    const detail = await getWishlistDetail(userB);
    expect(detail).toEqual({ wishlistId: expect.any(String), items: [], itemCount: 0 });
  });

  it("returns populated items with live catalog data", async () => {
    await addProductToWishlist(userA, activeProductId);
    const detail = await getWishlistDetail(userA);
    expect(detail.itemCount).toBe(1);
    const [item] = detail.items;
    expect(item?.productName).toBe("Wishlist Jacket");
    expect(item?.basePrice).toBe("49.00");
    expect(item?.status).toBe("ACTIVE");
    expect(item?.slug).toBe(activeProductId);
  });

  it("lists archived products with their status instead of hiding them", async () => {
    const wishlist = await getOrCreateWishlist(userA);
    // Stage directly: archived products are rejected by add (correctly),
    // but rows saved before archival must remain visible for removal.
    await testDb
      .insert(wishlistItems)
      .values({ wishlistId: wishlist.id, productId: archivedProductId })
      .onConflictDoNothing();
    const detail = await getWishlistDetail(userA);
    const archived = detail.items.find((i) => i.productId === archivedProductId);
    expect(archived?.status).toBe("ARCHIVE");
    await removeProductFromWishlist(userA, archivedProductId);
  });

  it("checks membership in a single batched query", async () => {
    const saved = await getSavedProductIds(userA, [activeProductId, draftProductId, randomUUID()]);
    expect(saved.has(activeProductId)).toBe(true);
    expect(saved.has(draftProductId)).toBe(false);
    expect(await getSavedProductIds(userA, [])).toEqual(new Set());
  });
});

describe("cascades", () => {
  it("deletes items when the wishlist is deleted", async () => {
    const wishlist = await getOrCreateWishlist(userB);
    await addProductToWishlist(userB, activeProductId);
    await testDb.delete(wishlists).where(eq(wishlists.id, wishlist.id));
    const rows = await testDb
      .select()
      .from(wishlistItems)
      .where(eq(wishlistItems.wishlistId, wishlist.id));
    expect(rows).toHaveLength(0);
  });

  it("deletes items when the product is deleted", async () => {
    const [p] = await testDb
      .insert(products)
      .values({ name: "Doomed Scarf", status: "ACTIVE", basePrice: "19.00", categoryId, brandId })
      .returning();
    await addProductToWishlist(userB, p.id);
    await testDb.delete(products).where(eq(products.id, p.id));
    const detail = await getWishlistDetail(userB);
    expect(detail.items.map((i) => i.productId)).not.toContain(p.id);
  });
});

describe("move to cart", () => {
  it("moves a saved product into the cart and removes the save", async () => {
    await addProductToWishlist(userA, activeProductId);
    const { cartId } = await moveProductToCart(userA, activeProductId);
    expect(typeof cartId).toBe("string");
    const detail = await getWishlistDetail(userA);
    expect(detail.items.map((i) => i.productId)).not.toContain(activeProductId);

    const { cartItems } = await import("@/infrastructure/database/schema/cart");
    const lines = await testDb
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, cartId));
    expect(lines.length).toBeGreaterThan(0);
  });

  it("refuses products that are not saved or not purchasable", async () => {
    await expect(moveProductToCart(userA, draftProductId)).rejects.toBeInstanceOf(
      ProductNotAvailableError,
    );
    await expect(moveProductToCart(userA, randomUUID())).rejects.toBeInstanceOf(
      ProductNotAvailableError,
    );
  });
});

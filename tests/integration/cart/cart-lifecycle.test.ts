import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

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
import { user } from "@/infrastructure/database/schema/auth";
import {
  findOrCreateUserCart,
  findOrCreateGuestCart,
  getOwnedCart,
} from "@/modules/cart/application/commands/cart-init";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import {
  removeCartItem,
  updateCartItemQuantity,
} from "@/modules/cart/application/commands/update-item";
import {
  InsufficientStockError,
  InvalidCartItemQuantityError,
  ProductInactiveError,
  UnauthorizedCartAccessError,
  VariantInactiveError,
  VariantNotFoundError,
} from "@/modules/cart/domain/errors";

const SFX = `c1-${Date.now()}`;

let userA = "";
let userB = "";
let categoryId = "";
let brandId = "";
let productId = "";
let archivedProductId = "";
let activeVariant = "";
let secondVariant = "";
let draftVariant = "";
let archivedProductVariant = "";

beforeAll(async () => {
  const [uA] = await testDb
    .insert(user)
    .values({ id: `cart-u-a-${SFX}`, name: "Cart A", email: `cart-a-${SFX}@ex.com` })
    .returning();
  const [uB] = await testDb
    .insert(user)
    .values({ id: `cart-u-b-${SFX}`, name: "Cart B", email: `cart-b-${SFX}@ex.com` })
    .returning();
  userA = uA.id;
  userB = uB.id;

  const [cat] = await testDb
    .insert(categories)
    .values({ slug: `cart-cat-${SFX}`, name: "Cart Cat" })
    .returning();
  const [br] = await testDb
    .insert(brands)
    .values({ slug: `cart-brand-${SFX}`, name: "Cart Brand" })
    .returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`,
      name: "Cart Product",
      status: "ACTIVE",
      basePrice: "20.00",
      categoryId: cat.id,
      brandId: br.id,
    })
    .returning();
  productId = prod.id;

  const [v1] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `CART-SKU-1-${SFX}`, status: "ACTIVE" })
    .returning();
  const [v2] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `CART-SKU-2-${SFX}`, status: "ACTIVE" })
    .returning();
  const [vDraft] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `CART-SKU-D-${SFX}`, status: "DRAFT" })
    .returning();
  activeVariant = v1.id;
  secondVariant = v2.id;
  draftVariant = vDraft.id;

  await testDb.insert(inventory).values([
    { variantId: activeVariant, quantity: 10, reservedQuantity: 0 },
    { variantId: secondVariant, quantity: 10, reservedQuantity: 0 },
    { variantId: draftVariant, quantity: 10, reservedQuantity: 0 },
  ]);

  const [archProd] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`,
      name: "Archived Product",
      status: "ARCHIVE",
      basePrice: "15.00",
      categoryId: cat.id,
      brandId: br.id,
    })
    .returning();
  archivedProductId = archProd.id;
  const [archVar] = await testDb
    .insert(productVariants)
    .values({ productId: archProd.id, sku: `CART-SKU-A-${SFX}`, status: "ACTIVE" })
    .returning();
  archivedProductVariant = archVar.id;
  await testDb
    .insert(inventory)
    .values({ variantId: archivedProductVariant, quantity: 10, reservedQuantity: 0 });
});

afterAll(async () => {
  // Scoped cleanup: only rows created by this file (tracked by SFX-tagged
  // ids). The suite shares one database across parallel workers, so unscoped
  // deletes would wipe other suites' fixtures.
  const myCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(or(inArray(carts.userId, [userA, userB]), like(carts.guestId, `%${SFX}%`)));
  const myCartIds = myCarts.map((c) => c.id);
  if (myCartIds.length > 0) {
    await testDb.delete(cartItems).where(inArray(cartItems.cartId, myCartIds));
    await testDb.delete(carts).where(inArray(carts.id, myCartIds));
  }
  const variantIds = [activeVariant, secondVariant, draftVariant, archivedProductVariant].filter(Boolean);
  if (variantIds.length > 0) {
    await testDb.delete(inventory).where(inArray(inventory.variantId, variantIds));
    await testDb.delete(productVariants).where(inArray(productVariants.id, variantIds));
  }
  const productIds = [productId, archivedProductId].filter(Boolean);
  if (productIds.length > 0) {
    await testDb.delete(products).where(inArray(products.id, productIds));
  }
  if (brandId) await testDb.delete(brands).where(eq(brands.id, brandId));
  if (categoryId) await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [userA, userB]));
});

describe("cart initialization", () => {
  it("creates one ACTIVE cart and returns it on repeat calls", async () => {
    const first = await findOrCreateUserCart(userA);
    const second = await findOrCreateUserCart(userA);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("ACTIVE");
  });

  it("converges concurrent initialization to a single ACTIVE cart", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => findOrCreateUserCart(userB)),
    );
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    const rows = await testDb
      .select()
      .from(carts)
      .where(and(eq(carts.userId, userB), eq(carts.status, "ACTIVE")));
    expect(rows).toHaveLength(1);
  });

  it("keeps guest and user carts separate", async () => {
    const guest = await findOrCreateGuestCart(`guest-${SFX}`);
    const mine = await findOrCreateUserCart(userA);
    expect(guest.id).not.toBe(mine.id);
    expect(guest.userId).toBeNull();
  });

  it("denies cross-user cart access", async () => {
    const mine = await findOrCreateUserCart(userA);
    expect(await getOwnedCart({ kind: "user", userId: userB }, mine.id)).toBeNull();
    expect(
      await getOwnedCart({ kind: "user", userId: userA }, mine.id),
    ).not.toBeNull();
  });

  it("enforces the single-active-cart invariant at the database", async () => {
    await expect(
      testDb.insert(carts).values({ userId: userA, guestId: null, status: "ACTIVE" }),
    ).rejects.toThrow();
  });
});

describe("add item", () => {
  it("adds a valid item with a server-resolved price snapshot", async () => {
    const res = await addItemToCart({ kind: "user", userId: userA }, { variantId: activeVariant, quantity: 2 });
    expect(res.item.quantity).toBe(2);
    expect(res.item.priceAtAddition).toBe("20.00");
    expect(res.wasExisting).toBe(false);
  });

  it("combines quantities when the variant is already present", async () => {
    const res = await addItemToCart({ kind: "user", userId: userA }, { variantId: activeVariant, quantity: 1 });
    expect(res.item.quantity).toBe(3);
    expect(res.wasExisting).toBe(true);
  });

  it("rejects a missing variant", async () => {
    await expect(
      addItemToCart({ kind: "user", userId: userA }, { variantId: randomUUID(), quantity: 1 }),
    ).rejects.toBeInstanceOf(VariantNotFoundError);
  });

  it("rejects inactive variants and inactive products", async () => {
    await expect(
      addItemToCart({ kind: "user", userId: userA }, { variantId: draftVariant, quantity: 1 }),
    ).rejects.toBeInstanceOf(VariantInactiveError);
    await expect(
      addItemToCart({ kind: "user", userId: userA }, { variantId: archivedProductVariant, quantity: 1 }),
    ).rejects.toBeInstanceOf(ProductInactiveError);
  });

  it("rejects zero, negative, fractional, and oversized quantities", async () => {
    for (const quantity of [0, -2, 1.5, 1000]) {
      await expect(
        addItemToCart({ kind: "user", userId: userA }, { variantId: secondVariant, quantity }),
      ).rejects.toBeInstanceOf(InvalidCartItemQuantityError);
    }
  });

  it("rejects quantities beyond available stock", async () => {
    // activeVariant holds 3 already, stock is 10 → 3 + 8 = 11 > 10
    await expect(
      addItemToCart({ kind: "user", userId: userA }, { variantId: activeVariant, quantity: 8 }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("serializes concurrent additions: one row, totals within stock", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        addItemToCart({ kind: "user", userId: userB }, { variantId: secondVariant, quantity: 2 }),
      ),
    );
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    expect(ok.length).toBe(5);

    const cart = await findOrCreateUserCart(userB);
    const rows = await testDb
      .select()
      .from(cartItems)
      .where(
        and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, secondVariant)),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(10);
  });

  it("enforces the (cart, variant) uniqueness constraint", async () => {
    const cart = await findOrCreateUserCart(userA);
    await expect(
      testDb.insert(cartItems).values({ cartId: cart.id, variantId: activeVariant, quantity: 1 }),
    ).rejects.toThrow();
  });

  it("enforces the positive-quantity CHECK constraint", async () => {
    const cart = await findOrCreateUserCart(userA);
    await expect(
      testDb.insert(cartItems).values({ cartId: cart.id, variantId: secondVariant, quantity: 0 }),
    ).rejects.toThrow();
  });
});

describe("update and remove", () => {
  it("updates to a valid quantity and refreshes the snapshot", async () => {
    const cart = await findOrCreateUserCart(userA);
    const [item] = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));
    const res = await updateCartItemQuantity(
      { kind: "user", userId: userA },
      { itemId: item!.id, quantity: 4 },
    );
    expect(res.status).toBe("updated");
    if (res.status === "updated") expect(res.item.quantity).toBe(4);
  });

  it("deletes the row when quantity is zero", async () => {
    const cart = await findOrCreateUserCart(userA);
    const [item] = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));
    const res = await updateCartItemQuantity(
      { kind: "user", userId: userA },
      { itemId: item!.id, quantity: 0 },
    );
    expect(res.status).toBe("deleted");
    const remaining = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));
    expect(remaining).toHaveLength(0);
  });

  it("rejects updates beyond available stock", async () => {
    await addItemToCart({ kind: "user", userId: userA }, { variantId: activeVariant, quantity: 1 });
    const cart = await findOrCreateUserCart(userA);
    const [item] = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));
    await expect(
      updateCartItemQuantity({ kind: "user", userId: userA }, { itemId: item!.id, quantity: 11 }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("denies cross-user updates", async () => {
    const cart = await findOrCreateUserCart(userA);
    const [item] = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));
    await expect(
      updateCartItemQuantity({ kind: "user", userId: userB }, { itemId: item!.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(UnauthorizedCartAccessError);
  });

  it("makes repeated removal safe", async () => {
    const cart = await findOrCreateUserCart(userA);
    const [item] = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));
    const first = await removeCartItem({ kind: "user", userId: userA }, { itemId: item!.id });
    const second = await removeCartItem({ kind: "user", userId: userA }, { itemId: item!.id });
    expect(first.status).toBe("deleted");
    expect(second.status).toBe("deleted");
  });

  it("keeps concurrent updates consistent (single row, in-stock qty)", async () => {
    await addItemToCart({ kind: "user", userId: userB }, { variantId: activeVariant, quantity: 1 });
    const cart = await findOrCreateUserCart(userB);
    const [item] = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));

    const outcomes = await Promise.allSettled([
      updateCartItemQuantity({ kind: "user", userId: userB }, { itemId: item!.id, quantity: 6 }),
      updateCartItemQuantity({ kind: "user", userId: userB }, { itemId: item!.id, quantity: 7 }),
    ]);
    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);

    const rows = await testDb
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, activeVariant)));
    expect(rows).toHaveLength(1);
    expect([6, 7]).toContain(rows[0]!.quantity);
  });
});

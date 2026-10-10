/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: any) => fn,
  updateTag: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  inventoryMovements,
  testDb,
} from "../_db";
import {
  adjustStock,
  adjustReservation,
  setStock,
  getInventoryByVariant,
  InsufficientStockError,
} from "@/services/inventory.service";

let rootId = "",
  childId = "",
  brandId = "",
  productId = "",
  variantId = "",
  inventoryId = "";

beforeAll(async () => {
  const [root] = await testDb
    .insert(categories)
    .values({ slug: "inv-root", name: "Inv Root" })
    .returning();
  rootId = root.id;
  const [child] = await testDb
    .insert(categories)
    .values({ slug: "inv-child", name: "Inv Child", parentId: rootId })
    .returning();
  childId = child.id;
  const [br] = await testDb
    .insert(brands)
    .values({ slug: "inv-brand", name: "Inv Brand" })
    .returning();
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({
      name: "Inv Product",
      status: "ACTIVE",
      basePrice: "10.00",
      categoryId: childId,
      brandId,
    })
    .returning();
  productId = prod.id;
  const [variant] = await testDb
    .insert(productVariants)
    .values({
      productId,
      sku: "INV-SKU-001",
      status: "ACTIVE",
      priceOverride: "12.00",
    })
    .returning();
  variantId = variant.id;
  const [inv] = await testDb
    .insert(inventory)
    .values({ variantId, quantity: 10, reservedQuantity: 0 })
    .returning();
  inventoryId = inv.id;
});

afterEach(async () => {
  await testDb
    .update(inventory)
    .set({ quantity: 10, reservedQuantity: 0 })
    .where(eq(inventory.id, inventoryId));
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId));
});

afterAll(async () => {
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId));
  await testDb.delete(inventory).where(eq(inventory.id, inventoryId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, childId));
  await testDb.delete(categories).where(eq(categories.id, rootId));
});

describe("inventory availability invariant: available = quantity - reserved >= 0", () => {
  it("increase on-hand stock (RESTOCK)", async () => {
    const r = await adjustStock(variantId, 5, "RESTOCK", { reason: "inbound" }, "test-admin");
    expect(r.quantity).toBe(15);
    expect(r.reservedQuantity).toBe(0);
    expect(r.available).toBe(15);
  });

  it("decrease on-hand stock but keep available non-negative", async () => {
    const r = await adjustStock(variantId, -4, "SALE", { reason: "sold" }, "test-admin");
    expect(r.quantity).toBe(6);
    expect(r.reservedQuantity).toBe(0);
    expect(r.available).toBe(6);
  });

  it("throws InsufficientStockError when delta drives available negative (with reserved held)", async () => {
    await adjustReservation(variantId, 8, "RESERVATION", { reason: "cart" }, "test-admin");

    await expect(
      adjustStock(variantId, -5, "SALE", undefined, "test-admin"),
    ).rejects.toThrow(InsufficientStockError);

    const unchanged = await getInventoryByVariant(variantId);
    expect(unchanged?.quantity).toBe(10);
    expect(unchanged?.reservedQuantity).toBe(8);
    expect(unchanged?.available).toBe(2);
  });
});

describe("setStock absolute invariant: quantity >= reservedQuantity", () => {
  it("sets quantity above reserved", async () => {
    await adjustReservation(variantId, 4, "RESERVATION", {}, "test-admin");
    const r = await setStock(variantId, 10, { reason: "physical count" }, "test-admin");
    expect(r.quantity).toBe(10);
    expect(r.reservedQuantity).toBe(4);
    expect(r.available).toBe(6);
  });

  it("throws InsufficientStockError when target is below reservedQuantity", async () => {
    await adjustReservation(variantId, 8, "RESERVATION", {}, "test-admin");
    await expect(
      setStock(variantId, 3, undefined, "test-admin"),
    ).rejects.toThrow(InsufficientStockError);

    const unchanged = await getInventoryByVariant(variantId);
    expect(unchanged?.quantity).toBe(10);
    expect(unchanged?.reservedQuantity).toBe(8);
  });
});

describe("adjustReservation invariants: 0 <= reserved <= quantity", () => {
  it("reserve up to on-hand (no over-reserve)", async () => {
    const r = await adjustReservation(variantId, 10, "RESERVATION", {}, "test-admin");
    expect(r.reservedQuantity).toBe(10);
    expect(r.available).toBe(0);
  });

  it("throws when reserving beyond on-hand quantity", async () => {
    await adjustReservation(variantId, 9, "RESERVATION", {}, "test-admin");
    await expect(
      adjustReservation(variantId, 2, "RESERVATION", undefined, "test-admin"),
    ).rejects.toThrow(InsufficientStockError);
  });

  it("throws when releasing more than currently reserved", async () => {
    await adjustReservation(variantId, 6, "RESERVATION", {}, "test-admin");
    await expect(
      adjustReservation(variantId, -10, "RELEASE", undefined, "test-admin"),
    ).rejects.toThrow(InsufficientStockError);
    const unchanged = await getInventoryByVariant(variantId);
    expect(unchanged?.reservedQuantity).toBe(6);
  });
});

describe("inventory_movements audit trail", () => {
  it("records a movement row on successful stock adjustment", async () => {
    const r = await adjustStock(variantId, -3, "SALE", { reason: "order #1" }, "test-admin");
    expect(r.available).toBe(7);

    const movements = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId));
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(-3);
    expect(movements[0].type).toBe("SALE");
  });

  it("records ADJUSTMENT delta for setStock", async () => {
    await adjustReservation(variantId, 4, "RESERVATION", {}, "test-admin");
    await setStock(variantId, 10, undefined, "test-admin");

    const movements = await testDb
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventoryId));
    expect(movements).toHaveLength(2);
    const adj = movements.find((m) => m.type === "ADJUSTMENT");
    expect(adj).toBeDefined();
  });
});

describe("getInventoryByVariant", () => {
  it("returns derived available = quantity - reserved", async () => {
    await adjustStock(variantId, 0, "RESTOCK", {}, "test-admin");
    const inv = await getInventoryByVariant(variantId);
    expect(inv).not.toBeNull();
    expect(inv!.quantity).toBe(10);
    expect(inv!.reservedQuantity).toBe(0);
    expect(inv!.available).toBe(10);
    expect(inv!.productId).toBe(productId);
  });
});

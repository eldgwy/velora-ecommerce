/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

const adminSession = vi.hoisted(() => ({
  user: { id: "test-admin", role: "ADMIN", status: "ACTIVE", email: "admin@example.com", name: "Admin" },
}));
const requireAdminSpy = vi.hoisted(() => vi.fn().mockResolvedValue(adminSession));
const updateTagSpy = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: any) => fn,
  updateTag: updateTagSpy,
}));
vi.mock("@/shared/lib/guards", () => ({ requireAdmin: requireAdminSpy }));

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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
import { adjustInventory } from "@/shared/lib/actions/inventory";
import { adjustReservation } from "@/services/inventory.service";
import { cacheTags } from "@/shared/lib/cache/tag-names";

let rootId = "",
  childId = "",
  brandId = "",
  productId = "",
  variantId = "",
  inventoryId = "";

beforeAll(async () => {
  const [root] = await testDb.insert(categories).values({ slug: "ina-root", name: "Ina Root" }).returning();
  rootId = root.id;
  const [child] = await testDb.insert(categories).values({ slug: "ina-child", name: "Ina Child", parentId: rootId }).returning();
  childId = child.id;
  const [br] = await testDb.insert(brands).values({ slug: "ina-brand", name: "Ina Brand" }).returning();
  brandId = br.id;
  const [prod] = await testDb.insert(products).values({ name: "Ina Product", status: "ACTIVE", basePrice: "10.00", categoryId: childId, brandId }).returning();
  productId = prod.id;
  const [variant] = await testDb.insert(productVariants).values({ productId, sku: "INA-SKU-001", status: "ACTIVE", priceOverride: "12.00" }).returning();
  variantId = variant.id;
  const [inv] = await testDb.insert(inventory).values({ variantId, quantity: 10, reservedQuantity: 0 }).returning();
  inventoryId = inv.id;
});

afterEach(async () => {
  await testDb.update(inventory).set({ quantity: 10, reservedQuantity: 0 }).where(eq(inventory.id, inventoryId));
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId));
  updateTagSpy.mockClear();
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

describe("adjustInventory action: authorization", () => {
  beforeEach(() => {
    requireAdminSpy.mockResolvedValue(adminSession);
    updateTagSpy.mockClear();
  });

  it("rejects unauthorized actors", async () => {
    requireAdminSpy.mockRejectedValue(new Error("UNAUTHENTICATED"));
    await expect(
      adjustInventory({ kind: "stock", variantId, delta: 5, type: "RESTOCK" }),
    ).rejects.toThrow("UNAUTHENTICATED");
    expect(updateTagSpy).not.toHaveBeenCalled();
  });
});

describe("adjustInventory action: cache invalidation trace", () => {
  beforeEach(() => {
    requireAdminSpy.mockResolvedValue(adminSession);
    updateTagSpy.mockClear();
  });

  it("invalidates the variant + product + listing tags on success", async () => {
    const result = await adjustInventory({ kind: "stock", variantId, delta: 5, type: "RESTOCK" });
    expect(result).toMatchObject({ ok: true });

    const tags = updateTagSpy.mock.calls.map((c) => c[0]);
    expect(tags).toEqual(
      expect.arrayContaining([
        cacheTags.productsListing,
        cacheTags.product(productId),
        cacheTags.variantsByProduct(productId),
        cacheTags.variant(variantId),
      ]),
    );
    expect(tags).toHaveLength(4);
  });

  it("does NOT invalidate when the mutation throws InsufficientStockError", async () => {
    await adjustReservation(variantId, 9, "RESERVATION", {}, "test-admin");
    const result = await adjustInventory({ kind: "stock", variantId, delta: -2, type: "SALE" });
    expect(result).toEqual({ ok: false, error: "This change would violate stock availability rules." });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });
});

describe("adjustInventory action: input validation", () => {
  beforeEach(() => {
    requireAdminSpy.mockResolvedValue(adminSession);
    updateTagSpy.mockClear();
  });

  it("rejects a non-integer delta", async () => {
    const result = await adjustInventory({ kind: "stock", variantId, delta: 2.5, type: "RESTOCK" });
    expect(result.ok === false && typeof result.error === "string").toBe(true);
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid movement type", async () => {
    const result = await adjustInventory({ kind: "stock", variantId, delta: 1, type: "INVALID" as any });
    expect(result.ok === false && typeof result.error === "string").toBe(true);
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("rejects setStock with a negative quantity", async () => {
    const result = await adjustInventory({ kind: "set", variantId, quantity: -1 });
    expect(result).toEqual({ ok: false, error: "Quantity must be non-negative." });
  });
});

describe("adjustInventory action: not-found boundary", () => {
  beforeEach(() => {
    requireAdminSpy.mockResolvedValue(adminSession);
    updateTagSpy.mockClear();
  });

  it("returns the not-found error for an unknown variant", async () => {
    const result = await adjustInventory({
      kind: "stock",
      variantId: "00000000-0000-0000-0000-000000000000",
      delta: 1,
      type: "RESTOCK",
    });
    expect(result).toEqual({ ok: false, error: "Variant or inventory not found." });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });
});

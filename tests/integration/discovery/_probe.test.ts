/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({ unstable_cache: (fn: any) => fn, updateTag: vi.fn() }));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  reviews,
  reviewStatusEnum,
  testDb,
} from "../_db";
import { searchProducts } from "@/services/catalog-public/search";
import { listProducts, getProductBySlug } from "@/services/catalog-public/queries";

let rootId = "",
  childId = "",
  brandId = "",
  prodId = "",
  varId = "";

beforeAll(async () => {
  const [root] = await testDb
    .insert(categories)
    .values({ slug: "probe-root", name: "Probe Root" })
    .returning();
  rootId = root.id;
  const [child] = await testDb
    .insert(categories)
    .values({ slug: "probe-child", name: "Probe Child", parentId: rootId })
    .returning();
  childId = child.id;
  const [br] = await testDb
    .insert(brands)
    .values({ slug: "probe-brand", name: "Probe Brand" })
    .returning();
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({
      name: "Probe Product",
      description: "probe desc sku PROBE-SKU-001",
      status: "ACTIVE",
      basePrice: "10.00",
      categoryId: childId,
      brandId,
    })
    .returning();
  prodId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId: prodId, sku: "PROBE-SKU-001", status: "ACTIVE", priceOverride: "12.00" })
    .returning();
  varId = v.id;
  await testDb.insert(inventory).values({ variantId: varId, quantity: 5, reservedQuantity: 0 });
  await testDb.insert(reviews).values({
    productId: prodId,
    rating: 5,
    title: "Great",
    status: reviewStatusEnum.enumValues[1],
  });
});

afterAll(async () => {
  await testDb.delete(reviews).where(eq(reviews.productId, prodId));
  await testDb.delete(inventory).where(eq(inventory.variantId, varId));
  await testDb.delete(productVariants).where(eq(productVariants.id, varId));
  await testDb.delete(products).where(eq(products.id, prodId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, childId));
  await testDb.delete(categories).where(eq(categories.id, rootId));
});

describe("searchProducts import chain", () => {
  it("returns inserted product", async () => {
    const result = await searchProducts({ query: "Probe" });
    expect(result.totalCount).toBe(1);
    expect(result.items[0].name).toBe("Probe Product");
    expect(result.items[0].brand?.name).toBe("Probe Brand");
  });
  it("computes correlated aggregate fields via qualified subqueries", async () => {
    const result = await searchProducts({ query: "Probe" });
    const p = result.items[0];
    expect(p.averageRating).toBe(5);
    expect(p.reviewCount).toBe(1);
    expect(p.minVariantPrice).toBe("12.00");
  });
  it("respects inStockOnly filter", async () => {
    const result = await searchProducts({ query: "Probe", inStockOnly: true });
    expect(result.totalCount).toBe(1);
  });
  it("respects rating filter", async () => {
    const result = await searchProducts({ query: "Probe", rating: 4 });
    expect(result.totalCount).toBe(1);
    const filtered = await searchProducts({ query: "Probe", rating: 5 });
    expect(filtered.totalCount).toBe(1);
  });
});

describe("listProducts IN-list interpolation", () => {
  it("loads min variant price for returned products", async () => {
    const result = await listProducts({ brandSlug: "probe-brand" });
    expect(result.totalCount).toBe(1);
    expect(result.items[0].id).toBe(prodId);
    expect(result.items[0].minVariantPrice).toBe("12.00");
  });
});

describe("getProductBySlug -> getProductVariants IN-list", () => {
  it("returns the active variant without throwing on IN(array)", async () => {
    const product = await getProductBySlug(prodId);
    expect(product).not.toBeNull();
    expect(product!.variants).toHaveLength(1);
    expect(product!.variants[0].sku).toBe("PROBE-SKU-001");
    expect(product!.variants[0].priceOverride).toBe("12.00");
    expect(product!.variants[0].availableStock).toBe(5);
    expect(product!.variants[0].optionValues).toEqual([]);
  });
});

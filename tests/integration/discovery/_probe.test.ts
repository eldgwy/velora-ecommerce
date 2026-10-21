/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({ unstable_cache: (fn: any) => fn, updateTag: vi.fn() }));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { purgeCategoryFixtures } from "../_fixture-cleanup";
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

// Newest-ordering regression fixtures (see describe block below): two
// probe products with deliberately staggered createdAt values.
let sortBrandId = "",
  newProdId = "",
  oldProdId = "",
  newVarId = "",
  oldVarId = "";

beforeAll(async () => {
  // Crash-residue hardening: a previous run wounded mid-suite must never
  // poison this file's fixed-name fixtures. Cascade-safe purge keyed on our
  // own static fixture slugs only (see _fixture-cleanup.ts).
  await purgeCategoryFixtures(["probe-root", "probe-child"], ["probe-brand"]);
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
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`,
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

  // Newest-ordering fixtures (see describe block below): dedicated brand +
  // probe-free naming so the original single-row assertions above stay
  // untouched. createdAt is client-written; the DB clock running ahead of the
  // Node client (docs/production-remediation-report.md D17) shifts BOTH rows
  // the same way, so their 120s relative gap and asserted order hold under
  // any clock offset.
  const [sortBrand] = await testDb
    .insert(brands)
    .values({ slug: "sortfix-brand", name: "Sort Fixture Brand" })
    .returning();
  sortBrandId = sortBrand.id;
  const [oldProd] = await testDb
    .insert(products)
    .values({
      slug: `p-${Math.random().toString(36).slice(2, 14)}`,
      name: "Sort Fixture Older",
      description: "sort fixture SORTFIX-OLDER",
      status: "ACTIVE",
      basePrice: "10.00",
      categoryId: childId,
      brandId: sortBrandId,
      createdAt: new Date(Date.now() - 60_000),
    })
    .returning();
  oldProdId = oldProd.id;
  const [oldVar] = await testDb
    .insert(productVariants)
    .values({ productId: oldProdId, sku: "SORTFIX-OLDER", status: "ACTIVE", priceOverride: "12.00" })
    .returning();
  oldVarId = oldVar.id;
  await testDb.insert(inventory).values({ variantId: oldVarId, quantity: 5, reservedQuantity: 0 });

  const [newProd] = await testDb
    .insert(products)
    .values({
      slug: `p-${Math.random().toString(36).slice(2, 14)}`,
      name: "Sort Fixture Newer",
      description: "sort fixture SORTFIX-NEWER",
      status: "ACTIVE",
      basePrice: "10.00",
      categoryId: childId,
      brandId: sortBrandId,
      createdAt: new Date(Date.now() + 60_000),
    })
    .returning();
  newProdId = newProd.id;
  const [newVar] = await testDb
    .insert(productVariants)
    .values({ productId: newProdId, sku: "SORTFIX-NEWER", status: "ACTIVE", priceOverride: "12.00" })
    .returning();
  newVarId = newVar.id;
  await testDb.insert(inventory).values({ variantId: newVarId, quantity: 5, reservedQuantity: 0 });
});

afterAll(async () => {
  for (const [pid, vid] of [
    [prodId, varId],
    [oldProdId, oldVarId],
    [newProdId, newVarId],
  ] as const) {
    await testDb.delete(reviews).where(eq(reviews.productId, pid));
    await testDb.delete(inventory).where(eq(inventory.variantId, vid));
    await testDb.delete(productVariants).where(eq(productVariants.id, vid));
    await testDb.delete(products).where(eq(products.id, pid));
  }
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(brands).where(eq(brands.id, sortBrandId));
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

  // GP-05: slug lookups and legacy id lookups must both resolve (the id
  // match is the documented compatibility contract for pre-slug URLs).
  it("resolves the product by its backfilled slug, not just by id", async () => {
    const [row] = await testDb
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.id, prodId));
    expect(row!.slug).not.toBe(prodId); // backfill slugified + suffixed
    expect(row!.slug).toMatch(/^[a-z0-9-]+$/); // URL-safe lowercase
    const bySlug = await getProductBySlug(row!.slug);
    expect(bySlug).not.toBeNull();
    expect(bySlug!.id).toBe(prodId);
  });
});

describe("newest ordering", () => {
  // Regression: `sort: "newest"` returned bare `products.createdAt` (ASC),
  // so storefront "Newest" and the home "New Arrivals" strip showed
  // OLDEST-first. It must be createdAt DESC with the same deterministic
  // id tie-break the search surface already used. The two sort-fixture
  // rows live under their own brand + search token, so shared-DB rows and
  // the original "probe" fixtures cannot interfere.
  it("listProducts newest sort returns the newer sort-fixture first (brand-scoped)", async () => {
    const result = await listProducts({ brandSlug: "sortfix-brand", sort: "newest" });
    expect(result.totalCount).toBe(2);
    expect(result.items[0].id).toBe(newProdId);
    expect(result.items[1].id).toBe(oldProdId);
  });

  it("searchProducts newest sort agrees (same DESC + id tie-break contract)", async () => {
    const result = await searchProducts({ query: "SORTFIX", sort: "newest" });
    expect(result.items[0].id).toBe(newProdId);
    expect(result.items[1].id).toBe(oldProdId);
  });
});

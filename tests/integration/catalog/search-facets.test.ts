import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { testDb } from "../_db";
import { categories, brands, products, productVariants, inventory } from "../_db";
import { reviews } from "@/infrastructure/database/schema/reviews";
import { getSearchFacets, searchProducts } from "@/services/catalog-public";
import type { SearchFilters } from "@/services/catalog-public";

const SFX = `sf-${Date.now()}`;
/**
 * Namespace prefix for this file's fixtures. It is deliberately BROAD
 * ('sf-%' over every sf-<timestamp>-*) so a wounded earlier run (crash
 * before afterAll) can never poison later runs — the purge is the first
 * statement of beforeAll AND the last of afterAll (§6 hardening).
 */
const NAMESPACE_LIKE = "sf-%";
let categoryId = "";
let childCategoryId = "";
let brandAId = "";
let brandBId = "";
const productIds: string[] = [];

async function insertProduct(input: {
  name: string;
  brandId: string;
  categoryId: string;
  basePrice: string;
}) {
  const [row] = await testDb
    .insert(products)
    .values({
      slug: `${SFX}-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: input.name,
      description: null,
      status: "ACTIVE",
      basePrice: input.basePrice,
      categoryId: input.categoryId,
      brandId: input.brandId,
    })
    .returning({ id: products.id });
  productIds.push(row.id);
  return row.id;
}

let variantSkuSeq = 0;

async function insertVariantWithStock(input: {
  productId: string;
  priceOverride?: string;
  quantity: number;
}) {
  variantSkuSeq += 1;
  const [variant] = await testDb
    .insert(productVariants)
    .values({
      productId: input.productId,
      sku: `${SFX}-sku-${variantSkuSeq}`,
      is_active: "ACTIVE",
      price_override: input.priceOverride ?? null,
    })
    .returning({ id: productVariants.id });
  await testDb.insert(inventory).values({
    variantId: variant.id,
    quantity: input.quantity,
    reserved_quantity: 0,
    low_stock_threshold: 0,
  });
}

/** Removes every sf-% fixture this file family ever created (§6 hardening). */
async function purgeNamespace() {
  const residueCats = await testDb
    .select({ id: categories.id })
    .from(categories)
    .where(sql`${categories.slug} LIKE ${NAMESPACE_LIKE}`);
  const residueBrands = await testDb
    .select({ id: brands.id })
    .from(brands)
    .where(sql`${brands.slug} LIKE ${NAMESPACE_LIKE}`);
  const catIds = residueCats.map((c) => c.id);
  const brandIds = residueBrands.map((b) => b.id);

  if (catIds.length > 0 || brandIds.length > 0) {
    const ownership: SQL[] = [];
    if (catIds.length > 0) ownership.push(inArray(products.categoryId, catIds));
    if (brandIds.length > 0) ownership.push(inArray(products.brandId, brandIds));
    const residueProducts = await testDb
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          or(...ownership),
          // Double-guard: only products INSERTED by this file family (slug
          // namespace) are swept, whatever columns may happen to reference
          // the fixture ids.
          sql`${products.slug} LIKE ${NAMESPACE_LIKE}`,
        ),
      );
    const pIds = residueProducts.map((p) => p.id);
    if (pIds.length > 0) {
      const variantIds = await testDb
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(inArray(productVariants.productId, pIds));
      if (variantIds.length > 0) {
        await testDb.delete(inventory).where(inArray(inventory.variantId, variantIds.map((v) => v.id)));
        await testDb.delete(productVariants).where(inArray(productVariants.id, variantIds.map((v) => v.id)));
      }
      // Fixture-scoped deletes, keyed on this file's slug namespace (§6) —
      // never an unscoped full-table purge.
      await testDb.delete(reviews).where(inArray(reviews.productId, pIds));
      await testDb.delete(products).where(inArray(products.id, pIds));
    }
  }
  if (catIds.length > 0) {
    await testDb.delete(categories).where(inArray(categories.id, catIds));
  }
  if (brandIds.length > 0) {
    await testDb.delete(brands).where(inArray(brands.id, brandIds));
  }
}

beforeAll(async () => {
  // Wipe any residue from ALL earlier runs of this file family first —
  // a crashed run would otherwise skew every count assertion below.
  await purgeNamespace();
});

afterAll(async () => {
  await purgeNamespace();
});

describe("search facets (T-5.3)", () => {
  let faInId = "";
  let faHalfId = "";

  beforeAll(async () => {
    const [cat] = await testDb
      .insert(categories)
      .values({ slug: `${SFX}-cat`, name: `${SFX} Category`, is_active: true })
      .returning({ id: categories.id });
    categoryId = cat.id;
    const [child] = await testDb
      .insert(categories)
      .values({ slug: `${SFX}-child`, name: `${SFX} Child`, parentId: categoryId, is_active: true })
      .returning({ id: categories.id });
    childCategoryId = child.id;
    const [brandA] = await testDb
      .insert(brands)
      .values({ slug: `${SFX}-brand-a`, name: `${SFX} Brand A` })
      .returning({ id: brands.id });
    brandAId = brandA.id;
    const [brandB] = await testDb
      .insert(brands)
      .values({ slug: `${SFX}-brand-b`, name: `${SFX} Brand B` })
      .returning({ id: brands.id });
    brandBId = brandB.id;

    // Brand A, parent category: fa-in (10.00, in stock, avg 5.0),
    // fa-half (200.00, NO variant, avg 4.0), fa-out (10.00, no stock, no
    // query match). Brand B, child category: one 50.00 in-stock match.
    faInId = await insertProduct({ name: "sf-a-in lucite", brandId: brandAId, categoryId, basePrice: "10.00" });
    faHalfId = await insertProduct({ name: "sf-a-half lucite", brandId: brandAId, categoryId, basePrice: "200.00" });
    await insertProduct({ name: "sf-a-out", brandId: brandAId, categoryId, basePrice: "10.00" });
    const faChild = await insertProduct({
      name: "sf-b-child lucite",
      brandId: brandBId,
      categoryId: childCategoryId,
      basePrice: "50.00",
    });

    await insertVariantWithStock({ productId: faInId, priceOverride: "10.00", quantity: 5 });
    await insertVariantWithStock({ productId: faChild, priceOverride: "50.00", quantity: 2 });

    await testDb.insert(reviews).values({ userId: null, productId: faInId, rating: 5, status: "approved" });
    await testDb.insert(reviews).values({ userId: null, productId: faInId, rating: 5, status: "approved" });
    await testDb.insert(reviews).values({ userId: null, productId: faHalfId, rating: 5, status: "approved" });
    await testDb.insert(reviews).values({ userId: null, productId: faHalfId, rating: 3, status: "approved" });
    await testDb.insert(reviews).values({ userId: null, productId: productIds[2]!, rating: 1, status: "rejected" });
  });

  const queryFilters = (): SearchFilters => ({ query: "lucite" });

  it("counts brands and categories under the other applied filters", async () => {
    const facets = await getSearchFacets({ ...queryFilters(), brandSlug: `${SFX}-brand-a` });
    // Brand dimension is self-excluded: Brand B still reports its match.
    expect(facets.brandCounts[brandBId]).toBe(1);
    expect(facets.brandCounts[brandAId]).toBe(2); // fa-in + fa-half match "lucite"
    // Category counts under q + brand-a: fa-in and fa-half both sit in the
    // parent; the child has no brand-a matches.
    expect(facets.categoryCounts[categoryId]).toBe(2);
    expect(facets.categoryCounts[childCategoryId]).toBeUndefined();
    // Consistency: totalCount equals the listing's count for the same input.
    const result = await searchProducts({ ...queryFilters(), brandSlug: `${SFX}-brand-a` });
    expect(facets.totalCount).toBe(result.totalCount);
  });

  it("computes rating bands and price bounds under the query + selectors", async () => {
    const facets = await getSearchFacets(queryFilters());
    // fa-in avg 5.0 -> band 5; fa-half avg 4.0 -> band 4; the rejected
    // review is invisible.
    expect(facets.ratingBands).toEqual([
      { rating: 4, count: 1 },
      { rating: 5, count: 1 },
    ]);
    // Effective prices: 10.00 / 200.00 / 50.00 (fa-out does not match q).
    expect(Number(facets.priceBounds.min)).toBe(10);
    expect(Number(facets.priceBounds.max)).toBe(200);
  });

  it("keeps the in-stock facet informative when the checkbox is on", async () => {
    const facets = await getSearchFacets({ ...queryFilters(), inStockOnly: true });
    // Self-excluded counts: 2 of the 3 query matches have stock
    // (fa-half deliberately has no variant row, so it is never in stock).
    expect(facets.inStockCount).toBe(2);
    expect(facets.totalCount).toBe(2);
  });

  it("price bounds ignore the selected min/max price filters", async () => {
    const facets = await getSearchFacets({ ...queryFilters(), minPrice: 100 });
    expect(Number(facets.priceBounds.min)).toBe(10); // own dimension excluded
    expect(facets.totalCount).toBe(1); // only fa-half is >= 100
  });

  it("returns empty facets for an unresolvable slug", async () => {
    const facets = await getSearchFacets({ categorySlug: `${SFX}-no-such-cat` });
    expect(facets).toEqual({
      brandCounts: {},
      categoryCounts: {},
      ratingBands: [],
      priceBounds: { min: null, max: null },
      inStockCount: 0,
      totalCount: 0,
    });
  });
});

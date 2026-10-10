/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

const updateTagSpy = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  unstable_cache: (fn: any) => fn,
  updateTag: updateTagSpy,
}));

import {
  invalidateAllCatalogCache,
  invalidateCategoryCache,
  invalidateBrandCache,
  invalidateProductCache,
  invalidateVariantCache,
  invalidateImageCache,
  invalidateReviewCache,
} from "@/shared/lib/cache/tags";
import { cacheTags } from "@/shared/lib/cache/tag-names";

beforeEach(() => {
  updateTagSpy.mockClear();
});

describe("cache tag invalidation map", () => {
  it("invalidateAllCatalogCache touches categories:tree, brands:list, products:listing", async () => {
    await invalidateAllCatalogCache();
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        cacheTags.categoriesTree,
        cacheTags.brandsList,
        cacheTags.productsListing,
      ]),
    );
  });

  it("invalidateCategoryCache touches tree, category:id, listing", async () => {
    await invalidateCategoryCache("cat-1");
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        cacheTags.categoriesTree,
        cacheTags.category("cat-1"),
        cacheTags.productsListing,
      ]),
    );
  });

  it("invalidateBrandCache touches list, brand:id, listing", async () => {
    await invalidateBrandCache("brand-1");
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        cacheTags.brandsList,
        cacheTags.brand("brand-1"),
        cacheTags.productsListing,
      ]),
    );
  });

  it("invalidateProductCache(without slug) omits product:slug and covers the rest of the map", async () => {
    await invalidateProductCache("prod-1");
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        cacheTags.productsListing,
        cacheTags.product("prod-1"),
        cacheTags.variantsByProduct("prod-1"),
        cacheTags.imagesByProduct("prod-1"),
      ]),
    );
    expect(updateTagSpy).not.toHaveBeenCalledWith(cacheTags.productBySlug("prod-1"));
  });

  it("invalidateProductCache(with slug) also clears product:slug", async () => {
    await invalidateProductCache("prod-1", "prod-slug");
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toContain(
      cacheTags.productBySlug("prod-slug"),
    );
  });

  it("invalidateVariantCache touches variants:product, variant:id, product:id, listing", async () => {
    await invalidateVariantCache("var-1", "prod-1");
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        cacheTags.variantsByProduct("prod-1"),
        cacheTags.variant("var-1"),
        cacheTags.product("prod-1"),
        cacheTags.productsListing,
      ]),
    );
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toHaveLength(4);
  });

  it("invalidateImageCache touches images:product, image:id, product:id, listing", async () => {
    await invalidateImageCache("img-1", "prod-1");
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        cacheTags.imagesByProduct("prod-1"),
        cacheTags.image("img-1"),
        cacheTags.product("prod-1"),
        cacheTags.productsListing,
      ]),
    );
  });

  it("invalidateReviewCache touches reviews:product, product:id, listing", async () => {
    await invalidateReviewCache("prod-1");
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        cacheTags.reviewsByProduct("prod-1"),
        cacheTags.product("prod-1"),
        cacheTags.productsListing,
      ]),
    );
    expect(updateTagSpy.mock.calls.map((c) => c[0])).toHaveLength(3);
  });
});

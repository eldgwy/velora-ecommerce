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
  reviews,
  testDb,
} from "../_db";
import { getProductReviews } from "@/services/catalog-public/queries";

let rootId = "",
  childId = "",
  brandId = "",
  productId = "";

beforeAll(async () => {
  const [root] = await testDb
    .insert(categories)
    .values({ slug: "agg-root", name: "Agg Root" })
    .returning();
  rootId = root.id;
  const [child] = await testDb
    .insert(categories)
    .values({ slug: "agg-child", name: "Agg Child", parentId: rootId })
    .returning();
  childId = child.id;
  const [br] = await testDb
    .insert(brands)
    .values({ slug: "agg-brand", name: "Agg Brand" })
    .returning();
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({
      name: "Agg Product",
      status: "ACTIVE",
      basePrice: "10.00",
      categoryId: childId,
      brandId,
    })
    .returning();
  productId = prod.id;
});

afterEach(async () => {
  await testDb.delete(reviews).where(eq(reviews.productId, productId));
});

afterAll(async () => {
  await testDb.delete(reviews).where(eq(reviews.productId, productId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, childId));
  await testDb.delete(categories).where(eq(categories.id, rootId));
});

async function insertReview(rating: number | null, status: "pending" | "approved" | "rejected") {
  await testDb.insert(reviews).values({
    productId,
    rating,
    title: "t",
    content: "c",
    status,
  });
}

describe("getProductReviews aggregates (real DB)", () => {
  it("returns empty aggregates with correct types when no reviews exist", async () => {
    const res = await getProductReviews(productId);
    expect(res.reviews).toEqual([]);
    expect(res.reviewCount).toBe(0);
    expect(res.averageRating).toBeNull();
    expect(typeof res.reviewCount).toBe("number");
    expect(res.averageRating).toBeNull();
  });

  it("counts only APPROVED reviews toward the average", async () => {
    await insertReview(5, "approved");
    await insertReview(4, "pending");
    await insertReview(2, "rejected");

    const res = await getProductReviews(productId);
    expect(res.reviewCount).toBe(1);
    expect(res.averageRating).toBe(5);
    expect(res.reviews).toHaveLength(1);
  });

  it("excludes null-rating reviews from average/count but still lists them", async () => {
    await insertReview(3, "approved");
    await insertReview(null, "approved");

    const res = await getProductReviews(productId);
    expect(res.reviewCount).toBe(1);
    expect(res.averageRating).toBe(3);
    expect(res.reviews).toHaveLength(2);
    expect(res.reviews.find((r) => r.rating === null)).toBeDefined();
  });

  it("rounds the average to 2 decimals as a JS number", async () => {
    await insertReview(5, "approved");
    await insertReview(4, "approved");
    await insertReview(4, "approved"); // (5+4+4)/3 = 4.333 -> 4.33

    const res = await getProductReviews(productId);
    expect(typeof res.averageRating).toBe("number");
    expect(res.averageRating).toBe(4.33);
    expect(res.reviewCount).toBe(3);
  });

  it("returns averageRating as a number (not a raw db string)", async () => {
    await insertReview(5, "approved");

    const res = await getProductReviews(productId);
    expect(typeof res.averageRating).toBe("number");
    expect(res.averageRating).not.toBe("5.00");
    expect(String(res.averageRating)).toBe("5");
  });
});

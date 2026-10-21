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
import { purgeCategoryFixtures } from "../_fixture-cleanup";
import {
  categories,
  brands,
  products,
  reviews,
  testDb,
} from "../_db";
import { moderateReview, getReviewById } from "@/services/review.service";
import { moderateReviewAction } from "@/shared/lib/actions/reviews";

let rootId = "",
  childId = "",
  brandId = "",
  productId = "";
let reviewId = "";

beforeAll(async () => {
  // Crash-residue hardening: a previous run wounded mid-suite must never
  // poison this file's fixed-name fixtures. Cascade-safe purge keyed on our
  // own static fixture slugs only (see _fixture-cleanup.ts).
  await purgeCategoryFixtures(["rev-root", "rev-child"], ["rev-brand"]);
  const [root] = await testDb.insert(categories).values({ slug: "rev-root", name: "Rev Root" }).returning();
  rootId = root.id;
  const [child] = await testDb
    .insert(categories)
    .values({ slug: "rev-child", name: "Rev Child", parentId: rootId })
    .returning();
  childId = child.id;
  const [br] = await testDb.insert(brands).values({ slug: "rev-brand", name: "Rev Brand" }).returning();
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "Rev Product", status: "ACTIVE", basePrice: "10.00", categoryId: childId, brandId })
    .returning();
  productId = prod.id;
});

beforeEach(async () => {
  const [r] = await testDb
    .insert(reviews)
    .values({ productId, rating: 4, title: "t", content: "c", status: "pending" })
    .returning();
  reviewId = r.id;
});

afterEach(async () => {
  await testDb.delete(reviews).where(eq(reviews.id, reviewId));
  reviewId = "";
});

afterAll(async () => {
  // Shared-DB hygiene: purge ONLY this suite's fixture reviews — an
  // unscoped delete would wipe other suites' rows mid-run.
  await testDb.delete(reviews).where(eq(reviews.productId, productId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, childId));
  await testDb.delete(categories).where(eq(categories.id, rootId));
});

describe("moderateReview service (real DB)", () => {
  it("approves a pending review", async () => {
    const res = await moderateReview(reviewId, "approved", "test-admin");
    expect(res.changed).toBe(true);
    expect(res.status).toBe("approved");

    const row = await getReviewById(reviewId);
    expect(row?.status).toBe("approved");
    // Audited moderation (migration 0032): actor + moment persisted only on
    // an actual transition.
    expect(row?.moderatedBy).toBe("test-admin");
    expect(row?.moderatedAt).toBeInstanceOf(Date);
  });

  it("rejects a pending review", async () => {
    const res = await moderateReview(reviewId, "rejected", "test-admin");
    expect(res.changed).toBe(true);
    expect(res.status).toBe("rejected");
  });

  it("allows re-evaluation (rejected -> approved)", async () => {
    await moderateReview(reviewId, "rejected", "test-admin");
    const res = await moderateReview(reviewId, "approved", "test-admin");
    expect(res.changed).toBe(true);
    expect(res.status).toBe("approved");
  });

  it("treats a redundant self-transition as a no-op (no write)", async () => {
    const res = await moderateReview(reviewId, "pending", "test-admin");
    expect(res.changed).toBe(false);
    const row = await getReviewById(reviewId);
    expect(row?.status).toBe("pending");
  });

  it("throws when the review does not exist", async () => {
    await expect(moderateReview("00000000-0000-0000-0000-000000000000", "approved", "test-admin")).rejects.toThrow(
      /Review not found/,
    );
  });
});

describe("moderateReviewAction authorization + cache boundary", () => {
  beforeEach(() => {
    requireAdminSpy.mockResolvedValue(adminSession);
    updateTagSpy.mockClear();
  });

  it("authorized approve invalidates the expected cache tags", async () => {
    const result = await moderateReviewAction({ reviewId, status: "approved" });
    expect(result).toEqual({ id: reviewId, changed: true });

    expect(updateTagSpy).toHaveBeenCalledWith("reviews:product:" + productId);
    expect(updateTagSpy).toHaveBeenCalledWith("product:" + productId);
    expect(updateTagSpy).toHaveBeenCalledWith("products:listing");
  });

  it("does NOT invalidate when the mutation fails (missing review)", async () => {
    const result = await moderateReviewAction({
      reviewId: "00000000-0000-0000-0000-000000000000",
      status: "approved",
    });
    expect(result).toEqual({ error: "Review not found." });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("does NOT invalidate on invalid input", async () => {
    const result = await moderateReviewAction({ reviewId: "not-a-uuid", status: "approved" });
    expect(result).toEqual({ error: "Invalid review ID." });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("does NOT invalidate on a redundant transition (changed=false)", async () => {
    const result = await moderateReviewAction({ reviewId, status: "pending" });
    expect(result).toEqual({ id: reviewId, changed: false });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("rejects unauthorized actors", async () => {
    requireAdminSpy.mockRejectedValue(new Error("UNAUTHENTICATED"));
    await expect(moderateReviewAction({ reviewId, status: "approved" })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    expect(updateTagSpy).not.toHaveBeenCalled();
  });
});

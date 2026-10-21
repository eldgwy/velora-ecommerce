import { vi } from "vitest";

const adminSession = vi.hoisted(() => ({
  user: { id: "test-mod", role: "STAFF", status: "ACTIVE", email: "mod@example.com", name: "Mod" },
}));
const requireAdminSpy = vi.hoisted(() => vi.fn().mockResolvedValue(adminSession));
const updateTagSpy = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: updateTagSpy,
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/guards", () => ({ requireAdmin: requireAdminSpy }));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
} from "../_db";
import { reviews } from "@/infrastructure/database/schema/reviews";
import { user } from "@/infrastructure/database/schema/auth";
import { moderateReviewAction } from "@/shared/lib/actions/reviews";
import { getModerationQueueAction } from "@/modules/reviews/presentation/actions/review.actions";
import {
  getRatingSummary,
  listApprovedReviews,
} from "@/modules/reviews/application/queries/reviews";

const SFX = `rm-${Date.now()}`;
let categoryId = "";
let brandId = "";
let productId = "";
let customerId = "";

async function insertReview(input: {
  rating: number | null;
  status: "pending" | "approved" | "rejected";
  verified?: boolean;
  userId?: string | null;
  title?: string;
}) {
  const [row] = await testDb
    .insert(reviews)
    .values({
      // Default author is NULL (unique index treats NULLs as distinct, so
      // multi-row fixtures never collide); pass an explicit userId only
      // when the test asserts author attribution.
      userId: input.userId === undefined ? null : input.userId,
      productId,
      rating: input.rating,
      title: input.title ?? "t",
      content: "c",
      status: input.status,
      isVerifiedBuyer: input.verified ?? false,
    })
    .returning();
  return row.id;
}

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `rm-u-${SFX}`, name: "Mod Customer", email: `modcust-${SFX}@ex.com` })
    .returning();
  customerId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `rm-cat-${SFX}`, name: "RM Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `rm-brand-${SFX}`, name: "RM Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "RM Product", status: "ACTIVE", basePrice: "10.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  await testDb.insert(productVariants).values({ productId, sku: `RM-SKU-${SFX}`, status: "ACTIVE" });
});

afterAll(async () => {
  await testDb.delete(reviews).where(eq(reviews.productId, productId));
  await testDb.delete(productVariants).where(eq(productVariants.productId, productId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, customerId));
});

beforeEach(async () => {
  await testDb.delete(reviews).where(eq(reviews.productId, productId));
  updateTagSpy.mockClear();
  requireAdminSpy.mockResolvedValue(adminSession);
});

describe("moderation queue", () => {
  it("lists pending reviews with product and author context", async () => {
    await insertReview({ rating: 5, status: "pending", title: "Queue me", userId: customerId });
    // Scoped to this fixture's product: the moderation queue is global by
    // design, and an unfiltered totalCount(==1) counts rows any concurrently
    // running suite inserted — an inherently racy cross-file assumption.
    const res = await getModerationQueueAction({ status: "pending", productId });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error("expected ok");
    expect(res.data.totalCount).toBe(1);
    const [item] = res.data.items;
    expect(item!.productName).toBe("RM Product");
    expect(item!.userName).toBe("Mod Customer");
    expect(item!.rating).toBe(5);
    expect(item!.title).toBe("Queue me");
  });

  it("approves and rejects pending reviews with cache invalidation", async () => {
    const id = await insertReview({ rating: 4, status: "pending" });
    const approved = await moderateReviewAction({ reviewId: id, status: "approved" });
    expect(approved).toEqual({ id, changed: true });
    expect(updateTagSpy).toHaveBeenCalled();

    const id2 = await insertReview({ rating: 2, status: "pending" });
    const rejected = await moderateReviewAction({ reviewId: id2, status: "rejected" });
    expect(rejected).toEqual({ id: id2, changed: true });
  });

  // T-5.4: the old "refuses already-moderated" policy was product-approved
  // for replacement with a revisable moderation flow. The same fixtures now
  // assert the new semantics: direct flips and re-open succeed, the audit
  // columns record the latest action, and content is untouched.
  it("re-moderates already-moderated reviews (flip, re-open, audit)", async () => {
    const id = await insertReview({ rating: 5, status: "approved", title: "Flip me" });
    const res = await moderateReviewAction({ reviewId: id, status: "rejected" });
    expect(res).toEqual({ id, changed: true });
    const [row] = await testDb.select().from(reviews).where(eq(reviews.id, id));
    expect(row!.status).toBe("rejected");
    expect(row!.moderatedBy).toBe("test-mod");
    expect(row!.moderatedAt).not.toBeNull();
    expect(row!.title).toBe("Flip me"); // content immutable under re-moderation

    const rid = await insertReview({ rating: 1, status: "rejected" });
    const res2 = await moderateReviewAction({ reviewId: rid, status: "pending" });
    expect(res2).toEqual({ id: rid, changed: true });
    const [row2] = await testDb.select().from(reviews).where(eq(reviews.id, rid));
    expect(row2!.status).toBe("pending");
  });

  it("same-status replay is a safe no-op (changed: false)", async () => {
    const id = await insertReview({ rating: 3, status: "approved" });
    const res = await moderateReviewAction({ reviewId: id, status: "approved" });
    expect(res).toEqual({ id, changed: false });
  });

  it("rejects unauthorized moderators without leaking data", async () => {
    requireAdminSpy.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(
      moderateReviewAction({ reviewId: "00000000-0000-0000-0000-000000000000", status: "approved" }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(getModerationQueueAction({})).rejects.toThrow("FORBIDDEN");
    expect(updateTagSpy).not.toHaveBeenCalled();
  });
});

describe("public storefront visibility", () => {
  it("shows approved reviews only, with verified badges", async () => {
    await insertReview({ rating: 5, status: "approved", verified: true, title: "Public" });
    await insertReview({ rating: 1, status: "pending", title: "Hidden pending" });
    await insertReview({ rating: 2, status: "rejected", title: "Hidden rejected" });

    const list = await listApprovedReviews(productId, 1, 10);
    expect(list.totalCount).toBe(1);
    expect(list.items[0]!.title).toBe("Public");
    expect(list.items[0]!.isVerifiedBuyer).toBe(true);
  });

  it("aggregates average, count, and distribution from approved rows only", async () => {
    await insertReview({ rating: 5, status: "approved", verified: true });
    await insertReview({ rating: 4, status: "approved" });
    await insertReview({ rating: 1, status: "pending" });
    await insertReview({ rating: 1, status: "rejected" });
    await insertReview({ rating: null, status: "approved" });

    const summary = await getRatingSummary(productId);
    // (5 + 4) / 2 = 4.5 across 2 rated approvals; the unrated approval counts.
    expect(summary.averageRating).toBe(4.5);
    expect(summary.reviewCount).toBe(3);
    expect(summary.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 });
  });

  it("paginates without duplicates and renders the empty state", async () => {
    const empty = await listApprovedReviews(productId, 1, 10);
    expect(empty.totalCount).toBe(0);
    expect(empty.items).toEqual([]);

    for (let i = 0; i < 7; i += 1) {
      await insertReview({ rating: 5, status: "approved", title: `R${i}`, userId: null });
    }
    const p1 = await listApprovedReviews(productId, 1, 5);
    const p2 = await listApprovedReviews(productId, 2, 5);
    expect(p1.items).toHaveLength(5);
    expect(p2.items).toHaveLength(2);
    expect(p1.totalPages).toBe(2);
    const ids = [...p1.items, ...p2.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(7);
  });
});

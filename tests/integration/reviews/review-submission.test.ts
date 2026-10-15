import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const sessionStore = vi.hoisted(() => ({ userId: null as string | null }));
const updateTagSpy = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: updateTagSpy,
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/guards", () => ({
  getCurrentSession: vi.fn(async () =>
    sessionStore.userId
      ? { user: { id: sessionStore.userId, role: "CUSTOMER", status: "ACTIVE" } }
      : null,
  ),
  requireAdmin: vi.fn(async () => {
    throw new Error("FORBIDDEN");
  }),
}));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
} from "../_db";
import { orderItems, orders } from "@/infrastructure/database/schema/orders";
import { reviewImages, reviews } from "@/infrastructure/database/schema/reviews";
import { user } from "@/infrastructure/database/schema/auth";
import { submitReview } from "@/modules/reviews/application/commands/submit-review";
import {
  getReviewImageUploadParamsAction,
  submitReviewAction,
} from "@/modules/reviews/presentation/actions/review.actions";
import {
  ReviewConflictError,
  ReviewValidationError,
} from "@/modules/reviews/domain/review-errors";

const SFX = `rs-${Date.now()}`;
let userA = "";
let userB = "";
let categoryId = "";
let brandId = "";
let productId = "";
let product2Id = "";
let variantId = "";
let variant2Id = "";

async function deliveredOrder(userId: string, vId: string, status = "DELIVERED") {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `RS-ORD-${Math.random().toString(36).slice(2)}-${SFX}`,
      userId,
      status: status as "DELIVERED",
      subtotal: "20.00",
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "20.00",
      currency: "USD",
      paymentStatus: "PAID",
    })
    .returning();
  await testDb.insert(orderItems).values({
    orderId: order.id,
    variantId: vId,
    productName: "RS Product",
    sku: `RS-SKU-${SFX}`,
    quantity: 1,
    unitPrice: "20.00",
    totalAmount: "20.00",
    reservationStatus: "COMMITTED",
  });
  return order.id;
}

beforeAll(async () => {
  for (const [key, id] of [["a", `rs-u-a-${SFX}`], ["b", `rs-u-b-${SFX}`]] as const) {
    const [u] = await testDb
      .insert(user)
      .values({ id, name: `Reviewer ${key}`, email: `reviewer-${key}-${SFX}@ex.com` })
      .returning();
    if (key === "a") userA = u.id;
    else userB = u.id;
  }
  const [cat] = await testDb.insert(categories).values({ slug: `rs-cat-${SFX}`, name: "RS Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `rs-brand-${SFX}`, name: "RS Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [p1] = await testDb
    .insert(products)
    .values({ name: "RS Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  const [p2] = await testDb
    .insert(products)
    .values({ name: "RS Product 2", status: "ACTIVE", basePrice: "30.00", categoryId, brandId })
    .returning();
  productId = p1.id;
  product2Id = p2.id;
  const [v1] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `RS-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  const [v2] = await testDb
    .insert(productVariants)
    .values({ productId: product2Id, sku: `RS-SKU2-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v1.id;
  variant2Id = v2.id;
  await testDb.insert(inventory).values([
    { variantId, quantity: 10, reservedQuantity: 0 },
    { variantId: variant2Id, quantity: 10, reservedQuantity: 0 },
  ]);
});

afterAll(async () => {
  const orderRows = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.userId, userA));
  const orderRowsB = await testDb
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.userId, userB));
  const ids = [...orderRows, ...orderRowsB].map((o) => o.id);
  if (ids.length > 0) {
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await testDb.delete(orders).where(inArray(orders.id, ids));
  }
  await testDb.delete(reviewImages).where(
    inArray(
      reviewImages.reviewId,
      testDb.select({ id: reviews.id }).from(reviews),
    ),
  );
  await testDb.delete(reviews).where(eq(reviews.productId, productId));
  await testDb.delete(reviews).where(eq(reviews.productId, product2Id));
  await testDb.delete(inventory).where(inArray(inventory.variantId, [variantId, variant2Id]));
  await testDb.delete(productVariants).where(inArray(productVariants.id, [variantId, variant2Id]));
  await testDb.delete(products).where(inArray(products.id, [productId, product2Id]));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [userA, userB]));
});

beforeEach(() => {
  updateTagSpy.mockClear();
  sessionStore.userId = null;
});

describe("review submission", () => {
  it("creates a PENDING review with images and invalidates caches", async () => {
    sessionStore.userId = userA;
    const res = await submitReviewAction({
      productId,
      rating: 5,
      title: "Excellent",
      content: "Wore it all week.",
      images: [
        { url: "https://example.com/a.jpg", publicId: "rs/a" },
        { url: "https://example.com/b.jpg", publicId: "rs/b" },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error("expected ok");
    const [row] = await testDb.select().from(reviews).where(eq(reviews.id, res.data.id));
    expect(row!.status).toBe("pending");
    expect(row!.userId).toBe(userA);
    expect(row!.isVerifiedBuyer).toBe(false);
    const imgs = await testDb.select().from(reviewImages).where(eq(reviewImages.reviewId, row!.id));
    expect(imgs).toHaveLength(2);
    expect(updateTagSpy).toHaveBeenCalled();

    await testDb.delete(reviewImages).where(eq(reviewImages.reviewId, row!.id));
    await testDb.delete(reviews).where(eq(reviews.id, row!.id));
  });

  it("rejects duplicates at the application and database levels", async () => {
    await submitReview({ userId: userA, productId, rating: 4 });
    await expect(submitReview({ userId: userA, productId, rating: 5 })).rejects.toBeInstanceOf(
      ReviewConflictError,
    );
    // A different customer may still review the same product.
    const other = await submitReview({ userId: userB, productId, rating: 5 });
    expect(other.id).toBeDefined();

    await testDb.delete(reviews).where(eq(reviews.productId, productId));
  });

  it("keeps exactly one row under concurrent duplicate submissions", async () => {
    const [a, b] = await Promise.allSettled([
      submitReview({ userId: userA, productId: product2Id, rating: 5 }),
      submitReview({ userId: userA, productId: product2Id, rating: 4 }),
    ]);
    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const failed = [a, b].filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ReviewConflictError);
    const rows = await testDb.select().from(reviews).where(eq(reviews.productId, product2Id));
    expect(rows.filter((r) => r.userId === userA)).toHaveLength(1);

    await testDb.delete(reviews).where(eq(reviews.productId, product2Id));
  });

  it("validates rating, text, images, and product eligibility", async () => {
    for (const rating of [0, 6, 2.5]) {
      await expect(submitReview({ userId: userA, productId, rating })).rejects.toBeInstanceOf(
        ReviewValidationError,
      );
    }
    await expect(
      submitReview({ userId: userA, productId, rating: 5, title: "x".repeat(121) }),
    ).rejects.toBeInstanceOf(ReviewValidationError);
    await expect(
      submitReview({
        userId: userA,
        productId,
        rating: 5,
        images: [
          { url: "https://example.com/1.jpg", publicId: "a" },
          { url: "https://example.com/2.jpg", publicId: "b" },
          { url: "https://example.com/3.jpg", publicId: "c" },
          { url: "https://example.com/4.jpg", publicId: "d" },
          { url: "https://example.com/5.jpg", publicId: "e" },
        ],
      }),
    ).rejects.toBeInstanceOf(ReviewValidationError);
    await expect(
      submitReview({ userId: userA, productId, rating: 5, images: [{ url: "http://x.com/a.jpg", publicId: "a" }] }),
    ).rejects.toBeInstanceOf(ReviewValidationError);
    await expect(
      submitReview({ userId: userA, productId: "00000000-0000-0000-0000-000000000000", rating: 5 }),
    ).rejects.toBeInstanceOf(ReviewValidationError);

    await testDb
      .update(products)
      .set({ status: "DRAFT" })
      .where(eq(products.id, productId));
    await expect(submitReview({ userId: userA, productId, rating: 5 })).rejects.toBeInstanceOf(
      ReviewValidationError,
    );
    await testDb.update(products).set({ status: "ACTIVE" }).where(eq(products.id, productId));
  });
});

describe("verified-buyer determination", () => {
  it("marks reviews verified only for the buyer's delivered product", async () => {
    await deliveredOrder(userA, variantId, "DELIVERED");
    await deliveredOrder(userA, variant2Id, "SHIPPED");
    await deliveredOrder(userB, variantId, "DELIVERED");

    // Own delivered product → verified.
    const mine = await submitReview({ userId: userA, productId, rating: 5 });
    const [mineRow] = await testDb.select().from(reviews).where(eq(reviews.id, mine.id));
    expect(mineRow!.isVerifiedBuyer).toBe(true);

    // Shipped (not delivered) product → not verified.
    const shipped = await submitReview({ userId: userA, productId: product2Id, rating: 4 });
    const [shippedRow] = await testDb.select().from(reviews).where(eq(reviews.id, shipped.id));
    expect(shippedRow!.isVerifiedBuyer).toBe(false);

    // Another customer's delivered order does not qualify this customer.
    const other = await submitReview({ userId: userB, productId: product2Id, rating: 4 });
    const [otherRow] = await testDb.select().from(reviews).where(eq(reviews.id, other.id));
    expect(otherRow!.isVerifiedBuyer).toBe(false);

    await testDb.delete(reviews).where(eq(reviews.productId, productId));
    await testDb.delete(reviews).where(eq(reviews.productId, product2Id));
  });
});

describe("review image upload params", () => {
  it("scopes the upload folder to the signed-in customer", async () => {
    sessionStore.userId = userA;
    const res = await getReviewImageUploadParamsAction();
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error("expected ok");
    expect(res.data.params.folder).toBe(`velora/reviews/${userA}`);
  });
});

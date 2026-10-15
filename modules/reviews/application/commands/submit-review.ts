import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import { orderItems, orders } from "@/infrastructure/database/schema/orders";
import { productVariants } from "@/infrastructure/database/schema/catalog";
import { reviewImages, reviews } from "@/infrastructure/database/schema/reviews";
import {
  assertRating,
  assertReviewText,
  MAX_CONTENT_LENGTH,
  MAX_REVIEW_IMAGES,
  MAX_TITLE_LENGTH,
} from "@/modules/reviews/domain/review-rules";
import {
  ReviewConflictError,
  ReviewValidationError,
} from "@/modules/reviews/domain/review-errors";

export interface ReviewImageInput {
  url: string;
  publicId: string;
}

export interface SubmitReviewInput {
  /** Authenticated customer id — always from the session, never the client. */
  userId: string;
  productId: string;
  rating: number;
  title?: string | null;
  content?: string | null;
  images?: ReviewImageInput[];
}

function assertImageInput(image: ReviewImageInput, index: number): { url: string; publicId: string } {
  const publicId = image.publicId?.trim() ?? "";
  if (publicId.length === 0 || publicId.length > 255) {
    throw new ReviewValidationError(`Image ${index + 1}: provider reference is invalid.`);
  }
  let url: URL;
  try {
    url = new URL(image.url);
  } catch {
    throw new ReviewValidationError(`Image ${index + 1}: URL is invalid.`);
  }
  if (url.protocol !== "https:") {
    throw new ReviewValidationError(`Image ${index + 1}: URL must use HTTPS.`);
  }
  return { url: url.toString(), publicId };
}

/**
 * Whether the customer holds a DELIVERED order containing the product.
 * EXISTS query: one row max, no join fan-out, cancelled/failed/paid-only
 * orders never qualify. The customer id must come from the session.
 */
export async function hasDeliveredOrderForProduct(
  userId: string,
  productId: string,
): Promise<boolean> {
  const [hit] = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "DELIVERED"),
        eq(productVariants.productId, productId),
      ),
    )
    .limit(1);
  return !!hit;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.code === "23505") return true;
      if (typeof record.message === "string" && record.message.includes("duplicate key value")) {
        return true;
      }
      current = "cause" in record ? record.cause : null;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Submit a customer review. Creates a PENDING row with a server-determined
 * verified-buyer flag — the client can neither set the flag nor impersonate
 * another author. Concurrent duplicates converge on the unique
 * (user, product) constraint and surface as a friendly conflict.
 */
export async function submitReview(input: SubmitReviewInput): Promise<{ id: string }> {
  assertRating(input.rating);
  const title = assertReviewText(input.title, "Title", MAX_TITLE_LENGTH);
  const content = assertReviewText(input.content, "Review", MAX_CONTENT_LENGTH);
  const images = input.images ?? [];
  if (images.length > MAX_REVIEW_IMAGES) {
    throw new ReviewValidationError(`At most ${MAX_REVIEW_IMAGES} images per review.`);
  }
  const validatedImages = images.map(assertImageInput);

  const [product] = await db
    .select({ id: products.id, status: products.status })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) {
    throw new ReviewValidationError("That product could not be found.");
  }
  if (product.status !== "ACTIVE") {
    throw new ReviewValidationError("This product is not eligible for reviews right now.");
  }

  const verified = await hasDeliveredOrderForProduct(input.userId, input.productId);

  try {
    const [created] = await db
      .insert(reviews)
      .values({
        userId: input.userId,
        productId: input.productId,
        rating: input.rating,
        title,
        content,
        status: "pending",
        isVerifiedBuyer: verified,
      })
      .returning({ id: reviews.id });
    if (!created) throw new Error("Review insert failed");

    for (const [index, image] of validatedImages.entries()) {
      await db.insert(reviewImages).values({
        reviewId: created.id,
        url: image.url,
        publicId: image.publicId,
        sortOrder: index,
        isPrimary: index === 0,
      });
    }
    return { id: created.id };
  } catch (error) {
    if (isUniqueViolation(error)) throw new ReviewConflictError();
    throw error;
  }
}

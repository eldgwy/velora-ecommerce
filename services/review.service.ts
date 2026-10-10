import { and, eq, ne } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { reviews } from "@/infrastructure/database/schema/reviews";
import { reviewStatusEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";

export type ReviewStatus = (typeof reviewStatusEnum.enumValues)[number];

export interface ReviewModerationResult {
  id: string;
  productId: string;
  rating: number | null;
  status: ReviewStatus;
  /** `true` when the row was actually changed (not a redundant self-transition). */
  changed: boolean;
}

export class ReviewNotFoundError extends Error {
  constructor(reviewId: string) {
    super(`Review not found: ${reviewId}`);
    this.name = "ReviewNotFoundError";
  }
}

/**
 * Fetch a single review by id (server-only read path).
 */
export async function getReviewById(
  reviewId: string,
): Promise<{
  id: string;
  productId: string;
  rating: number | null;
  status: ReviewStatus | null;
} | null> {
  const [row] = await db
    .select({
      id: reviews.id,
      productId: reviews.productId,
      rating: reviews.rating,
      status: reviews.status,
    })
    .from(reviews)
    .where(eq(reviews.id, reviewId));

  return row ? row : null;
}

/**
 * Transition a review's moderation status.
 *
 * Policy (3-state model): every directed non-self transition is permitted
 * (pending→approved, pending→rejected, approved→rejected, rejected→approved).
 * A self-transition (e.g. approving an already-approved review) is a no-op and
 * returns `changed: false` without writing or invalidating anything.
 *
 * The change is applied with a conditional `UPDATE ... WHERE status <> $target`
 * so that concurrent moderations of the same review serialize safely: only the
 * transaction whose `WHERE` still matches commits a change; the loser observes
 * 0 affected rows and re-reads the current state.
 */
export async function moderateReview(
  reviewId: string,
  status: ReviewStatus,
  actorId?: string,
  requestId?: string,
): Promise<ReviewModerationResult> {
  if (!reviewStatusEnum.enumValues.includes(status)) {
    throw new Error(`Invalid review status: ${status}`);
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        productId: reviews.productId,
        rating: reviews.rating,
        status: reviews.status,
      })
      .from(reviews)
      .where(eq(reviews.id, reviewId));

    if (!current) {
      throw new ReviewNotFoundError(reviewId);
    }

    // Redundant self-transition: nothing to write.
    if (current.status === status) {
      return {
        id: reviewId,
        productId: current.productId,
        rating: current.rating,
        status,
        changed: false,
      };
    }

    const [updated] = await tx
      .update(reviews)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(reviews.id, reviewId), ne(reviews.status, status)))
      .returning({
        id: reviews.id,
        productId: reviews.productId,
        rating: reviews.rating,
        status: reviews.status,
      });

    if (!updated) {
      // Lost the race: another transaction already changed the status. Treat as
      // a no-op rather than overwriting their decision.
      return {
        id: reviewId,
        productId: current.productId,
        rating: current.rating,
        status,
        changed: false,
      };
    }

    logger.catalog.reviewModerated(
      updated.id,
      updated.productId,
      current.status ?? "unknown",
      status,
      actorId ?? "unknown",
      requestId,
    );

    return {
      id: updated.id,
      productId: updated.productId,
      rating: updated.rating,
      status: status,
      changed: true,
    };
  });
}

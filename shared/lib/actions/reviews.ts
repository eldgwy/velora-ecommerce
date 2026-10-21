"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import {
  getReviewById,
  moderateReview,
  ReviewNotFoundError,
  type ReviewStatus,
} from "@/services/review.service";
import { invalidateReviewCache } from "@/shared/lib/cache/tags";

const moderateReviewSchema = z.object({
  reviewId: z.string().uuid("Invalid review ID."),
  status: z.enum(["pending", "approved", "rejected"]) satisfies z.ZodType<ReviewStatus>,
});

export async function moderateReviewAction(
  input: unknown,
): Promise<{ id: string; changed: boolean } | { error: string }> {
  const session = await requireAdmin();

  const parsed = moderateReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    // Queue policy (T-5.4): moderation is revisable. Any status change is
    // legal — re-opening a moderated review back to pending, direct flips
    // between moderated states, and first-time pending decisions. Review
    // content is intentionally immutable (customer-authored record); the
    // same-status case is a safe no-op that surfaces `changed: false`.
    const current = await getReviewById(parsed.data.reviewId);
    if (!current) {
      return { error: "Review not found." };
    }

    const result = await moderateReview(
      parsed.data.reviewId,
      parsed.data.status,
      session.user.id,
    );

    // Only invalidate caches when the moderation actually changed visibility.
    if (result.changed && result.productId) {
      await invalidateReviewCache(result.productId);
    }

    return { id: result.id, changed: result.changed };
  } catch (err) {
    console.error("[reviews] moderateReview failed:", err);
    if (err instanceof ReviewNotFoundError) {
      return { error: "Review not found." };
    }
    return { error: "We couldn't update the review. Please try again." };
  }
}

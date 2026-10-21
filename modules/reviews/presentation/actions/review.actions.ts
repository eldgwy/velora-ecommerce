"use server";

import { z } from "zod";

import { getCurrentSession, requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import { submitReview } from "@/modules/reviews/application/commands/submit-review";
import {
  getModerationQueue,
  type ModerationQueue,
} from "@/modules/reviews/application/queries/reviews";
import {
  ReviewConflictError,
  ReviewValidationError,
} from "@/modules/reviews/domain/review-errors";
import { createSignedUploadParams } from "@/infrastructure/cloudinary/client";
import { invalidateReviewCache } from "@/shared/lib/cache/tags";
import { consumeRateLimit, UGC_RATE_LIMITS } from "@/shared/lib/rate-limit";

const reviewImageSchema = z.object({
  url: z.string().url("Image URL is invalid.").max(2048),
  publicId: z.string().trim().min(1).max(255),
});

const submitReviewSchema = z.object({
  productId: z.string().uuid("Invalid product."),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  content: z.string().trim().max(5000).optional(),
  images: z.array(reviewImageSchema).max(4).optional(),
});

/**
 * Submit a customer review. The author id always comes from the session —
 * a supplied user id is never accepted. Reviews start PENDING; the
 * verified-buyer flag is determined server-side.
 */
export async function submitReviewAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in to write a review." };
  const parsed = submitReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid review details." };
  }
  // UGC throttle (GP-15): meter only well-formed submissions, so malformed
  // spam payloads don't run down a customer's quota but real abuse does.
  const allowed = await consumeRateLimit(
    "reviews:submit",
    session.user.id,
    UGC_RATE_LIMITS.reviewSubmit,
  );
  if (!allowed) {
    return {
      ok: false,
      error: "You have submitted several reviews recently. Please try again a bit later.",
    };
  }
  try {
    const result = await submitReview({
      userId: session.user.id,
      productId: parsed.data.productId,
      rating: parsed.data.rating,
      title: parsed.data.title ?? null,
      content: parsed.data.content ?? null,
      images: parsed.data.images ?? [],
    });
    await invalidateReviewCache(parsed.data.productId);
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof ReviewConflictError || error instanceof ReviewValidationError) {
      return { ok: false, error: error.message };
    }
    logger.error("Review submission failed", {
      module: "reviews",
      action: "submitReview",
      userId: session.user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "Your review could not be saved. Please try again." };
  }
}

/**
 * Signed Cloudinary params for review-image uploads. Scoped to the
 * customer's own folder; recording the image still requires review
 * ownership at submission time.
 */
export async function getReviewImageUploadParamsAction(): Promise<
  ActionResult<{ params: ReturnType<typeof createSignedUploadParams> }>
> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in to upload images." };
  // Metered (GP-15): signed upload params were previously unmetered; each
  // call mints a valid provider credential for the caller's own folder.
  const allowed = await consumeRateLimit(
    "reviews:upload-params",
    session.user.id,
    UGC_RATE_LIMITS.reviewUploadParams,
  );
  if (!allowed) {
    return { ok: false, error: "Too many upload attempts recently. Please try again later." };
  }
  const params = createSignedUploadParams({
    folder: `velora/reviews/${session.user.id}`,
    tags: [session.user.id],
  });
  return { ok: true, data: { params } };
}

const queueFilterSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  productId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** Admin moderation queue (ADMIN/STAFF, server-gated). */
export async function getModerationQueueAction(
  input: unknown,
): Promise<ActionResult<ModerationQueue>> {
  await requireAdmin();
  const parsed = queueFilterSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  const queue = await getModerationQueue(parsed.data);
  return { ok: true, data: queue };
}

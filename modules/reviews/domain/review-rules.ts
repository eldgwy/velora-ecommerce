import { ReviewValidationError } from "./review-errors";

/**
 * Review domain rules (pure, no framework or DB imports).
 *
 * Lifecycle — T-5.4 (product-approved via the Phase 5 gate): moderation is
 * REVISABLE. Any non-self status transition is legal, including re-opening
 * a moderated review back to PENDING (re-moderation) and direct flips
 * (approved→rejected, rejected→approved). Reviews are customer-authored
 * records and their CONTENT stays immutable — the admin flow offers
 * re-moderation, never text/rating editing. The persisted
 * moderated_by/moderated_at columns record the LATEST moderation action
 * (write-on-transition semantics, unchanged).
 */

export type ModeratedStatus = "pending" | "approved" | "rejected";

const MODERATED_STATUSES: ReadonlyArray<ModeratedStatus> = [
  "pending",
  "approved",
  "rejected",
];

/** True when `from → to` is a legal moderation move (replays allowed). */
export function canTransitionReview(
  from: ModeratedStatus,
  to: ModeratedStatus,
): boolean {
  if (from === to) return true;
  return MODERATED_STATUSES.includes(from) && MODERATED_STATUSES.includes(to);
}

/** Ratings are integers 1–5, no fractions, no strings. */
export function assertRating(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new ReviewValidationError("Rating must be an integer from 1 to 5.");
  }
}

export const MAX_REVIEW_IMAGES = 4;
export const MAX_TITLE_LENGTH = 120;
export const MAX_CONTENT_LENGTH = 5000;

/** Optional text fields: absent, or trimmed 1–N chars. */
export function assertReviewText(
  value: string | null | undefined,
  label: string,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new ReviewValidationError(`${label} must not exceed ${max} characters.`);
  }
  return trimmed;
}

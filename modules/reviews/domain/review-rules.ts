import { ReviewValidationError } from "./review-errors";

/**
 * Review domain rules (pure, no framework or DB imports).
 *
 * Lifecycle for the moderated queue path: PENDING → APPROVED | REJECTED,
 * with same-state replays allowed. Rejected reviews stay excluded from
 * public display permanently (no resubmission in this scope).
 *
 * Note: the legacy `moderateReview` service permits re-evaluation between
 * non-pending states (covered by its own tests); the admin queue below
 * only ever issues PENDING-sourced transitions, enforced at the command
 * layer.
 */

export type ModeratedStatus = "pending" | "approved" | "rejected";

const MODERATION_TRANSITIONS: Array<{ from: ModeratedStatus; to: ModeratedStatus }> = [
  { from: "pending", to: "approved" },
  { from: "pending", to: "rejected" },
];

/** True when `from → to` is a legal moderation move (replays allowed). */
export function canTransitionReview(
  from: ModeratedStatus,
  to: ModeratedStatus,
): boolean {
  if (from === to) return true;
  return MODERATION_TRANSITIONS.some((r) => r.from === from && r.to === to);
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

import { describe, it, expect } from "vitest";

import {
  MAX_CONTENT_LENGTH,
  MAX_REVIEW_IMAGES,
  MAX_TITLE_LENGTH,
  assertRating,
  assertReviewText,
  canTransitionReview,
} from "@/modules/reviews/domain/review-rules";
import { ReviewValidationError } from "@/modules/reviews/domain/review-errors";

describe("rating validation", () => {
  it("accepts integers 1 through 5", () => {
    for (const r of [1, 2, 3, 4, 5]) {
      expect(() => assertRating(r)).not.toThrow();
    }
  });

  it("rejects out-of-range, fractional, and non-numeric input", () => {
    for (const bad of [0, 6, -1, 2.5, NaN, "5", null, undefined, {}, []]) {
      expect(() => assertRating(bad)).toThrow(ReviewValidationError);
    }
  });
});

describe("moderation transitions", () => {
  it("allows pending approval and rejection plus replays", () => {
    expect(canTransitionReview("pending", "approved")).toBe(true);
    expect(canTransitionReview("pending", "rejected")).toBe(true);
    for (const s of ["pending", "approved", "rejected"] as const) {
      expect(canTransitionReview(s, s)).toBe(true);
    }
  });

  // T-5.4: moderation is revisable — re-open (back to pending) and direct
  // flips between moderated states are legal; the latest action wins the
  // audit columns. Content itself stays immutable (separate rule).
  it("allows re-moderation: re-open and direct flips", () => {
    expect(canTransitionReview("approved", "pending")).toBe(true);
    expect(canTransitionReview("rejected", "pending")).toBe(true);
    expect(canTransitionReview("approved", "rejected")).toBe(true);
    expect(canTransitionReview("rejected", "approved")).toBe(true);
  });
});

describe("review text validation", () => {
  it("trims, nulls blanks, and enforces length caps", () => {
    expect(assertReviewText("  Great!  ", "Title", MAX_TITLE_LENGTH)).toBe("Great!");
    expect(assertReviewText("   ", "Title", MAX_TITLE_LENGTH)).toBeNull();
    expect(assertReviewText(null, "Title", MAX_TITLE_LENGTH)).toBeNull();
    expect(assertReviewText(undefined, "Review", MAX_CONTENT_LENGTH)).toBeNull();
    expect(() => assertReviewText("x".repeat(MAX_TITLE_LENGTH + 1), "Title", MAX_TITLE_LENGTH)).toThrow(
      ReviewValidationError,
    );
    expect(() =>
      assertReviewText("x".repeat(MAX_CONTENT_LENGTH + 1), "Review", MAX_CONTENT_LENGTH),
    ).toThrow(ReviewValidationError);
  });

  it("pins the documented limits", () => {
    expect(MAX_TITLE_LENGTH).toBe(120);
    expect(MAX_CONTENT_LENGTH).toBe(5000);
    expect(MAX_REVIEW_IMAGES).toBe(4);
  });
});

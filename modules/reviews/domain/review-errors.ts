export class ReviewNotFoundError extends Error {
  constructor(reviewId: string) {
    super(`Review not found: ${reviewId}`);
    this.name = "ReviewNotFoundError";
  }
}

/** Duplicate (customer, product) submission. Message is safe to surface. */
export class ReviewConflictError extends Error {
  constructor() {
    super("You have already reviewed this product.");
    this.name = "ReviewConflictError";
  }
}

/** Input validation failure. Message is safe to surface as-is. */
export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

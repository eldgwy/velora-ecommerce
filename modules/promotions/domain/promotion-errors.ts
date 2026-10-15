export class PromotionNotFoundError extends Error {
  constructor(id: string) {
    super(`Promotion not found: ${id}`);
    this.name = "PromotionNotFoundError";
  }
}

export class PromotionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionConflictError";
  }
}

/** Admin input validation failure. Message is safe to surface as-is. */
export class PromotionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionValidationError";
  }
}

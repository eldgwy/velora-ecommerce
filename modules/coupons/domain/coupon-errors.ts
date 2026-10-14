export class CouponNotFoundError extends Error {
  constructor(codeOrId: string) {
    super(`Coupon not found: ${codeOrId}`);
    this.name = "CouponNotFoundError";
  }
}

export class CouponConflictError extends Error {
  constructor(code: string) {
    super(`A coupon with code ${code} already exists.`);
    this.name = "CouponConflictError";
  }
}

/** Admin input validation failure. Message is safe to surface as-is. */
export class CouponValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouponValidationError";
  }
}

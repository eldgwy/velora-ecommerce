export class CheckoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutValidationError";
  }
}

export class EmptyCartError extends CheckoutValidationError {
  constructor() {
    super("Your cart is empty.");
    this.name = "EmptyCartError";
  }
}

export class CartConflictError extends CheckoutValidationError {
  /** Structured validation snapshot for the UI (opaque to the error path). */
  details?: unknown;
  constructor(
    message = "Your cart changed and needs attention before checkout.",
    details?: unknown,
  ) {
    super(message);
    this.name = "CartConflictError";
    this.details = details;
  }
}

export class AddressOwnershipError extends CheckoutValidationError {
  constructor(message = "The selected address does not belong to your account.") {
    super(message);
    this.name = "AddressOwnershipError";
  }
}

export class ShippingMethodError extends CheckoutValidationError {
  constructor(method: string) {
    super(`Unsupported shipping method: ${method}`);
    this.name = "ShippingMethodError";
  }
}

export class CouponInvalidError extends CheckoutValidationError {
  constructor(message: string) {
    super(message);
    this.name = "CouponInvalidError";
  }
}

export class StockConflictError extends CheckoutValidationError {
  constructor(message: string) {
    super(message);
    this.name = "StockConflictError";
  }
}

export class CartConsumedError extends CheckoutValidationError {
  constructor() {
    super("This cart has already been checked out.");
    this.name = "CartConsumedError";
  }
}

export class IdempotencyConflictError extends CheckoutValidationError {
  constructor() {
    super("This checkout key was already used with different details.");
    this.name = "IdempotencyConflictError";
  }
}

export class OrderNotFoundError extends CheckoutValidationError {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

export class PaymentInitError extends CheckoutValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PaymentInitError";
  }
}

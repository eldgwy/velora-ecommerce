export class CartNotFoundError extends Error {
  constructor(cartId: string) {
    super(`Cart not found: ${cartId}`);
    this.name = "CartNotFoundError";
  }
}

export class CartItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`Cart item not found: ${itemId}`);
    this.name = "CartItemNotFoundError";
  }
}

export class InvalidCartItemQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCartItemQuantityError";
  }
}

export class VariantNotFoundError extends Error {
  constructor(variantId: string) {
    super(`Variant not found: ${variantId}`);
    this.name = "VariantNotFoundError";
  }
}

export class ProductNotFoundError extends Error {
  constructor(productId: string) {
    super(`Product not found: ${productId}`);
    this.name = "ProductNotFoundError";
  }
}

export class VariantInactiveError extends Error {
  constructor(variantId: string) {
    super(`Variant is not active: ${variantId}`);
    this.name = "VariantInactiveError";
  }
}

export class ProductInactiveError extends Error {
  constructor(productId: string) {
    super(`Product is not active: ${productId}`);
    this.name = "ProductInactiveError";
  }
}

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export class CartAlreadyActiveError extends Error {
  constructor(userId: string) {
    super(`User already has an active cart: ${userId}`);
    this.name = "CartAlreadyActiveError";
  }
}

export class GuestCartCookieInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestCartCookieInvalidError";
  }
}

export class GuestCartMergeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestCartMergeConflictError";
  }
}

export class CartValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartValidationError";
  }
}

export class UnauthorizedCartAccessError extends Error {
  constructor(message: string = "Unauthorized cart access") {
    super(message);
    this.name = "UnauthorizedCartAccessError";
  }
}

export class DuplicateCartItemError extends Error {
  constructor(variantId: string) {
    super(`Variant already in cart: ${variantId}`);
    this.name = "DuplicateCartItemError";
  }
}
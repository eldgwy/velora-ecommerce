export class ProductNotAvailableError extends Error {
  constructor(productId: string) {
    super(`Product is not available to save: ${productId}`);
    this.name = "ProductNotAvailableError";
  }
}

export class WishlistAccessError extends Error {
  constructor(message = "Wishlist access denied.") {
    super(message);
    this.name = "WishlistAccessError";
  }
}

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderItemNotFoundError extends Error {
  constructor(orderId: string) {
    super(`No items found for order: ${orderId}`);
    this.name = "OrderItemNotFoundError";
  }
}

export class InvalidOrderItemQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrderItemQuantityError";
  }
}

export class OrderAlreadyReservedError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} already has reserved inventory`);
    this.name = "OrderAlreadyReservedError";
  }
}

export class InsufficientStockForOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockForOrderError";
  }
}

export class InvalidOrderTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrderTransitionError";
  }
}

export class OrderAlreadyCancelledError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} is already cancelled`);
    this.name = "OrderAlreadyCancelledError";
  }
}

export class OrderAlreadyCompletedError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} cannot be cancelled - already fulfilled`);
    this.name = "OrderAlreadyCompletedError";
  }
}

export class OrderReservationReleasedError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} reservation already released`);
    this.name = "OrderReservationReleasedError";
  }
}
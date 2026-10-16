export class BannerNotFoundError extends Error {
  constructor(id: string) {
    super(`Banner not found: ${id}`);
    this.name = "BannerNotFoundError";
  }
}

/** Admin input validation failure. Message is safe to surface as-is. */
export class BannerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BannerValidationError";
  }
}

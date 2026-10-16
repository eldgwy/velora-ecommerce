export class CollectionNotFoundError extends Error {
  constructor(slugOrId: string) {
    super(`Collection not found: ${slugOrId}`);
    this.name = "CollectionNotFoundError";
  }
}

export class CollectionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionConflictError";
  }
}

/** Admin input validation failure. Message is safe to surface as-is. */
export class CollectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionValidationError";
  }
}

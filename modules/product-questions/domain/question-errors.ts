export class QuestionNotFoundError extends Error {
  constructor(questionId: string) {
    super(`Question not found: ${questionId}`);
    this.name = "QuestionNotFoundError";
  }
}

/** Input validation failure. Message is safe to surface as-is. */
export class QuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionValidationError";
  }
}

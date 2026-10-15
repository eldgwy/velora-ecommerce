import { QuestionValidationError } from "./question-errors";

/**
 * Product Q&A lifecycle (domain layer — pure, no framework or DB imports).
 *
 * PENDING → ANSWERED | REJECTED, plus ANSWERED → REJECTED (withdrawal of
 * visible content). REJECTED rows never display publicly again; same-state
 * repeats are idempotent replays. Only ANSWERED rows carrying an answer
 * are public — unanswered questions stay hidden by policy.
 */

export type QuestionStatus = "PENDING" | "ANSWERED" | "REJECTED";

const QUESTION_TRANSITIONS: Array<{ from: QuestionStatus; to: QuestionStatus }> = [
  { from: "PENDING", to: "ANSWERED" },
  { from: "PENDING", to: "REJECTED" },
  { from: "ANSWERED", to: "REJECTED" },
];

/** True when `from → to` is a legal question move (replays allowed). */
export function canTransitionQuestion(from: QuestionStatus, to: QuestionStatus): boolean {
  if (from === to) return true;
  return QUESTION_TRANSITIONS.some((r) => r.from === from && r.to === to);
}

/** Terminal states: rejected content never moves again. */
export function isTerminalQuestionStatus(status: QuestionStatus): boolean {
  return status === "REJECTED";
}

export const MIN_QUESTION_LENGTH = 3;
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_ANSWER_LENGTH = 5000;

/** Customer question text: trimmed 3–2000 chars. */
export function assertQuestionText(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length < MIN_QUESTION_LENGTH || trimmed.length > MAX_QUESTION_LENGTH) {
    throw new QuestionValidationError(
      `Question must be between ${MIN_QUESTION_LENGTH} and ${MAX_QUESTION_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/** Staff answer text: trimmed 1–5000 chars. */
export function assertAnswerText(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ANSWER_LENGTH) {
    throw new QuestionValidationError(`Answer must be between 1 and ${MAX_ANSWER_LENGTH} characters.`);
  }
  return trimmed;
}

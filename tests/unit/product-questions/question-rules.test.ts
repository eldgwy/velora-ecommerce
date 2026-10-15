import { describe, it, expect } from "vitest";

import {
  MAX_ANSWER_LENGTH,
  MAX_QUESTION_LENGTH,
  MIN_QUESTION_LENGTH,
  assertAnswerText,
  assertQuestionText,
  canTransitionQuestion,
  isTerminalQuestionStatus,
} from "@/modules/product-questions/domain/question-rules";
import { QuestionValidationError } from "@/modules/product-questions/domain/question-errors";

describe("question text validation", () => {
  it("accepts trimmed questions within bounds", () => {
    expect(assertQuestionText("  Is this washable?  ")).toBe("Is this washable?");
    expect(MIN_QUESTION_LENGTH).toBe(3);
    expect(MAX_QUESTION_LENGTH).toBe(2000);
  });

  it("rejects empty and oversized questions", () => {
    for (const bad of ["", "  ", "ab", "x".repeat(2001), null, undefined]) {
      expect(() => assertQuestionText(bad)).toThrow(QuestionValidationError);
    }
  });

  it("validates staff answers", () => {
    expect(assertAnswerText(" Yes, it is. ")).toBe("Yes, it is.");
    expect(MAX_ANSWER_LENGTH).toBe(5000);
    for (const bad of ["", "   ", "x".repeat(5001), null, undefined]) {
      expect(() => assertAnswerText(bad)).toThrow(QuestionValidationError);
    }
  });
});

describe("question lifecycle", () => {
  it("allows pending answer/reject plus replays", () => {
    expect(canTransitionQuestion("PENDING", "ANSWERED")).toBe(true);
    expect(canTransitionQuestion("PENDING", "REJECTED")).toBe(true);
    for (const s of ["PENDING", "ANSWERED", "REJECTED"] as const) {
      expect(canTransitionQuestion(s, s)).toBe(true);
    }
  });

  it("allows withdrawal and forbids everything else", () => {
    expect(canTransitionQuestion("ANSWERED", "REJECTED")).toBe(true);
    expect(canTransitionQuestion("REJECTED", "ANSWERED")).toBe(false);
    expect(canTransitionQuestion("REJECTED", "PENDING")).toBe(false);
    expect(canTransitionQuestion("ANSWERED", "PENDING")).toBe(false);
    expect(canTransitionQuestion("PENDING", "PENDING")).toBe(true);
  });

  it("marks rejected terminal only", () => {
    expect(isTerminalQuestionStatus("REJECTED")).toBe(true);
    expect(isTerminalQuestionStatus("PENDING")).toBe(false);
    expect(isTerminalQuestionStatus("ANSWERED")).toBe(false);
  });
});

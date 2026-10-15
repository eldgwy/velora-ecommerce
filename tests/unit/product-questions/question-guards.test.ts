import { vi, describe, it, expect } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/database", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("DB must not be touched"); } }),
}));
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/guards", () => ({
  getCurrentSession: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => {
    throw new Error("NEXT_REDIRECT");
  }),
  requireSession: vi.fn(async () => {
    throw new Error("NEXT_REDIRECT");
  }),
  requireRole: vi.fn(async () => {
    throw new Error("FORBIDDEN");
  }),
}));

import {
  answerQuestionAction,
  getMyQuestionsAction,
  getQuestionQueueAction,
  rejectQuestionAction,
  submitQuestionAction,
} from "@/modules/product-questions/presentation/actions/question.actions";

/**
 * Q&A action guards: sessionless customers cannot submit or read history,
 * and sessionless staff cannot touch the queue. All fail before any
 * validation, database access, or state change.
 */
describe("product Q&A action guards", () => {
  it("refuses sessionless question submission", async () => {
    await expect(
      submitQuestionAction({
        productId: "00000000-0000-0000-0000-000000000000",
        question: "Is this washable?",
      }),
    ).resolves.toEqual({ ok: false, error: "You must be signed in to ask a question." });
  });

  it("refuses sessionless history access", async () => {
    await expect(getMyQuestionsAction({})).resolves.toEqual({
      ok: false,
      error: "You must be signed in.",
    });
  });

  it("refuses sessionless answering, rejection, and queue access", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    await expect(answerQuestionAction({ questionId: id, answer: "Yes." })).rejects.toThrow();
    await expect(rejectQuestionAction({ questionId: id })).rejects.toThrow();
    await expect(getQuestionQueueAction({})).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(submitQuestionAction("not-an-object")).resolves.toEqual({
      ok: false,
      error: "You must be signed in to ask a question.",
    });
  });
});

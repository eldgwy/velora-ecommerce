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
  getModerationQueueAction,
  submitReviewAction,
} from "@/modules/reviews/presentation/actions/review.actions";

/**
 * Review action guards: sessionless customers cannot submit, and
 * sessionless staff cannot read the moderation queue. Both fail before any
 * validation, database access, or state change.
 */
describe("review action guards", () => {
  it("refuses sessionless review submission without touching the database", async () => {
    // Any database access throws via the db mock; resolving { ok: false }
    // proves the action failed closed before validation or persistence.
    await expect(
      submitReviewAction({ productId: "00000000-0000-0000-0000-000000000000", rating: 5 }),
    ).resolves.toEqual({ ok: false, error: "You must be signed in to write a review." });
  });

  it("refuses sessionless moderation queue access", async () => {
    await expect(getModerationQueueAction({})).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(submitReviewAction("not-an-object")).resolves.toEqual({
      ok: false,
      error: "You must be signed in to write a review.",
    });
  });
});

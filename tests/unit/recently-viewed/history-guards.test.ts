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
  clearHistoryAction,
  mergeGuestHistoryAction,
  recordViewAction,
  removeHistoryEntryAction,
  resolveGuestHistoryAction,
} from "@/modules/recently-viewed/presentation/actions/history.actions";

/**
 * History action guards: sessionless callers cannot touch server-side
 * history. The guest resolver stays public (catalog data only) but rejects
 * malformed input. All fail before any database access.
 */
describe("recently-viewed action guards", () => {
  const id = "00000000-0000-0000-0000-000000000000";

  it("refuses sessionless record, remove, clear, and merge", async () => {
    await expect(recordViewAction({ productId: id })).resolves.toEqual({
      ok: false,
      error: "Not signed in.",
    });
    await expect(removeHistoryEntryAction({ productId: id })).resolves.toEqual({
      ok: false,
      error: "You must be signed in.",
    });
    await expect(clearHistoryAction()).resolves.toEqual({
      ok: false,
      error: "You must be signed in.",
    });
    await expect(mergeGuestHistoryAction([])).resolves.toEqual({
      ok: false,
      error: "You must be signed in.",
    });
  });

  it("rejects malformed guest resolution input", async () => {
    await expect(resolveGuestHistoryAction("not-an-array")).resolves.toEqual({
      ok: false,
      error: "Invalid history.",
    });
  });
});

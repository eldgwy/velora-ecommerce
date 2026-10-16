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
  addProductToCollectionAction,
  createCollectionAction,
  listCollectionsAction,
  reorderCollectionProductsAction,
  setCollectionActiveAction,
} from "@/modules/collections/presentation/actions/collection-admin.actions";

/**
 * Collection admin guards: sessionless callers cannot reach any mutation
 * or read. All fail before validation, database access, or state change.
 */
describe("collection admin action guards", () => {
  const id = "00000000-0000-0000-0000-000000000000";

  it("refuses sessionless list, create, map, reorder, and activation", async () => {
    await expect(listCollectionsAction({})).rejects.toThrow();
    await expect(createCollectionAction({ name: "X" })).rejects.toThrow();
    await expect(
      addProductToCollectionAction({ collectionId: id, productId: id }),
    ).rejects.toThrow();
    await expect(
      reorderCollectionProductsAction({ collectionId: id, orderedProductIds: [id] }),
    ).rejects.toThrow();
    await expect(setCollectionActiveAction({ id, isActive: true })).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(createCollectionAction("not-an-object")).rejects.toThrow();
  });
});

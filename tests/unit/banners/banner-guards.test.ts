import { vi, describe, it, expect } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/database", () => ({
  db: new Proxy({}, { get: () => () => { throw new Error("DB must not be touched"); } }),
}));
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
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
  createBannerAction,
  deleteBannerAction,
  listBannersAction,
  reorderBannersAction,
  transitionBannerStatusAction,
  updateBannerAction,
} from "@/modules/banners/presentation/actions/banner-admin.actions";

/**
 * Banner admin guards: sessionless callers reach nothing. All fail before
 * validation, database access, or state change.
 */
describe("banner admin action guards", () => {
  const id = "00000000-0000-0000-0000-000000000000";

  it("refuses sessionless list, create, update, delete, transition, reorder", async () => {
    await expect(listBannersAction({})).rejects.toThrow();
    await expect(createBannerAction({ title: "X", image: "https://x.example/a.jpg" })).rejects.toThrow();
    await expect(updateBannerAction({ id, title: "X", image: "https://x.example/a.jpg" })).rejects.toThrow();
    await expect(deleteBannerAction(id)).rejects.toThrow();
    await expect(transitionBannerStatusAction({ id, to: "ACTIVE" })).rejects.toThrow();
    await expect(reorderBannersAction({ orderedIds: [id] })).rejects.toThrow();
  });

  it("fails closed before parsing input or touching the database", async () => {
    await expect(createBannerAction("not-an-object")).rejects.toThrow();
  });
});

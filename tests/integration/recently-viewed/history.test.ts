import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const sessionStore = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/guards", () => ({
  getCurrentSession: vi.fn(async () =>
    sessionStore.userId ? { user: { id: sessionStore.userId, role: "CUSTOMER" } } : null,
  ),
  requireAdmin: vi.fn(async () => {
    throw new Error("FORBIDDEN");
  }),
}));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
} from "../_db";
import { productViewHistory } from "@/infrastructure/database/schema/browsing-history";
import { user } from "@/infrastructure/database/schema/auth";
import {
  clearHistory,
  mergeGuestHistory,
  recordProductView,
  removeHistoryEntry,
  ProductNotViewableError,
} from "@/modules/recently-viewed/application/commands/history";
import {
  getRecentHistory,
  resolveGuestHistory,
} from "@/modules/recently-viewed/application/queries/history";
import { HISTORY_LIMIT } from "@/modules/recently-viewed/domain/history-rules";

const SFX = `rv-${Date.now()}`;
let userA = "";
let userB = "";
let categoryId = "";
let brandId = "";
const productIds: string[] = [];
let draftProductId = "";

beforeAll(async () => {
  for (const [key, id] of [["a", `rv-u-a-${SFX}`], ["b", `rv-u-b-${SFX}`]] as const) {
    const [u] = await testDb
      .insert(user)
      .values({ id, name: `Viewer ${key}`, email: `viewer-${key}-${SFX}@ex.com` })
      .returning();
    if (key === "a") userA = u.id;
    else userB = u.id;
  }
  const [cat] = await testDb.insert(categories).values({ slug: `rv-cat-${SFX}`, name: "RV Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `rv-brand-${SFX}`, name: "RV Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  for (let i = 0; i < 25; i += 1) {
    const [p] = await testDb
      .insert(products)
      .values({ name: `RV Product ${i}`, status: "ACTIVE", basePrice: "10.00", categoryId, brandId })
      .returning();
    productIds.push(p.id);
  }
  const [draft] = await testDb
    .insert(products)
    .values({ name: "RV Draft", status: "DRAFT", basePrice: "10.00", categoryId, brandId })
    .returning();
  draftProductId = draft.id;
});

afterAll(async () => {
  await testDb.delete(productViewHistory).where(
    inArray(productViewHistory.userId, [userA, userB]),
  );
  await testDb.delete(products).where(
    inArray(products.id, [...productIds, draftProductId]),
  );
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(inArray(user.id, [userA, userB]));
});

beforeEach(async () => {
  await testDb.delete(productViewHistory).where(
    inArray(productViewHistory.userId, [userA, userB]),
  );
  sessionStore.userId = null;
});

async function rowCount(userId: string): Promise<number> {
  const rows = await testDb
    .select({ id: productViewHistory.id })
    .from(productViewHistory)
    .where(eq(productViewHistory.userId, userId));
  return rows.length;
}

describe("recording and ordering", () => {
  it("records views and refreshes recency without duplicates", async () => {
    await recordProductView(userA, productIds[0]!);
    await recordProductView(userA, productIds[1]!);
    await recordProductView(userA, productIds[0]!);
    expect(await rowCount(userA)).toBe(2);

    const history = await getRecentHistory(userA);
    expect(history.items.map((i) => i.productId)).toEqual([productIds[0], productIds[1]]);
  });

  it("serializes concurrent repeat views to a single row", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => recordProductView(userA, productIds[2]!)),
    );
    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    expect(await rowCount(userA)).toBe(1);
  });

  it("rejects invalid and ineligible products without writing", async () => {
    await expect(
      recordProductView(userA, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(ProductNotViewableError);
    await expect(recordProductView(userA, draftProductId)).rejects.toBeInstanceOf(
      ProductNotViewableError,
    );
    expect(await rowCount(userA)).toBe(0);
  });

  it("caps history at the limit with oldest-first pruning", async () => {
    for (const pid of productIds) {
      await recordProductView(userA, pid, new Date(Date.now()));
    }
    expect(await rowCount(userA)).toBe(HISTORY_LIMIT);
    const history = await getRecentHistory(userA);
    expect(history.items).toHaveLength(HISTORY_LIMIT);
    // Deterministic order: newest first.
    const times = history.items.map((i) => i.viewedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe("removal and clearing", () => {
  it("removes single entries and reports absent rows safely", async () => {
    await recordProductView(userA, productIds[0]!);
    expect((await removeHistoryEntry(userA, productIds[0]!)).removed).toBe(true);
    expect((await removeHistoryEntry(userA, productIds[0]!)).removed).toBe(false);
  });

  it("clears only the caller's history", async () => {
    await recordProductView(userA, productIds[0]!);
    await recordProductView(userB, productIds[0]!);
    const { cleared } = await clearHistory(userA);
    expect(cleared).toBe(1);
    expect(await rowCount(userA)).toBe(0);
    expect(await rowCount(userB)).toBe(1);
  });

  it("never touches another customer's rows", async () => {
    await recordProductView(userB, productIds[1]!);
    expect((await removeHistoryEntry(userA, productIds[1]!)).removed).toBe(false);
    expect(await rowCount(userB)).toBe(1);
  });
});

describe("guest merge", () => {
  it("merges validated entries idempotently and skips unknown ids", async () => {
    const now = Date.now();
    const first = await mergeGuestHistory(userA, [
      { id: productIds[3]!, at: now - 1000 },
      { id: productIds[4]!, at: now },
      { id: "00000000-0000-0000-0000-000000000000", at: now },
      { id: draftProductId, at: now },
    ]);
    expect(first.merged).toBe(2);
    const repeat = await mergeGuestHistory(userA, [
      { id: productIds[3]!, at: now - 1000 },
      { id: productIds[4]!, at: now },
    ]);
    expect(repeat.merged).toBe(2);
    expect(await rowCount(userA)).toBe(2);

    const history = await getRecentHistory(userA);
    expect(history.items[0]!.productId).toBe(productIds[4]);
  });

  it("never regresses fresher server recency with stale guest data", async () => {
    const now = Date.now();
    await recordProductView(userA, productIds[5]!, new Date(now));
    await mergeGuestHistory(userA, [{ id: productIds[5]!, at: now - 86_400_000 }]);
    const history = await getRecentHistory(userA);
    expect(history.items[0]!.productId).toBe(productIds[5]);
    expect(history.items[0]!.viewedAt.getTime()).toBeGreaterThanOrEqual(now - 1000);
  });
});

describe("guest resolution", () => {
  it("resolves live catalog data and drops unknown ids", async () => {
    const items = await resolveGuestHistory([
      productIds[6]!,
      "00000000-0000-0000-0000-000000000000",
      draftProductId,
    ]);
    expect(items.map((i) => i.productId)).toEqual([productIds[6]]);
    expect(items[0]!.productName).toBeDefined();
    expect(items[0]!.basePrice).toBe("10.00");
    expect(await resolveGuestHistory([])).toEqual([]);
  });
});

describe("action session scope", () => {
  it("merges under the session identity", async () => {
    sessionStore.userId = userB;
    const { mergeGuestHistoryAction } = await import(
      "@/modules/recently-viewed/presentation/actions/history.actions"
    );
    const res = await mergeGuestHistoryAction([{ id: productIds[7]!, at: Date.now() }]);
    expect(res).toEqual({ ok: true, data: { merged: 1 } });
    expect(await rowCount(userB)).toBe(1);
    expect(await rowCount(userA)).toBe(0);
  });
});

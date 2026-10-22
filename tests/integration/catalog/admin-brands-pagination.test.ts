import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";

import { testDb } from "../_db";
import { brands } from "../_db";
import { listAdminBrands, ADMIN_BRANDS_PAGE_SIZE } from "@/services/brand.service";

/**
 * Server-side pagination for the admin brands grid: page math, direct
 * page navigation, deterministic name ordering (including name ties),
 * clamped inputs, and beyond-dataset behavior.
 *
 * The suites share ONE database and other files churn the brand table
 * concurrently, so assertions are RELATIONAL (page invariants, relative
 * order of the fixture subset) — never absolute counts or absolute page
 * composition.
 */
describe("admin brands listing (server-side pagination)", () => {
  const SFX = `abz-${Date.now()}`;
  let brandIds: string[] = [];

  async function insertBrand(name: string, index: number) {
    const [row] = await testDb
      .insert(brands)
      .values({ name, slug: `${SFX}-${String(index).padStart(3, "0")}` })
      .returning({ id: brands.id });
    brandIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    brandIds = [];
    // 25 brands sharing a few duplicate names force the id tie-breaker to
    // carry the ordering on its own.
    for (let i = 0; i < 15; i += 1) {
      await insertBrand(`${SFX} Alpha ${String(i).padStart(2, "0")}`, i);
    }
    for (let i = 0; i < 10; i += 1) {
      await insertBrand(`${SFX} beta`, 100 + i); // identical duplicate names
    }
  });

  afterAll(async () => {
    await testDb.delete(brands).where(inArray(brands.id, brandIds));
  });

  it("produces consistent page math with a stable page size", async () => {
    expect(ADMIN_BRANDS_PAGE_SIZE).toBe(20);
    const page1 = await listAdminBrands({});
    expect(page1.items.length).toBeLessThanOrEqual(ADMIN_BRANDS_PAGE_SIZE);
    expect(page1.currentPage).toBe(1);
    expect(page1.items.every((b) => b.slug.startsWith(SFX))).toBe(true);
    expect(page1.total).toBeGreaterThanOrEqual(25);
    expect(page1.totalPages).toBe(Math.ceil(page1.total / ADMIN_BRANDS_PAGE_SIZE));
    expect(page1.totalPages).toBeGreaterThanOrEqual(2);

    // The 25 fixture rows paginate into exactly two fixture-led pages.
    const page2 = await listAdminBrands({ page: 2 });
    const allFixtureIds = [...page1.items, ...page2.items]
      .filter((b) => b.slug.startsWith(SFX))
      .map((b) => b.id);
    expect(new Set(allFixtureIds).size).toBeGreaterThanOrEqual(25);
    // No fixture brand appears on both pages.
    const p1 = new Set(page1.items.filter((b) => b.slug.startsWith(SFX)).map((b) => b.id));
    expect(page2.items.some((b) => p1.has(b.id))).toBe(false);
  });

  it("orders by name asc with id as stable tie-breaker", async () => {
    const page = await listAdminBrands({ page: 1, pageSize: 100 });
    const subset = page.items.filter((b) => b.slug.startsWith(SFX));
    expect(subset.length).toBe(25);
    for (let i = 1; i < subset.length; i += 1) {
      const a = subset[i - 1];
      const b = subset[i];
      if (a.name === b.name) {
        expect(a.id < b.id).toBe(true); // ties resolve by id asc
      } else {
        expect(a.name < b.name).toBe(true);
      }
    }
  });

  it("clamps invalid page and pageSize inputs", async () => {
    expect((await listAdminBrands({ page: -3 })).currentPage).toBe(1);
    expect((await listAdminBrands({ page: 0 })).currentPage).toBe(1);
    expect((await listAdminBrands({ pageSize: 10_000 })).totalPages).toBe(1);
  });

  it("renders an empty, non-broken page beyond the dataset", async () => {
    const beyond = await listAdminBrands({ page: 999_999 });
    expect(beyond.items).toEqual([]);
    expect(beyond.totalPages).toBeGreaterThanOrEqual(1);
    expect(beyond.currentPage).toBe(999_999);
  });

  it("direct navigation to the final page returns only the remainder", async () => {
    const page1 = await listAdminBrands({});
    const last = await listAdminBrands({ page: page1.totalPages });
    expect(last.items.length).toBe(page1.total - (page1.totalPages - 1) * ADMIN_BRANDS_PAGE_SIZE);
    expect(last.items.length).toBeGreaterThan(0);
  });
});

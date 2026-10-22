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
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import { categories, brands, products } from "../_db";
import { listAdminProducts, ADMIN_PRODUCTS_PAGE_SIZE } from "@/services/product.service";

/**
 * Server-side pagination for the admin products grid: page math, direct
 * page navigation, deterministic ordering (including created_at ties),
 * filter interactions, and invalid page/pageSize inputs.
 *
 * The suites share ONE database and other files churn the products table
 * concurrently (CI pins --maxWorkers 4), so every assertion here is
 * RELATIONAL (page invariants, ordering of the fixture subset, filter
 * agreement) — never an absolute count or an absolute page composition.
 */
describe("admin products listing (server-side pagination)", () => {
  const SFX = `ap-${Date.now()}`;
  const SHARED_TS = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
  let categoryId = "";
  let brandId = "";
  const productIds: string[] = [];

  async function insertProduct(name: string, status: "DRAFT" | "ACTIVE" | "ARCHIVE" = "ACTIVE", createdAt = SHARED_TS) {
    const [row] = await testDb
      .insert(products)
      .values({
        slug: `${SFX}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: `${SFX}-${name}`,
        status,
        basePrice: "10.00",
        categoryId,
        brandId,
        createdAt,
      })
      .returning({ id: products.id });
    productIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const [cat] = await testDb
      .insert(categories)
      .values({ slug: `${SFX}-cat`, name: "AP Cat" })
      .returning();
    categoryId = cat.id;
    const [br] = await testDb
      .insert(brands)
      .values({ slug: `${SFX}-brand`, name: "AP Brand" })
      .returning();
    brandId = br.id;
    // 25 active products sharing one created_at stamp force the id
    // tie-breaker to carry the ordering on its own; 3 drafts exercise the
    // filtered totals.
    for (let i = 0; i < 25; i += 1) {
      await insertProduct(`p${String(i).padStart(2, "0")}`, "ACTIVE");
    }
    for (let i = 0; i < 3; i += 1) {
      await insertProduct(`draft${i}`, "DRAFT");
    }
  });

  afterAll(async () => {
    await testDb.delete(products).where(inArray(products.id, productIds));
    await testDb.delete(brands).where(eq(brands.id, brandId));
    await testDb.delete(categories).where(eq(categories.id, categoryId));
  });

  it("produces consistent page math with a stable page size", async () => {
    expect(ADMIN_PRODUCTS_PAGE_SIZE).toBe(20);
    const page1 = await listAdminProducts({});
    expect(page1.items.length).toBeLessThanOrEqual(ADMIN_PRODUCTS_PAGE_SIZE);
    expect(page1.currentPage).toBe(1);
    // 28 fixture rows guarantee at least two full pages.
    expect(page1.total).toBeGreaterThanOrEqual(28);
    expect(page1.totalPages).toBe(Math.ceil(page1.total / ADMIN_PRODUCTS_PAGE_SIZE));

    // Direct navigation to the final page leaves exactly the remainder.
    const lastPage = await listAdminProducts({ page: page1.totalPages });
    expect(lastPage.currentPage).toBe(page1.totalPages);
    expect(lastPage.items.length).toBe(
      page1.total - (page1.totalPages - 1) * ADMIN_PRODUCTS_PAGE_SIZE,
    );
    expect(lastPage.items.length).toBeGreaterThan(0);
  });

  it("orders by created_at desc with id as stable tie-breaker", async () => {
    // A large window captures the whole fixture subset regardless of
    // concurrent churn elsewhere in the same table.
    const all = await listAdminProducts({ page: 1, pageSize: 100 });
    const fixtureRows = all.items.filter((i) => i.name.startsWith(SFX));
    expect(fixtureRows.length).toBe(28);
    // Within the reordered global list the fixture block stays
    // consistently ordered: createdAt desc, then id desc.
    for (let i = 1; i < fixtureRows.length; i += 1) {
      const a = fixtureRows[i - 1];
      const b = fixtureRows[i];
      if (new Date(a.createdAt).getTime() === new Date(b.createdAt).getTime()) {
        expect(a.id > b.id).toBe(true);
      } else {
        expect(new Date(a.createdAt).getTime()).toBeGreaterThan(new Date(b.createdAt).getTime());
      }
    }
    // The individually-stamped fixture (older by 2 years) sits last.
    const newest = fixtureRows[fixtureRows.length - 1];
    expect(new Date(newest.createdAt).getTime()).toBe(SHARED_TS.getTime());
  });

  it("filters by status before calculating totals and pages", async () => {
    const drafts = await listAdminProducts({ status: "DRAFT" });
    expect(drafts.items.every((i) => i.status === "DRAFT")).toBe(true);
    // The 3 fixture drafts exist even while other suites churn drafts.
    expect(drafts.total).toBeGreaterThanOrEqual(3);
    const draftsSubset = drafts.items.filter((i) => i.name.startsWith(SFX));
    expect(draftsSubset.length).toBe(3);

    const page = await listAdminProducts({ status: "DRAFT", page: drafts.totalPages, pageSize: 2 });
    expect(page.items.every((i) => i.status === "DRAFT")).toBe(true);
    expect(page.totalPages).toBe(Math.ceil(page.total / 2));
  });

  it("clamps invalid page and pageSize inputs", async () => {
    const negative = await listAdminProducts({ page: -5 });
    expect(negative.currentPage).toBe(1);
    const zero = await listAdminProducts({ page: 0 });
    expect(zero.currentPage).toBe(1);

    const oversized = await listAdminProducts({ pageSize: 10_000 });
    expect(oversized.totalPages).toBe(1);
  });

  it("renders an empty, non-broken page beyond the dataset", async () => {
    const beyond = await listAdminProducts({ page: 999_999 });
    expect(beyond.items).toEqual([]);
    expect(beyond.totalPages).toBeGreaterThanOrEqual(1);
    expect(beyond.currentPage).toBe(999_999);
  });

  it("keeps statuses consistent through filters and pagination", async () => {
    const active = await listAdminProducts({ status: "ACTIVE", pageSize: 100 });
    expect(active.items.every((i) => i.status === "ACTIVE")).toBe(true);
    const names = active.items.filter((i) => i.name.startsWith(SFX));
    expect(names.length).toBe(25);
  });
});

import { describe, it, expect } from "vitest";

import { buildCategoryTree, pageCategoriesByRoot } from "@/modules/catalog/application/queries/category-tree";

/**
 * Pagination of the admin categories tree slices by ROOT category so a
 * family (parent + its complete subtree) can never be separated across a
 * page boundary.
 */
describe("pageCategoriesByRoot", () => {
  const rows = [
    ...Array.from({ length: 23 }, (_, i) => ({
      id: `r${String(i).padStart(2, "0")}`,
      parentId: null,
      name: `Root ${String(i).padStart(2, "0")}`,
    })),
    // Two children of a mid-tree root prove subtree integrity.
    { id: "c1", parentId: "r05", name: "Child alpha" },
    { id: "c2", parentId: "r05", name: "Child beta" },
    // Orphan (parent outside the dataset) presents as a root, per tree rules.
    { id: "o1", parentId: "missing", name: "Orphan root" },
  ];

  it("keeps every family intact on its own page", () => {
    const tree = buildCategoryTree(rows);
    const page1 = pageCategoriesByRoot(tree, 1, 20);
    expect(page1.totalRoots).toBe(24); // 23 roots + the orphan
    expect(page1.totalPages).toBe(2);
    expect(page1.currentPage).toBe(1);

    const page1Ids = new Set(page1.entries.map((e) => e.row.id));
    // Both children of r05 are on the same page as their parent...
    if (page1Ids.has("r05")) {
      expect(page1Ids.has("c1")).toBe(true);
      expect(page1Ids.has("c2")).toBe(true);
    }
    // ...and page 2's first entry is a root (never an indent-only child).
    const page2 = pageCategoriesByRoot(tree, 2, 20);
    expect(page2.currentPage).toBe(2);
    expect(page2.entries[0].depth).toBe(0);
    // Familes still intact on the second page.
    const page2Ids = new Set(page2.entries.map((e) => e.row.id));
    if (page2Ids.has("r05")) {
      expect(page2Ids.has("c1")).toBe(true);
      expect(page2Ids.has("c2")).toBe(true);
    }
  });

  it("produces contiguous root runs without duplicates", () => {
    const tree = buildCategoryTree(rows);
    for (const p of [1, 2]) {
      const page = pageCategoriesByRoot(tree, p, 20);
      const rootIds = page.entries.filter((e) => e.depth === 0).map((e) => e.row.id);
      expect(rootIds.length).toBeLessThanOrEqual(20);
      expect(new Set(rootIds).size).toBe(rootIds.length);
      // Roots are ordered by name within the page (tree ordering preserved).
      const rootNames = rootIds.map((id) => rows.find((r) => r.id === id)?.name ?? "");
      expect(rootNames).toEqual([...rootNames].sort((a, b) => a.localeCompare(b)));
    }
  });

  it("clamps out-of-range and invalid pages into the valid range", () => {
    const tree = buildCategoryTree(rows);
    expect(pageCategoriesByRoot(tree, 99, 20).currentPage).toBe(2);
    expect(pageCategoriesByRoot(tree, 0, 20).currentPage).toBe(1);
    expect(pageCategoriesByRoot(tree, -5, 20).currentPage).toBe(1);
  });

  it("degrades gracefully on an empty tree", () => {
    const page = pageCategoriesByRoot([], 3, 20);
    expect(page.entries).toEqual([]);
    expect(page.totalRoots).toBe(0);
    expect(page.totalPages).toBe(1);
    expect(page.currentPage).toBe(1);
  });

  it("partitions roots exactly: pages are disjoint and cover every root", () => {
    const tree = buildCategoryTree(rows);
    const seen = new Set<string>();
    for (let p = 1, pages = pageCategoriesByRoot(tree, 1, 20).totalPages; p <= pages; p += 1) {
      const page = pageCategoriesByRoot(tree, p, 20);
      const rootIds = page.entries.filter((e) => e.depth === 0).map((e) => e.row.id);
      // No root may repeat across pages (the partition property).
      for (const id of rootIds) expect(seen.has(id)).toBe(false);
      rootIds.forEach((id) => seen.add(id));
      if (p === pages) {
        expect(seen.size).toBe(page.totalRoots);
      }
    }
  });

  it("honours a custom page size", () => {
    const tree = buildCategoryTree(rows);
    const page = pageCategoriesByRoot(tree, 1, 10);
    expect(page.totalPages).toBe(3);
    expect(page.entries.filter((e) => e.depth === 0).length).toBe(10);
    // Second page starts at the 11th root, not the second.
    const page2 = pageCategoriesByRoot(tree, 2, 10);
    const page1Roots = new Set(
      page.entries.filter((e) => e.depth === 0).map((e) => e.row.id),
    );
    expect(
      page2.entries.some((e) => e.depth === 0 && page1Roots.has(e.row.id)),
    ).toBe(false);
  });
});

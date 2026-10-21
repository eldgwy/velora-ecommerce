import { describe, it, expect } from "vitest";

import { buildCategoryTree } from "@/modules/catalog/application/queries/category-tree";

interface Row {
  id: string;
  parentId: string | null;
  name: string;
}

const row = (id: string, parentId: string | null, name: string): Row => ({ id, parentId, name });

describe("buildCategoryTree", () => {
  it("orders depth-first with name-ascending siblings", () => {
    const ordered = buildCategoryTree([
      row("child-b", "root-a", "Zeta"),
      row("root-c", null, "Cedar"),
      row("root-a", null, "Ash"),
      row("child-a", "root-a", "Birch"),
    ]);

    expect(ordered.map((e) => e.row.id)).toEqual(["root-a", "child-a", "child-b", "root-c"]);
    expect(ordered.map((e) => e.depth)).toEqual([0, 1, 1, 0]);
  });

  it("promotes orphans (missing parent) to roots instead of dropping them", () => {
    const ordered = buildCategoryTree([
      row("orphan", "missing-parent", "Ghost"),
      row("root", null, "Real"),
    ]);

    // Both present; promoted roots sort by name too ("Ghost" < "Real").
    expect(ordered.map((e) => e.row.id)).toEqual(["orphan", "root"]);
    expect(ordered[0]!.depth).toBe(0);
    expect(ordered[1]!.depth).toBe(0);
  });

  it("handles empty and cycle inputs", () => {
    expect(buildCategoryTree([])).toEqual([]);

    // A cycle (a ↔ b) cannot anchor to any root: pure-sorted fallback keeps
    // both visible rather than looping forever.
    const ordered = buildCategoryTree([
      row("a", "b", "A"),
      row("b", "a", "B"),
    ]);
    expect(ordered.map((e) => e.row.id)).toEqual(["a", "b"]);
    expect(ordered.map((e) => e.depth)).toEqual([0, 0]);
  });

  it("is deterministic across shuffled inputs", () => {
    const rows = [
      row("r1", null, "Wax"),
      row("c1", "r1", "Nitro"),
      row("c2", "r1", "Mica"),
      row("r2", null, "Alder"),
    ];
    const forward = buildCategoryTree(rows).map((e) => e.row.id);
    const reversed = buildCategoryTree([...rows].reverse()).map((e) => e.row.id);
    expect(forward).toEqual(["r2", "r1", "c2", "c1"]);
    expect(reversed).toEqual(forward);
  });
});

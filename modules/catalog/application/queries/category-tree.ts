/**
 * Deterministic hierarchy ordering for the admin categories list.
 *
 * Pure function (no framework or DB imports): builds a depth-first
 * presentation order — roots ordered by name, children after their parent,
 * siblings ordered by name, orphans (parent missing from the set) treated as
 * roots so no row can vanish from the listing.
 */
export interface CategoryLike {
  id: string;
  parentId: string | null;
  name: string;
}

export interface CategoryTreeEntry<T extends CategoryLike> {
  row: T;
  /** 0 for roots, 1 for direct children, … drives indentation only. */
  depth: number;
}

export function buildCategoryTree<T extends CategoryLike>(
  rows: T[],
): Array<CategoryTreeEntry<T>> {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);

  const children = new Map<string, T[]>();
  const roots: T[] = [];
  const known = new Set(rows.map((r) => r.id));

  for (const row of rows) {
    if (row.parentId && known.has(row.parentId)) {
      const bucket = children.get(row.parentId) ?? [];
      bucket.push(row);
      children.set(row.parentId, bucket);
    } else {
      // No parent, or the parent is not part of this dataset (orphan) —
      // either way it presents as a root; it cannot disappear from the list.
      roots.push(row);
    }
  }

  for (const bucket of children.values()) bucket.sort(byName);
  roots.sort(byName);

  const ordered: Array<CategoryTreeEntry<T>> = [];
  const emitted = new Set<string>();
  const visit = (row: T, depth: number) => {
    if (emitted.has(row.id)) {
      // Defensive: a corrupted hierarchy (cycle in the data) must not loop.
      return;
    }
    emitted.add(row.id);
    ordered.push({ row, depth });
    for (const child of children.get(row.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);

  // Anything never reached (members of a data cycle) is appended deterministically
  // so no category can silently vanish from the listing.
  const unemitted = rows.filter((r) => !emitted.has(r.id)).sort(byName);
  for (const row of unemitted) ordered.push({ row, depth: 0 });

  return ordered;
}

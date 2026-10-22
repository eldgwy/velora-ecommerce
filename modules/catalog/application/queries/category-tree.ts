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

export interface CategoryPageResult<T extends CategoryLike> {
  entries: Array<CategoryTreeEntry<T>>;
  /** Number of root categories across the whole tree. */
  totalRoots: number;
  currentPage: number;
  totalPages: number;
}

/**
 * Pagination for the admin categories tree, sliced by ROOT category so a
 * family can never split across a page boundary: page N is a contiguous
 * run of `rootsPerPage` roots, each rendered together with its complete
 * subtree. Categories are a bounded navigation structure (not event
 * data), so building the full tree once and slicing roots is by design —
 * orphans and cycle members must stay visible no matter which page is
 * requested. Out-of-range pages clamp into the valid range.
 */
export function pageCategoriesByRoot<T extends CategoryLike>(
  entries: Array<CategoryTreeEntry<T>>,
  rawPage: number,
  rootsPerPage = 20,
): CategoryPageResult<T> {
  const perPage = Math.min(Math.max(1, Math.floor(rootsPerPage)), 100);
  const totalRoots = entries.filter((e) => e.depth === 0).length;
  const totalPages = Math.max(1, Math.ceil(totalRoots / perPage));
  const currentPage = Math.min(Math.max(1, Math.floor(rawPage)), totalPages);

  const pageIndexes: number[] = [];
  for (const [index, entry] of entries.entries()) {
    if (entry.depth === 0) pageIndexes.push(index);
  }

  const chunkIndex = Math.min(currentPage - 1, pageIndexes.length - 1);
  const start = pageIndexes[Math.max(0, chunkIndex * perPage)] ?? entries.length;
  const end = pageIndexes[(chunkIndex + 1) * perPage] ?? entries.length;

  return {
    entries: entries.slice(start, end),
    totalRoots,
    currentPage: Math.min(currentPage, totalPages),
    totalPages,
  };
}

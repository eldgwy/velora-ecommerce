import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import { categories } from "@/infrastructure/database/schema/catalog";
import { logger } from "@/shared/lib/logging/logger";

export type CategoryRow = typeof categories.$inferSelect;
export type CategoryInsertData = Omit<typeof categories.$inferInsert, "createdAt" | "updatedAt">;
export type CategoryPatch = Partial<Omit<CategoryInsertData, "id">>;

// ============================================
// Parent Validation
// ============================================

/**
 * Validate that a parent category exists (if non-null).
 * Returns the parent category row if valid, null if parentId is null,
 * throws if parentId is non-null but parent doesn't exist.
 */
export async function validateParentCategory(
  parentId: string | null | undefined,
): Promise<CategoryRow | null> {
  if (parentId === null || parentId === undefined) return null;
  const parent = await getCategoryById(parentId);
  if (!parent) {
    throw new Error("Parent category not found");
  }
  return parent;
}

// ============================================
// Cycle Detection
// ============================================

/**
 * Check whether setting `categories.parentId = parentId` would create a
 * cycle in the hierarchy. Returns `true` if a cycle would form.
 *
 * Walks the ancestor chain from `parentId` up to the root. If `categoryId`
 * appears in that chain, a cycle exists.
 *
 * Also rejects the trivial self-parent case (`parentId === categoryId`).
 */
export async function wouldCreateCycle(
  categoryId: string,
  parentId: string | null,
): Promise<boolean> {
  if (parentId === null) return false;
  if (parentId === categoryId) return true;

  // Walk up from parentId; if we ever reach categoryId, it's a cycle.
  let current: string | null = parentId;
  const visited = new Set<string>();
  let iterations = 0;
  const MAX_DEPTH = 1000; // safety valve

  while (current !== null && iterations < MAX_DEPTH) {
    if (current === categoryId) return true;
    if (visited.has(current)) return true; // already seen — shouldn't happen but safe
    visited.add(current);

    const [row] = await db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, current));

    if (!row) return false; // parent doesn't exist — caller should validate separately
    current = row.parentId;
    iterations++;
  }

  return false; // reached root or safety limit without cycle
}

// ============================================
// Effective Visibility
// ============================================

/**
 * Returns the set of category IDs that are effectively visible to the
 * storefront. A category is visible only when:
 *   - its own `isActive` is true
 *   - AND every ancestor (up to root) is also `isActive = true`
 *
 * Uses a recursive CTE to compute the effective visibility in a single
 * query, avoiding N+1 patterns.
 */
export async function getEffectiveVisibleCategoryIds(): Promise<string[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE
      active_chain AS (
        SELECT c.id, c.parent_id, c.is_active
        FROM categories c
        WHERE c.parent_id IS NULL AND c.is_active = true

        UNION ALL

        SELECT c.id, c.parent_id, c.is_active
        FROM categories c
        INNER JOIN active_chain ac ON c.parent_id = ac.id
        WHERE c.is_active = true
      )
    SELECT id FROM active_chain
  `) as unknown as { rows: Array<{ id: string }> };

  return result.rows.map((row) => row.id);
}

/**
 * Check if a specific category is effectively visible (all ancestors active).
 */
export async function isCategoryEffectiveVisible(
  categoryId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    WITH RECURSIVE
      ancestors AS (
        SELECT c.id, c.parent_id, c.is_active
        FROM categories c
        WHERE c.id = ${categoryId}

        UNION ALL

        SELECT p.id, p.parent_id, p.is_active
        FROM categories p
        INNER JOIN ancestors a ON p.id = a.parent_id
      )
    SELECT (bool_and(is_active)) AS exists
    FROM ancestors
  `) as unknown as { rows: Array<{ exists: boolean }> };

  return result.rows[0]?.exists ?? false;
}

// ============================================
// CRUD
// ============================================

export async function listCategories(opts: {
  effectiveVisibleOnly?: boolean;
} = {}): Promise<CategoryRow[]> {
  if (opts.effectiveVisibleOnly) {
    const visibleIds = await getEffectiveVisibleCategoryIds();
    if (visibleIds.length === 0) return [];
    return db
      .select()
      .from(categories)
      .where(sql`${categories.id} = ANY(${visibleIds})`);
  }

  return db.select().from(categories);
}

export async function getCategoryById(
  id: string,
): Promise<CategoryRow | null> {
  const [row] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id));
  return row ?? null;
}

export async function getCategoryBySlug(
  slug: string,
): Promise<CategoryRow | null> {
  const [row] = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, slug));
  return row ?? null;
}

export async function createCategory(
  data: CategoryInsertData,
  userId?: string,
  requestId?: string,
): Promise<CategoryRow> {
  const [created] = await db.insert(categories).values(data).returning();
  logger.catalog.categoryCreated(created.id, userId ?? "unknown", requestId);
  return created!;
}

export async function updateCategory(
  id: string,
  patch: CategoryPatch,
  userId?: string,
  requestId?: string,
): Promise<CategoryRow | null> {
  const [updated] = await db
    .update(categories)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();

  if (updated) {
    const changes = Object.keys(patch);
    logger.catalog.categoryUpdated(id, changes, userId ?? "unknown", requestId);

    if ("isActive" in patch) {
      logger.catalog.categoryActivated(id, patch.isActive as boolean, userId ?? "unknown", requestId);
    }
    if ("parentId" in patch) {
      const oldCategory = await getCategoryById(id);
      logger.catalog.categoryParentChanged(
        id,
        oldCategory?.parentId ?? null,
        patch.parentId ?? null,
        userId ?? "unknown",
        requestId,
      );
    }
  }

  return updated ?? null;
}

export async function deactivateCategory(
  id: string,
  userId?: string,
  requestId?: string,
): Promise<CategoryRow | null> {
  const [updated] = await db
    .update(categories)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();

  if (updated) {
    logger.catalog.categoryActivated(id, false, userId ?? "unknown", requestId);
  }
  return updated ?? null;
}

export async function activateCategory(
  id: string,
  userId?: string,
  requestId?: string,
): Promise<CategoryRow | null> {
  const [updated] = await db
    .update(categories)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();

  if (updated) {
    logger.catalog.categoryActivated(id, true, userId ?? "unknown", requestId);
  }
  return updated ?? null;
}
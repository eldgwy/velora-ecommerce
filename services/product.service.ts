import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import {
  products,
} from "@/infrastructure/database/schema/catalog";
import {
  getEffectiveVisibleCategoryIds,
} from "@/services/catalog.service";
import { logger } from "@/shared/lib/logging/logger";

// ============================================
// Types
// ============================================

export type ProductRow = typeof products.$inferSelect;
export type ProductInsertData = Omit<typeof products.$inferInsert, "createdAt" | "updatedAt">;
export type ProductPatch = Partial<Omit<ProductInsertData, "id">>;
export type ProductQueryResult = Promise<ProductRow[]>;

// ============================================
// Effective Visibility
// ============================================

/**
 * Get IDs of products that are effectively visible to the storefront.
 * A product is visible when:
 *   - status = 'ACTIVE'
 *   - AND its category is in the effective-visible set (all ancestors active)
 */
export async function getEffectiveVisibleProductIds(): Promise<string[]> {
  const visibleCategoryIds = await getEffectiveVisibleCategoryIds();

  if (visibleCategoryIds.length === 0) return [];

  const result = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.status, "ACTIVE"),
        inArray(products.categoryId, visibleCategoryIds),
      ),
    );

  return result.map((row) => row.id);
}

/**
 * Check if a specific product is effectively visible.
 */
export async function isProductEffectiveVisible(
  productId: string,
): Promise<boolean> {
const result = await db.execute(sql`
    WITH RECURSIVE
      category_chain AS (
        SELECT p.id AS product_id, c.id AS category_id, c.parent_id, c.is_active
        FROM products p
        INNER JOIN categories c ON p.category_id = c.id
        WHERE p.id = ${productId}

        UNION ALL

        SELECT cc.product_id, p.id AS category_id, p.parent_id, p.is_active
        FROM category_chain cc
        INNER JOIN categories p ON p.id = cc.parent_id
      )
    SELECT
      (bool_and(is_active) AND
       (SELECT status = 'ACTIVE' FROM products WHERE id = ${productId})) AS visible
    FROM category_chain
  `) as unknown as { rows: Array<{ visible: boolean }> };

  return result.rows[0]?.visible ?? false;
}

// ============================================
// CRUD
// ============================================

export async function listProducts(opts: {
  status?: "DRAFT" | "ACTIVE" | "ARCHIVE";
  categoryId?: string;
  brandId?: string;
  effectiveVisibleOnly?: boolean;
} = {}): Promise<ProductRow[]> {
  const conditions = [];

  if (opts.status) {
    conditions.push(eq(products.status, opts.status));
  }
  if (opts.categoryId) {
    conditions.push(eq(products.categoryId, opts.categoryId));
  }
  if (opts.brandId) {
    conditions.push(eq(products.brandId, opts.brandId));
  }

  if (opts.effectiveVisibleOnly) {
    const visibleIds = await getEffectiveVisibleProductIds();
    if (visibleIds.length === 0) return [];
    conditions.push(inArray(products.id, visibleIds));
    // Also ensure status is ACTIVE (already implied by visibleIds but explicit for safety)
    conditions.push(eq(products.status, "ACTIVE"));
  }

  if (conditions.length > 0) {
    return await db.select().from(products).where(and(...conditions));
  }

  return await db.select().from(products);
}

export async function getProductById(
  id: string,
): Promise<ProductRow | null> {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, id));
  return row ?? null;
}

export async function createProduct(
  data: ProductInsertData,
  userId?: string,
  requestId?: string,
): Promise<ProductRow> {
  const [created] = await db.insert(products).values(data).returning();
  logger.catalog.productCreated(created.id, userId ?? "unknown", requestId);
  return created!;
}

export async function updateProduct(
  id: string,
  patch: ProductPatch,
  userId?: string,
  requestId?: string,
): Promise<ProductRow | null> {
  const [updated] = await db
    .update(products)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();

  if (updated) {
    const changes = Object.keys(patch);
    logger.catalog.productUpdated(id, changes, userId ?? "unknown", requestId);

    if ("status" in patch) {
      const oldProduct = await getProductById(id);
      logger.catalog.productStatusChanged(
        id,
        oldProduct?.status ?? "unknown",
        patch.status as string,
        userId ?? "unknown",
        requestId,
      );
    }
  }
  return updated ?? null;
}

export async function deleteProduct(
  id: string,
  userId?: string,
  requestId?: string,
): Promise<boolean> {
  const result = await db.delete(products).where(eq(products.id, id)).returning();
  if (result.length > 0) {
    logger.catalog.productDeleted(id, userId ?? "unknown", requestId);
  }
  return result.length > 0;
}
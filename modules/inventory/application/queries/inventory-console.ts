import { and, asc, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { inventory } from "@/infrastructure/database/schema/inventory";
import { products, productVariants } from "@/infrastructure/database/schema/catalog";
import { escapeILike } from "@/shared/lib/like-patterns";

export const INVENTORY_PAGE_SIZE = 25;

export interface InventoryConsoleFilters {
  q: string;
  alertLow: boolean;
  page: number;
  /** Variant ids currently flagged low (from findCurrentlyLowStockVariants). */
  lowVariantIds: string[];
}

export interface InventoryConsoleList {
  /** Total stock records matching the filters (for pagination). */
  total: number;
  rows: Array<{
    variantId: string;
    sku: string | null;
    description: string | null;
    productId: string;
    productName: string;
    quantity: number;
    reservedQuantity: number;
    lowStockThreshold: number | null;
  }>;
  /** Variant rows for the low-stock alert strip (single batched read). */
  lowNames: Map<string, { id: string; sku: string | null; description: string | null; productId: string; productName: string }>;
}

/**
 * Inventory console list read (T-2.2). Lives in the application layer, not in
 * the page component — pages never import the database pool directly. Reads
 * are batched (single join query + a count aggregate + one alert-strip read);
 * search is escaped before ILIKE; ordering is deterministic.
 */
export async function getInventoryConsoleList(
  filters: InventoryConsoleFilters,
): Promise<InventoryConsoleList> {
  const conditions = [];
  if (filters.q.length > 0) {
    const pattern = `%${escapeILike(filters.q)}%`;
    conditions.push(
      or(
        ilike(productVariants.sku, pattern),
        ilike(productVariants.description, pattern),
        ilike(products.name, pattern),
      ),
    );
  }
  if (filters.alertLow) {
    // Only rows whose (quantity - reserved) sits below their threshold.
    conditions.push(
      sql`${inventory.lowStockThreshold} IS NOT NULL AND (${inventory.quantity} - ${inventory.reservedQuantity}) < ${inventory.lowStockThreshold}`,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRows, listRows, lowNames] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(inventory)
      .innerJoin(productVariants, sql`${productVariants.id} = ${inventory.variantId}`)
      .innerJoin(products, sql`${products.id} = ${productVariants.productId}`)
      .where(where),
    db
      .select({
        variantId: productVariants.id,
        sku: productVariants.sku,
        description: productVariants.description,
        productId: products.id,
        productName: products.name,
        quantity: inventory.quantity,
        reservedQuantity: inventory.reservedQuantity,
        lowStockThreshold: inventory.lowStockThreshold,
      })
      .from(inventory)
      .innerJoin(productVariants, sql`${productVariants.id} = ${inventory.variantId}`)
      .innerJoin(products, sql`${products.id} = ${productVariants.productId}`)
      .where(where)
      // Rows with no threshold are excluded; order is deterministic (name, then sku).
      .orderBy(asc(products.name), asc(productVariants.sku))
      .limit(INVENTORY_PAGE_SIZE)
      .offset((filters.page - 1) * INVENTORY_PAGE_SIZE),
    getLowStockVariantNames(filters.lowVariantIds),
  ]);

  return {
    total: countRows[0]?.count ?? 0,
    rows: listRows,
    lowNames,
  };
}

/** Names for the currently-low variants (single batched read). */
async function getLowStockVariantNames(
  variantIds: string[],
): Promise<Map<string, { id: string; sku: string | null; description: string | null; productId: string; productName: string }>> {
  if (variantIds.length === 0) return new Map();
  const lowRows = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      description: productVariants.description,
      productId: products.id,
      productName: products.name,
    })
    .from(productVariants)
    .innerJoin(products, sql`${products.id} = ${productVariants.productId}`)
    .where(inArray(productVariants.id, variantIds));
  return new Map(lowRows.map((r) => [r.id, r]));
}

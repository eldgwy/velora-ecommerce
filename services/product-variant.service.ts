import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import {
  productVariants,
  productOptions,
  productOptionValues,
  variantOptionValues,
} from "@/infrastructure/database/schema/catalog";
import { inventory, inventoryMovements } from "@/infrastructure/database/schema/inventory";
import { inventoryMovementTypeEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";

export type VariantRow = typeof productVariants.$inferSelect;
export type VariantInsertData = Omit<typeof productVariants.$inferInsert, "createdAt" | "updatedAt">;
export type VariantPatch = Partial<Omit<VariantInsertData, "id">>;
export type InventoryRow = typeof inventory.$inferSelect;

// ============================================
// Effective Pricing
// ============================================

/**
 * Resolve the effective price for a variant.
 * If priceOverride is set and > 0, use it; otherwise fall back to product.basePrice.
 */
export function resolveVariantPrice(
  variant: { priceOverride: string | null },
  productBasePrice: string,
): string {
  if (variant.priceOverride) {
    const override = Number(variant.priceOverride);
    if (override > 0) return variant.priceOverride;
  }
  return productBasePrice;
}

// ============================================
// Variant CRUD
// ============================================

export async function listVariantsByProduct(
  productId: string,
): Promise<VariantRow[]> {
  return db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId));
}

export async function getVariantById(
  id: string,
): Promise<VariantRow | null> {
  const [row] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, id));
  return row ?? null;
}

export async function createVariant(
  data: VariantInsertData,
  userId?: string,
  requestId?: string,
): Promise<VariantRow> {
  const [created] = await db
    .insert(productVariants)
    .values(data)
    .returning();
  logger.catalog.variantCreated(created.id, data.productId, userId ?? "unknown", requestId);
  return created!;
}

export async function updateVariant(
  id: string,
  patch: VariantPatch,
  userId?: string,
  requestId?: string,
): Promise<VariantRow | null> {
  const [updated] = await db
    .update(productVariants)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(productVariants.id, id))
    .returning();

  if (updated) {
    const changes = Object.keys(patch);
    logger.catalog.variantUpdated(id, changes, userId ?? "unknown", requestId);
  }
  return updated ?? null;
}

// ============================================
// Atomic Variant + Inventory Creation
// ============================================

/**
 * Create a variant AND its initial inventory record atomically.
 * If inventory creation fails, the variant is rolled back.
 * Also creates an initial inventory movement record (RESTOCK) for audit trail.
 */
export async function createVariantWithInventory(
  variantData: VariantInsertData,
  inventoryData: Omit<typeof inventory.$inferInsert, "variantId" | "createdAt" | "updatedAt">,
  userId?: string,
  requestId?: string,
): Promise<{ variant: VariantRow; inventory: InventoryRow }> {
  return db.transaction(async (tx) => {
    // 1. Create the variant
    const [variant] = await tx
      .insert(productVariants)
      .values(variantData)
      .returning();
    if (!variant) throw new Error("Failed to create variant");

    // 2. Create the inventory record
    const [inv] = await tx
      .insert(inventory)
      .values({
        variantId: variant.id,
        quantity: inventoryData.quantity ?? 0,
        reservedQuantity: inventoryData.reservedQuantity ?? 0,
        lowStockThreshold: inventoryData.lowStockThreshold,
        location: inventoryData.location,
      })
      .returning();
    if (!inv) throw new Error("Failed to create inventory");

    // 3. Create initial inventory movement record for audit trail
    // Even if quantity is 0, we record the initialization
    await tx.insert(inventoryMovements).values({
      inventoryId: inv.id,
      quantity: inventoryData.quantity ?? 0,
      type: "RESTOCK" as typeof inventoryMovementTypeEnum.enumValues[number],
      reason: "Initial variant creation",
      notes: `Variant ${variant.sku ?? variant.id} created with initial inventory`,
    });

    logger.catalog.variantCreated(variant.id, variant.productId, userId ?? "unknown", requestId);
    logger.catalog.inventoryMovementCreated(inv.id, "RESTOCK", inventoryData.quantity ?? 0, userId ?? "unknown", requestId);

    return { variant, inventory: inv };
  });
}

// ============================================
// Variant Option Value Assignment
// ============================================

/**
 * Assign option values to a variant.
 * Validates that all option values belong to the same product.
 */
export async function setVariantOptionValues(
  variantId: string,
  optionValueIds: string[],
  expectedProductId: string,
): Promise<void> {
  if (optionValueIds.length === 0) return;

  // Verify all option values belong to the expected product
  const values = await db
    .select({
      id: productOptionValues.id,
      optionId: productOptionValues.optionId,
      productId: productOptions.productId,
    })
    .from(productOptionValues)
    .innerJoin(
      productOptions,
      eq(productOptionValues.optionId, productOptions.id),
    )
    .where(inArray(productOptionValues.id, optionValueIds));

  if (values.length !== optionValueIds.length) {
    throw new Error("One or more option values do not exist");
  }

  for (const v of values) {
    if (v.productId !== expectedProductId) {
      throw new Error(
        "Option value does not belong to the expected product",
      );
    }
  }

  // Delete existing assignments
  await db
    .delete(variantOptionValues)
    .where(eq(variantOptionValues.variantId, variantId));

  // Insert new assignments
  await db.insert(variantOptionValues).values(
    optionValueIds.map((ovId) => ({
      variantId,
      optionValueId: ovId,
    })),
  );
};

// ============================================
// Duplicate Combination Detection
// ============================================

/**
 * Check if a variant combination already exists for the product.
 * Uses a normalized (sorted) comparison to handle order-independent duplicates.
 * Optimized with a single query using array_agg.
 */
export async function combinationExists(
  productId: string,
  optionValueIds: string[],
  excludeVariantId?: string,
): Promise<boolean> {
  if (optionValueIds.length === 0) return false;

  // Normalize: sort the IDs for order-independent comparison
  const sortedIds = [...optionValueIds].sort();
  const sortedIdsStr = sortedIds.join(",");

  // Single query: find variants with matching option value combinations
  // Uses array_agg with ORDER BY to create a canonical sorted array for comparison
  const result = await db.execute(sql`
    SELECT vov.variant_id
    FROM ${variantOptionValues} vov
    INNER JOIN ${productVariants} pv ON pv.id = vov.variant_id
    WHERE pv.product_id = ${productId}
    ${excludeVariantId ? sql`AND pv.id != ${excludeVariantId}` : sql``}
    GROUP BY vov.variant_id
    HAVING array_agg(vov.option_value_id ORDER BY vov.option_value_id) = ${sortedIdsStr}::uuid[]
  `);

  return (result.length ?? 0) > 0;
}
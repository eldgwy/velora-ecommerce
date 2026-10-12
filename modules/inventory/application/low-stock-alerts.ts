import { and, eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { lowStockAlerts } from "@/infrastructure/database/schema";
import { lowStockAlertStatusEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";

export type LowStockAlertStatus = (typeof lowStockAlertStatusEnum.enumValues)[number];

export interface LowStockAlertEvent {
  id: string;
  inventoryId: string;
  variantId: string;
  availableStock: number;
  threshold: number;
  status: LowStockAlertStatus;
  attempts: number;
  createdAt: Date;
}

export interface CheckLowStockResult {
  alertCreated: boolean;
  alertId?: string;
  variantId: string;
  availableStock: number;
  threshold: number;
}

/**
 * Check if inventory is in a low-stock condition and create an alert if needed.
 * 
 * A low-stock condition exists when:
 *   AvailableStock = quantity - reservedQuantity < lowStockThreshold
 * 
 * This function is idempotent - it will not create duplicate alerts for the same
 * variant while a PENDING or PROCESSING alert exists.
 * 
 * Must be called within a transaction that has already locked the inventory row.
 */
export async function checkAndCreateLowStockAlert(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  variantId: string,
  options: { actorId?: string; requestId?: string } = {},
): Promise<CheckLowStockResult> {
  // Get current inventory state
  const rows = await tx.execute(sql`
    SELECT i.id, i.quantity, i.reserved_quantity AS "reservedQuantity", i.low_stock_threshold AS "lowStockThreshold", i.variant_id AS "variantId"
    FROM inventory AS i
    WHERE i.variant_id = ${variantId}
  `) as Array<{
    id: string;
    variantId: string;
    quantity: number;
    reservedQuantity: number;
    lowStockThreshold: number | null;
  }>;

  const inv = rows[0];
  if (!inv) {
    return {
      alertCreated: false,
      variantId,
      availableStock: 0,
      threshold: 0,
    };
  }

  const availableStock = inv.quantity - inv.reservedQuantity;
  const threshold = inv.lowStockThreshold ?? 0;

  // No threshold set or stock above threshold - no alert needed
  if (threshold <= 0 || availableStock >= threshold) {
    // If there was a previous alert, it will be resolved by the recovery job
    return {
      alertCreated: false,
      variantId,
      availableStock,
      threshold,
    };
  }

  // Check if there's already a pending or processing alert for this variant
  const [existingAlert] = await tx
    .select({
      id: lowStockAlerts.id,
      status: lowStockAlerts.status,
    })
    .from(lowStockAlerts)
    .where(
      and(
        eq(lowStockAlerts.variantId, variantId),
        sql`${lowStockAlerts.status} IN ('PENDING', 'PROCESSING')`,
      ),
    );

  if (existingAlert) {
    // Alert already exists, don't create duplicate
    return {
      alertCreated: false,
      alertId: existingAlert.id,
      variantId,
      availableStock,
      threshold,
    };
  }

  // Create new low-stock alert
  const [alert] = await tx
    .insert(lowStockAlerts)
    .values({
      inventoryId: inv.id,
      variantId,
      availableStock,
      threshold,
      status: "PENDING",
      attempts: 0,
    })
    .returning({ id: lowStockAlerts.id });

  logger.warn("Low stock alert created", {
    module: "inventory",
    action: "lowStockAlertCreated",
    alertId: alert.id,
    inventoryId: inv.id,
    variantId,
    availableStock,
    threshold,
    actorId: options.actorId ?? "system",
    requestId: options.requestId,
  });

  return {
    alertCreated: true,
    alertId: alert.id,
    variantId,
    availableStock,
    threshold,
  };
}

/**
 * Check if a previously low-stock variant has recovered (stock went back above threshold).
 * If so, mark any pending/processing alerts as DELIVERED (resolved).
 * 
 * Must be called within a transaction that has already locked the inventory row.
 */
export async function checkAndResolveLowStockAlert(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  variantId: string,
  options: { actorId?: string; requestId?: string } = {},
): Promise<{ resolved: boolean; alertId?: string }> {
  const rows = await tx.execute(sql`
    SELECT i.id, i.quantity, i.reserved_quantity AS "reservedQuantity", i.low_stock_threshold AS "lowStockThreshold", i.variant_id AS "variantId"
    FROM inventory AS i
    WHERE i.variant_id = ${variantId}
  `) as Array<{
    id: string;
    variantId: string;
    quantity: number;
    reservedQuantity: number;
    lowStockThreshold: number | null;
  }>;

  const inv = rows[0];
  if (!inv) {
    return { resolved: false };
  }

  const availableStock = inv.quantity - inv.reservedQuantity;
  const threshold = inv.lowStockThreshold ?? 0;

  // Stock recovered above threshold
  if (threshold > 0 && availableStock >= threshold) {
    // Find and resolve pending/processing alerts
    const [alert] = await tx
      .select({ id: lowStockAlerts.id })
      .from(lowStockAlerts)
      .where(
        and(
          eq(lowStockAlerts.variantId, variantId),
          sql`${lowStockAlerts.status} IN ('PENDING', 'PROCESSING')`,
        ),
      );

    if (alert) {
      await tx
        .update(lowStockAlerts)
        .set({
          status: "DELIVERED",
          deliveredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(lowStockAlerts.id, alert.id));

      logger.info("Low stock alert resolved (stock recovered)", {
        module: "inventory",
        action: "lowStockAlertResolved",
        alertId: alert.id,
        inventoryId: inv.id,
        variantId,
        availableStock,
        threshold,
        actorId: options.actorId ?? "system",
        requestId: options.requestId,
      });

      return { resolved: true, alertId: alert.id };
    }
  }

  return { resolved: false };
}

/**
 * Get a pending alert for delivery.
 * Updates status to PROCESSING and increments attempts.
 */
export async function getNextPendingAlert(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<LowStockAlertEvent | null> {
  const result = await tx.execute(sql`
    UPDATE ${lowStockAlerts}
    SET status = 'PROCESSING', attempts = attempts + 1, last_attempt_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id FROM ${lowStockAlerts}
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, inventory_id AS "inventoryId", variant_id AS "variantId", available_stock AS "availableStock", threshold, status, attempts, created_at AS "createdAt"
  `) as Array<Record<string, unknown>>;

  if (!result || result.length === 0) return null;

  const row = result[0];
  return {
    id: row.id as string,
    inventoryId: row.inventoryId as string,
    variantId: row.variantId as string,
    availableStock: row.availableStock as number,
    threshold: row.threshold as number,
    status: row.status as LowStockAlertStatus,
    attempts: row.attempts as number,
    createdAt: row.createdAt as Date,
  };
}

/**
 * Mark an alert as delivered successfully.
 */
export async function markAlertDelivered(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  alertId: string,
): Promise<void> {
  await tx
    .update(lowStockAlerts)
    .set({
      status: "DELIVERED",
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(lowStockAlerts.id, alertId));
}

/**
 * Mark an alert as failed and schedule retry.
 */
export async function markAlertFailed(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  alertId: string,
  errorMessage: string,
): Promise<void> {
  await tx
    .update(lowStockAlerts)
    .set({
      status: "PENDING", // Will be retried
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(lowStockAlerts.id, alertId));
}

/**
 * Get alert statistics for monitoring.
 */
export async function getLowStockAlertStats(): Promise<{
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  total: number;
}> {
  const stats = await db.execute(sql`
    SELECT 
      COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
      COUNT(*) FILTER (WHERE status = 'PROCESSING') AS processing,
      COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
      COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
      COUNT(*) AS total
    FROM ${lowStockAlerts}
  `) as Array<{
    pending: number;
    processing: number;
    delivered: number;
    failed: number;
    total: number;
  }>;

  return stats[0] ?? { pending: 0, processing: 0, delivered: 0, failed: 0, total: 0 };
}

/**
 * Find variants currently in low-stock condition (for monitoring/reporting).
 */
export async function findCurrentlyLowStockVariants(): Promise<Array<{
  variantId: string;
  inventoryId: string;
  quantity: number;
  reservedQuantity: number;
  availableStock: number;
  threshold: number;
}>> {
  const results = await db.execute(sql`
    SELECT i.id AS "inventoryId", i.variant_id AS "variantId", i.quantity, i.reserved_quantity AS "reservedQuantity", 
           i.low_stock_threshold AS "threshold",
           (i.quantity - i.reserved_quantity) AS "availableStock"
    FROM inventory AS i
    WHERE i.low_stock_threshold IS NOT NULL
      AND i.low_stock_threshold > 0
      AND (i.quantity - i.reserved_quantity) < i.low_stock_threshold
    ORDER BY (i.quantity - i.reserved_quantity) ASC
  `) as Array<{
    inventoryId: string;
    variantId: string;
    quantity: number;
    reservedQuantity: number;
    availableStock: number;
    threshold: number;
  }>;

  return results;
}
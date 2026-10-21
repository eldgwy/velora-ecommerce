import { eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { inventory, inventoryMovements } from "@/infrastructure/database/schema/inventory";
import { productVariants } from "@/infrastructure/database/schema/catalog";
import { inventoryMovementTypeEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";
import { checkAndCreateLowStockAlert, checkAndResolveLowStockAlert } from "@/modules/inventory/application/low-stock-alerts";

export type InventoryMovementType = (typeof inventoryMovementTypeEnum.enumValues)[number];

export interface PersistedInventory {
  id: string;
  variantId: string;
  productId: string;
  quantity: number;
  reservedQuantity: number;
  available: number;
  lowStockThreshold: number | null;
  location: string | null;
}

export class VariantNotFoundError extends Error {
  constructor(variantId: string) {
    super(`Variant not found: ${variantId}`);
    this.name = "VariantNotFoundError";
  }
}

export class InventoryNotFoundError extends Error {
  constructor(variantId: string) {
    super(`No inventory record for variant: ${variantId}`);
    this.name = "InventoryNotFoundError";
  }
}

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuantityError";
  }
}

export class InventoryRowGoneError extends Error {
  constructor(inventoryId: string) {
    super(`Inventory row ${inventoryId} vanished mid-transaction`);
    this.name = "InventoryRowGoneError";
  }
}

/**
 * Inventory availability rule used everywhere in the catalog:
 *   available = quantity - reserved_quantity
 * An inventory mutation must never make `available` negative.
 */

interface LockedInventory {
  id: string;
  productId: string;
  quantity: number;
  reservedQuantity: number;
}

/**
 * A transaction client handed to `db.transaction` callbacks (see address.service).
 */
type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lock the inventory row for a variant (within a transaction) and load the
 * product id. Throws a precise error for a missing variant vs. missing inventory.
 * A single query serves the common (inventory-exists) path; the not-found
 * path issues one extra indexed lookup only to classify the error.
 */
async function lockInventory(
  tx: TxClient,
  variantId: string,
): Promise<LockedInventory> {
  const rows = (await tx.execute(sql`
    SELECT i.id, i.quantity, i.reserved_quantity AS "reservedQuantity", v.product_id AS "productId"
    FROM inventory AS i
    JOIN product_variant AS v ON v.id = i.variant_id
    WHERE i.variant_id = ${variantId}
    FOR UPDATE
  `)) as Array<{ id: string; productId: string; quantity: number; reservedQuantity: number }>;

  const cur = rows[0];
  if (cur) return cur;

  const [v] = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  if (!v) throw new VariantNotFoundError(variantId);
  throw new InventoryNotFoundError(variantId);
}

function assertIntegerDelta(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new InvalidQuantityError(`${label} must be a finite integer`);
  }
}

function toPersisted(
  row: {
    id: string;
    productId: string;
    quantity: number;
    reservedQuantity: number;
    lowStockThreshold: number | null;
    location: string | null;
  },
  variantId: string,
): PersistedInventory {
  return {
    id: row.id,
    variantId,
    productId: row.productId,
    quantity: row.quantity,
    reservedQuantity: row.reservedQuantity,
    available: row.quantity - row.reservedQuantity,
    lowStockThreshold: row.lowStockThreshold,
    location: row.location,
  };
}

async function readFullInventory(variantId: string): Promise<PersistedInventory | null> {
  const rows = await db.execute(sql`
    SELECT i.id, i.quantity, i.reserved_quantity AS "reservedQuantity", i.low_stock_threshold AS "lowStockThreshold", i.location, v.product_id AS "productId"
    FROM inventory AS i
    JOIN product_variant AS v ON v.id = i.variant_id
    WHERE i.variant_id = ${variantId}
  `) as Array<{
    id: string;
    productId: string;
    quantity: number;
    reservedQuantity: number;
    lowStockThreshold: number | null;
    location: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    variantId,
    productId: r.productId,
    quantity: r.quantity,
    reservedQuantity: r.reservedQuantity,
    available: r.quantity - r.reservedQuantity,
    lowStockThreshold: r.lowStockThreshold,
    location: r.location,
  };
}

/**
 * Atomically adjust on-hand `quantity` by a signed delta.
 *
 * Invariant enforced atomically (row locked via FOR UPDATE inside the tx):
 *   (quantity + delta) - reserved_quantity >= 0   → available never negative.
 * On success an `inventoryMovements` audit row records the delta.
 *
 * Note: this modifies on-hand stock only. Fulfilling a reservation (decrementing
 * both quantity and reserved) is not a single movement type in the schema; the
 * caller must RELEASE the reservation (adjustReservation) and then SELL the unit
 * (adjustStock) if both counters must move. This keeps stock adjustment and
 * reservation adjustment distinct, as the data model intends.
 */
export async function adjustStock(
  variantId: string,
  delta: number,
  type: InventoryMovementType,
  options: { reason?: string; notes?: string } = {},
  actorId?: string,
  requestId?: string,
): Promise<PersistedInventory> {
  assertIntegerDelta(delta, "delta");

  return db.transaction(async (tx) => {
    const cur = await lockInventory(tx, variantId);

    const newQuantity = cur.quantity + delta;
    const newAvailable = newQuantity - cur.reservedQuantity;
    if (newAvailable < 0) {
      throw new InsufficientStockError(
        `Adjustment of ${delta} would make available stock negative (resulting available=${newAvailable})`,
      );
    }

    const [updated] = await tx
      .update(inventory)
      .set({ quantity: newQuantity, updatedAt: new Date() })
      .where(eq(inventory.id, cur.id))
      .returning();
    // The row was read under lock a few lines above; an empty returning
    // would mean concurrent deletion or state corruption — fail loudly.
    if (!updated) throw new InventoryRowGoneError(cur.id);

    await tx.insert(inventoryMovements).values({
      inventoryId: updated.id,
      quantity: delta,
      type,
      reason: options.reason,
      notes: options.notes,
      // adjustStock is reached only through the admin console action today;
      // an anonymous (null) actor is automation and is labelled accordingly.
      actorType: actorId ? "admin" : "system",
      actorId,
    });

    // Check and create/resolve low-stock alert after stock adjustment
    await checkAndCreateLowStockAlert(tx, variantId, { actorId, requestId });
    await checkAndResolveLowStockAlert(tx, variantId, { actorId, requestId });

    logger.catalog.inventoryAdjusted(updated.id, variantId, type, delta, actorId ?? "unknown", requestId);

    return toPersisted(
      {
        id: updated.id,
        productId: cur.productId,
        quantity: updated.quantity,
        reservedQuantity: updated.reservedQuantity,
        lowStockThreshold: updated.lowStockThreshold ?? null,
        location: updated.location ?? null,
      },
      variantId,
    );
  });
}

/**
 * Replace on-hand `quantity` with an absolute value (stock replacement /
 * physical-count correction). Distinct from adjustStock's delta semantics.
 *
 * Invariant enforced atomically (row locked): target >= reservedQuantity.
 * Movement recorded as ADJUSTMENT with delta = target - oldQuantity.
 */
export async function setStock(
  variantId: string,
  quantity: number,
  options: { reason?: string; notes?: string } = {},
  actorId?: string,
  requestId?: string,
): Promise<PersistedInventory> {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
    throw new InvalidQuantityError("quantity must be a non-negative finite integer");
  }

  return db.transaction(async (tx) => {
    const cur = await lockInventory(tx, variantId);
    if (quantity < cur.reservedQuantity) {
      throw new InsufficientStockError(
        `Cannot set quantity (${quantity}) below reservedQuantity (${cur.reservedQuantity})`,
      );
    }

    const delta = quantity - cur.quantity;
    const [updated] = await tx
      .update(inventory)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(inventory.id, cur.id))
      .returning();
    if (!updated) throw new InventoryRowGoneError(cur.id);

    await tx.insert(inventoryMovements).values({
      inventoryId: updated.id,
      quantity: delta,
      type: "ADJUSTMENT",
      reason: options.reason,
      notes: options.notes,
      // setStock is reached only through the admin console action today.
      actorType: actorId ? "admin" : "system",
      actorId,
    });

    // Check and create/resolve low-stock alert after stock adjustment
    await checkAndCreateLowStockAlert(tx, variantId, { actorId, requestId });
    await checkAndResolveLowStockAlert(tx, variantId, { actorId, requestId });

    logger.catalog.inventoryAdjusted(updated.id, variantId, "ADJUSTMENT", delta, actorId ?? "unknown", requestId);

    return toPersisted(
      {
        id: updated.id,
        productId: cur.productId,
        quantity: updated.quantity,
        reservedQuantity: updated.reservedQuantity,
        lowStockThreshold: updated.lowStockThreshold ?? null,
        location: updated.location ?? null,
      },
      variantId,
    );
  });
}

/**
 * Atomically adjust `reservedQuantity` by a signed delta (RESERVATION raises
 * it; RELEASE lowers it).
 *
 * Invariants enforced atomically (row locked):
 *   reserved_quantity + delta >= 0            → reserved never negative
 *   reserved_quantity + delta <= quantity     → never reserve more than on hand
 */
export async function adjustReservation(
  variantId: string,
  delta: number,
  type: InventoryMovementType,
  options: { reason?: string; notes?: string } = {},
  actorId?: string,
  requestId?: string,
): Promise<PersistedInventory> {
  assertIntegerDelta(delta, "delta");

  return db.transaction(async (tx) => {
    const cur = await lockInventory(tx, variantId);

    const newReserved = cur.reservedQuantity + delta;
    if (newReserved < 0) {
      throw new InsufficientStockError(
        `Releasing ${delta} would make reservedQuantity negative (result=${newReserved})`,
      );
    }
    if (newReserved > cur.quantity) {
      throw new InsufficientStockError(
        `Reserving ${delta} would exceed on-hand quantity (reserved=${newReserved} > quantity=${cur.quantity})`,
      );
    }

    const [updated] = await tx
      .update(inventory)
      .set({ reservedQuantity: newReserved, updatedAt: new Date() })
      .where(eq(inventory.id, cur.id))
      .returning();
    if (!updated) throw new InventoryRowGoneError(cur.id);

    await tx.insert(inventoryMovements).values({
      inventoryId: updated.id,
      quantity: delta,
      type,
      reason: options.reason,
      notes: options.notes,
      actorType: actorId ? "admin" : "system",
      actorId,
    });

    // Check and create/resolve low-stock alert after reservation adjustment
    // (since available = quantity - reservedQuantity)
    await checkAndCreateLowStockAlert(tx, variantId, { actorId, requestId });
    await checkAndResolveLowStockAlert(tx, variantId, { actorId, requestId });

    logger.catalog.inventoryAdjusted(updated.id, variantId, type, delta, actorId ?? "unknown", requestId);

    return toPersisted(
      {
        id: updated.id,
        productId: cur.productId,
        quantity: updated.quantity,
        reservedQuantity: updated.reservedQuantity,
        lowStockThreshold: updated.lowStockThreshold ?? null,
        location: updated.location ?? null,
      },
      variantId,
    );
  });
}

/**
 * Read the persisted inventory (with derived available) for a variant.
 */
export async function getInventoryByVariant(variantId: string): Promise<PersistedInventory | null> {
  return readFullInventory(variantId);
}

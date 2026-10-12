import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { inventory, inventoryMovements, orderItems } from "@/infrastructure/database/schema";
import { inventoryMovementTypeEnum, orderReservationStatusEnum } from "@/infrastructure/database/schema/enums";
import { productVariants } from "@/infrastructure/database/schema/catalog";
import { logger } from "@/shared/lib/logging/logger";
import {
  OrderNotFoundError,
  OrderItemNotFoundError,
  InvalidOrderItemQuantityError,
  OrderAlreadyReservedError,
  InsufficientStockForOrderError,
  OrderAlreadyCancelledError,
  OrderAlreadyCompletedError,
  OrderReservationReleasedError,
  InvalidOrderTransitionError,
} from "@/modules/orders/domain/errors/order-errors";

export type OrderReservationStatus = (typeof orderReservationStatusEnum.enumValues)[number];

export {
  OrderNotFoundError,
  OrderItemNotFoundError,
  InvalidOrderItemQuantityError,
  OrderAlreadyReservedError,
  InsufficientStockForOrderError,
  OrderAlreadyCancelledError,
  OrderAlreadyCompletedError,
  OrderReservationReleasedError,
  InvalidOrderTransitionError,
};

export interface OrderItemForReservation {
  id: string;
  orderId: string;
  variantId: string;
  quantity: number;
  reservationStatus: OrderReservationStatus;
}

export interface ReservationResult {
  orderId: string;
  reservedItems: Array<{
    orderItemId: string;
    variantId: string;
    quantity: number;
  }>;
}

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockInventoryForVariants(
  tx: TxClient,
  variantIds: string[],
): Promise<Map<string, { id: string; quantity: number; reservedQuantity: number; productId: string }>> {
  const rows = (await tx.execute(sql`
    SELECT i.id, i.quantity, i.reserved_quantity AS "reservedQuantity", i.variant_id AS "variantId", v.product_id AS "productId"
    FROM inventory AS i
    JOIN product_variant AS v ON v.id = i.variant_id
    WHERE i.variant_id IN (${sql.join(variantIds.map((v) => sql`${v}`), sql`, `)})
    FOR UPDATE
  `)) as Array<{
    id: string;
    variantId: string;
    quantity: number;
    reservedQuantity: number;
    productId: string;
  }>;

  const map = new Map<
    string,
    { id: string; quantity: number; reservedQuantity: number; productId: string }
  >();
  for (const row of rows) {
    map.set(row.variantId, row);
  }
  return map;
}

function assertValidQuantity(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new InvalidOrderItemQuantityError(`${label} must be a positive finite integer`);
  }
}

export async function reserveOrderInventory(
  orderId: string,
  options: { actorId?: string; requestId?: string } = {},
): Promise<ReservationResult> {
  return db.transaction(async (tx) => {
    const orderItemsRows = await tx
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
        reservationStatus: orderItems.reservationStatus,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (orderItemsRows.length === 0) {
      throw new OrderItemNotFoundError(orderId);
    }

    const pendingItems = orderItemsRows.filter((item) => item.reservationStatus === "PENDING");
    if (pendingItems.length === 0) {
      // All items already have a reservation status - this is an idempotent call
      // Throw error to indicate the order is already reserved
      throw new OrderAlreadyReservedError(orderId);
    }

    for (const item of pendingItems) {
      assertValidQuantity(item.quantity, `Order item quantity for variant ${item.variantId}`);
    }

    const variantQuantities = new Map<string, number>();
    for (const item of pendingItems) {
      const existing = variantQuantities.get(item.variantId) ?? 0;
      variantQuantities.set(item.variantId, existing + item.quantity);
    }

    const sortedVariantIds = Array.from(variantQuantities.keys()).sort();

    const lockedInventory = await lockInventoryForVariants(tx, sortedVariantIds);

    for (const [variantId, totalQuantity] of variantQuantities) {
      const inv = lockedInventory.get(variantId);
      if (!inv) {
        const [variant] = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(eq(productVariants.id, variantId));
        if (!variant) {
          throw new InsufficientStockForOrderError(`Variant not found: ${variantId}`);
        }
        throw new InsufficientStockForOrderError(`No inventory record for variant: ${variantId}`);
      }

      const available = inv.quantity - inv.reservedQuantity;
      if (totalQuantity > available) {
        throw new InsufficientStockForOrderError(
          `Insufficient stock for variant ${variantId}: requested ${totalQuantity}, available ${available}`,
        );
      }
    }

    for (const [variantId, totalQuantity] of variantQuantities) {
      const inv = lockedInventory.get(variantId)!;

      const newReserved = inv.reservedQuantity + totalQuantity;

      await tx
        .update(inventory)
        .set({ reservedQuantity: newReserved, updatedAt: new Date() })
        .where(eq(inventory.id, inv.id));

      await tx.insert(inventoryMovements).values({
        inventoryId: inv.id,
        quantity: totalQuantity,
        type: "RESERVATION",
        reason: `Order ${orderId} reservation`,
      });

      logger.catalog.inventoryAdjusted(
        inv.id,
        variantId,
        "RESERVATION",
        totalQuantity,
        options.actorId ?? "unknown",
        options.requestId,
      );
    }

    // Atomically update order items status from PENDING to RESERVED
    // This prevents race conditions where concurrent requests both see PENDING
    const pendingItemIds = pendingItems.map((item) => item.id);
    const updateResult = await tx
      .update(orderItems)
      .set({ reservationStatus: "RESERVED", updatedAt: new Date() })
      .where(
        and(
          inArray(orderItems.id, pendingItemIds),
          eq(orderItems.reservationStatus, "PENDING")
        )
      )
      .returning({ id: orderItems.id });

    // If no rows were updated, another transaction already reserved them
    if (updateResult.length === 0) {
      throw new OrderAlreadyReservedError(orderId);
    }

    const allItems = await tx
      .select({
        id: orderItems.id,
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    return {
      orderId,
      reservedItems: allItems.map((item) => ({
        orderItemId: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    };
  });
}

export async function releaseOrderReservation(
  orderId: string,
  options: { actorId?: string; requestId?: string; reason?: string } = {},
): Promise<void> {
  return db.transaction(async (tx) => {
    // First, check if order exists and get its items
    const orderItemsRows = await tx
      .select({
        id: orderItems.id,
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
        reservationStatus: orderItems.reservationStatus,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (orderItemsRows.length === 0) {
      throw new OrderItemNotFoundError(orderId);
    }

    // Check if there are any items in RESERVED state
    const reservedItems = orderItemsRows.filter((item) => item.reservationStatus === "RESERVED");
    if (reservedItems.length === 0) {
      // Check if items are already released or committed
      const hasReleased = orderItemsRows.some((item) => item.reservationStatus === "RELEASED");
      const hasCommitted = orderItemsRows.some((item) => item.reservationStatus === "COMMITTED");

      if (hasCommitted) {
        throw new OrderAlreadyCompletedError(orderId);
      }
      if (hasReleased) {
        // Idempotent: already released
        return;
      }
      // All items are PENDING - nothing to release
      return;
    }

    // Aggregate quantities by variant
    const variantQuantities = new Map<string, number>();
    for (const item of reservedItems) {
      const existing = variantQuantities.get(item.variantId) ?? 0;
      variantQuantities.set(item.variantId, existing + item.quantity);
    }

    const sortedVariantIds = Array.from(variantQuantities.keys()).sort();

    const lockedInventory = await lockInventoryForVariants(tx, sortedVariantIds);

    for (const [variantId, totalQuantity] of variantQuantities) {
      const inv = lockedInventory.get(variantId)!;

      const newReserved = inv.reservedQuantity - totalQuantity;
      if (newReserved < 0) {
        throw new Error(`Releasing ${totalQuantity} would make reservedQuantity negative for variant ${variantId}`);
      }

      await tx
        .update(inventory)
        .set({ reservedQuantity: newReserved, updatedAt: new Date() })
        .where(eq(inventory.id, inv.id));

      await tx.insert(inventoryMovements).values({
        inventoryId: inv.id,
        quantity: -totalQuantity,
        type: "RELEASE",
        reason: options.reason ?? `Order ${orderId} reservation released`,
      });

      logger.catalog.inventoryAdjusted(
        inv.id,
        variantId,
        "RELEASE",
        -totalQuantity,
        options.actorId ?? "unknown",
        options.requestId,
      );
    }

    // Atomically update order items status from RESERVED to RELEASED
    // This prevents race conditions where concurrent releases both see RESERVED
    const reservedItemIds = reservedItems.map((item) => item.id);
    const updateResult = await tx
      .update(orderItems)
      .set({ reservationStatus: "RELEASED", updatedAt: new Date() })
      .where(
        and(
          inArray(orderItems.id, reservedItemIds),
          eq(orderItems.reservationStatus, "RESERVED")
        )
      )
      .returning({ id: orderItems.id });

    // If no rows were updated, check if they're already RELEASED (idempotent)
    // or if there's an unexpected state
    if (updateResult.length === 0) {
      const currentItems = await tx
        .select({ reservationStatus: orderItems.reservationStatus })
        .from(orderItems)
        .where(inArray(orderItems.id, reservedItemIds));

      const allReleased = currentItems.every((item) => item.reservationStatus === "RELEASED");
      if (allReleased) {
        // Idempotent: already released by another transaction
        return;
      }
      throw new OrderReservationReleasedError(orderId);
    }
  });
}

export async function commitOrderReservation(
  orderId: string,
  options: { actorId?: string; requestId?: string } = {},
): Promise<void> {
  return db.transaction(async (tx) => {
    const reservedItems = await tx
      .select({
        id: orderItems.id,
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
        reservationStatus: orderItems.reservationStatus,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const toCommit = reservedItems.filter((item) => item.reservationStatus === "RESERVED");
    if (toCommit.length === 0) {
      return;
    }

    const variantQuantities = new Map<string, number>();
    for (const item of toCommit) {
      const existing = variantQuantities.get(item.variantId) ?? 0;
      variantQuantities.set(item.variantId, existing + item.quantity);
    }

    const sortedVariantIds = Array.from(variantQuantities.keys()).sort();

    const lockedInventory = await lockInventoryForVariants(tx, sortedVariantIds);

    for (const [variantId, totalQuantity] of variantQuantities) {
      const inv = lockedInventory.get(variantId)!;

      const newQuantity = inv.quantity - totalQuantity;
      const newReserved = inv.reservedQuantity - totalQuantity;

      if (newQuantity < 0 || newReserved < 0) {
        throw new Error(`Committing ${totalQuantity} would make quantity or reserved negative for variant ${variantId}`);
      }

      await tx
        .update(inventory)
        .set({ quantity: newQuantity, reservedQuantity: newReserved, updatedAt: new Date() })
        .where(eq(inventory.id, inv.id));

      await tx.insert(inventoryMovements).values({
        inventoryId: inv.id,
        quantity: -totalQuantity,
        type: "SALE",
        reason: `Order ${orderId} fulfilled`,
      });

      logger.catalog.inventoryAdjusted(
        inv.id,
        variantId,
        "SALE",
        -totalQuantity,
        options.actorId ?? "unknown",
        options.requestId,
      );
    }

    const itemIdsToUpdate = toCommit.map((item) => item.id);
    await tx
      .update(orderItems)
      .set({ reservationStatus: "COMMITTED", updatedAt: new Date() })
      .where(inArray(orderItems.id, itemIdsToUpdate));
  });
}
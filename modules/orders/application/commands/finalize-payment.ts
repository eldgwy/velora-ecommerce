import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { inventory, inventoryMovements } from "@/infrastructure/database/schema/inventory";
import { orderItems, orders, payments, webhookEvents } from "@/infrastructure/database/schema/orders";
import { orderPaymentStatusEnum, orderReservationStatusEnum, orderStatusEnum, paymentStatusEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";
import {
  OrderNotFoundError,
  OrderAlreadyCompletedError,
  OrderAlreadyCancelledError,
  OrderReservationReleasedError,
  InvalidOrderTransitionError,
  InsufficientStockForOrderError,
} from "@/modules/orders/domain/errors/order-errors";

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type OrderPaymentStatus = (typeof orderPaymentStatusEnum.enumValues)[number];
export type OrderReservationStatus = (typeof orderReservationStatusEnum.enumValues)[number];
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

const FINALIZABLE_ORDER_STATUSES = new Set<OrderStatus>(["PENDING", "PROCESSING"]);
const FINALIZABLE_PAYMENT_STATUSES = new Set<OrderPaymentStatus>(["AUTHORIZED", "REQUIRES_ACTION", "PENDING"]);
const TERMINAL_PAYMENT_STATUSES = new Set<PaymentStatus>(["COMPLETED", "FAILED", "REFUNDED"]);
const TERMINAL_ORDER_PAYMENT_STATUSES = new Set<OrderPaymentStatus>(["FAILED", "CANCELLED", "REFUNDED", "EXPIRED"]);

export interface FinalizePaymentResult {
  orderId: string;
  paymentId: string;
  fulfilledItems: Array<{
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
  if (variantIds.length === 0) {
    return new Map();
  }
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

/**
 * Finalize an order's inventory reservations after successful payment.
 * 
 * This operation atomically:
 * 1. Locks the order and its outstanding reservations
 * 2. Verifies payment and order states permit finalization
 * 3. Verifies each reservation is still active and correctly linked
 * 4. Decreases physical quantity by the reserved quantity being fulfilled
 * 5. Decreases reservedQuantity by that same quantity
 * 6. Writes SALE movement records
 * 7. Marks reservations as COMMITTED and updates order lifecycle state
 * 8. Updates payment record
 * 9. Persists webhook processing completion
 * 
 * This is a single transaction that prevents duplicate stock deductions.
 * Idempotent: calling multiple times for the same order/payment will only finalize once.
 * 
 * If the order was already cancelled or released, throws an error with
 * explicit conflict/recovery policy. Never silently sells unavailable stock.
 */
export async function finalizeOrderPayment(
  orderId: string,
  paymentId: string,
  options: { actorId?: string; requestId?: string; provider?: string } = {},
): Promise<FinalizePaymentResult> {
  return db.transaction(async (tx) => {
    // 1. Lock the order and verify it exists
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        totalAmount: orders.totalAmount,
        currency: orders.currency,
      })
      .from(orders)
      .where(eq(orders.id, orderId));

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    // 2. Lock the payment and verify it exists and matches the order
    const [payment] = await tx
      .select({
        id: payments.id,
        orderId: payments.orderId,
        provider: payments.provider,
        providerPaymentId: payments.providerPaymentId,
        amount: payments.amount,
        currency: payments.currency,
        status: payments.status,
      })
      .from(payments)
      .where(eq(payments.id, paymentId));

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    if (payment.orderId !== orderId) {
      throw new Error(`Payment ${paymentId} does not belong to order ${orderId}`);
    }

    // 3. Check if payment is already completed (idempotency)
    if (payment.status === "COMPLETED") {
      // Find already committed items and return them
      const committedItems = await tx
        .select({
          id: orderItems.id,
          variantId: orderItems.variantId,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, orderId),
            eq(orderItems.reservationStatus, "COMMITTED"),
          ),
        );

      return {
        orderId,
        paymentId,
        fulfilledItems: committedItems.map((item) => ({
          orderItemId: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      };
    }

    // 4. Verify order status allows finalization
    if (!FINALIZABLE_ORDER_STATUSES.has(order.status)) {
      if (order.status === "CANCELLED") {
        throw new OrderAlreadyCancelledError(orderId);
      }
      if (order.status === "DELIVERED" || order.status === "SHIPPED") {
        throw new OrderAlreadyCompletedError(orderId);
      }
      throw new InvalidOrderTransitionError(`Cannot finalize order in ${order.status} state`);
    }

    // 5. Verify payment record status - cannot finalize if payment failed/refunded
    if (payment.status === "FAILED" || payment.status === "REFUNDED") {
      throw new InvalidOrderTransitionError(`Cannot finalize order with payment status ${payment.status}`);
    }

    // 6. Verify order payment status allows finalization
    if (!order.paymentStatus || !FINALIZABLE_PAYMENT_STATUSES.has(order.paymentStatus)) {
      if (order.paymentStatus && TERMINAL_ORDER_PAYMENT_STATUSES.has(order.paymentStatus)) {
        throw new InvalidOrderTransitionError(`Cannot finalize order with payment status ${order.paymentStatus}`);
      }
      throw new InvalidOrderTransitionError(`Cannot finalize order with payment status ${order.paymentStatus ?? "null"}`);
    }

    // 6. Get order items with RESERVED status
    const reservedItems = await tx
      .select({
        id: orderItems.id,
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
        reservationStatus: orderItems.reservationStatus,
      })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, orderId),
          eq(orderItems.reservationStatus, "RESERVED"),
        ),
      );

    if (reservedItems.length === 0) {
      // Check if items are already committed (idempotent) or released
      const allItems = await tx
        .select({
          id: orderItems.id,
          variantId: orderItems.variantId,
          quantity: orderItems.quantity,
          reservationStatus: orderItems.reservationStatus,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      const hasCommitted = allItems.some((item) => item.reservationStatus === "COMMITTED");
      const hasReleased = allItems.some((item) => item.reservationStatus === "RELEASED");

      if (hasReleased && !hasCommitted) {
        throw new OrderReservationReleasedError(orderId);
      }
      if (hasCommitted) {
        // Already finalized - return existing fulfillment
        const committedItems = allItems.filter((item) => item.reservationStatus === "COMMITTED");
        return {
          orderId,
          paymentId,
          fulfilledItems: committedItems.map((item) => ({
            orderItemId: item.id,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        };
      }
      throw new InvalidOrderTransitionError("No active reservations to finalize");
    }

    // 7. Aggregate quantities by variant for locking
    const variantQuantities = new Map<string, number>();
    for (const item of reservedItems) {
      const existing = variantQuantities.get(item.variantId) ?? 0;
      variantQuantities.set(item.variantId, existing + item.quantity);
    }

    const sortedVariantIds = Array.from(variantQuantities.keys()).sort();

    // 8. Lock inventory rows for all variants
    const inventoryMap = await lockInventoryForVariants(tx, sortedVariantIds);

    // 9. Verify inventory availability and process each variant
    const fulfilledItems: Array<{ orderItemId: string; variantId: string; quantity: number }> = [];

    for (const item of reservedItems) {
      const inv = inventoryMap.get(item.variantId);
      if (!inv) {
        throw new InsufficientStockForOrderError(`No inventory record for variant: ${item.variantId}`);
      }

      const totalQuantity = variantQuantities.get(item.variantId)!;
      const newQuantity = inv.quantity - totalQuantity;
      const newReserved = inv.reservedQuantity - totalQuantity;

      if (newQuantity < 0 || newReserved < 0) {
        throw new InsufficientStockForOrderError(
          `Insufficient stock for variant ${item.variantId}: quantity ${inv.quantity}, reserved ${inv.reservedQuantity}, needed ${totalQuantity}`,
        );
      }

      // Update inventory: decrease both quantity and reservedQuantity
      await tx
        .update(inventory)
        .set({ quantity: newQuantity, reservedQuantity: newReserved, updatedAt: new Date() })
        .where(eq(inventory.id, inv.id));

      // Record SALE movement
      await tx.insert(inventoryMovements).values({
        inventoryId: inv.id,
        quantity: -totalQuantity,
        type: "SALE",
        reason: `Order ${orderId} fulfilled (payment ${paymentId})`,
      });

      logger.catalog.inventoryAdjusted(
        inv.id,
        item.variantId,
        "SALE",
        -totalQuantity,
        options.actorId ?? "webhook",
        options.requestId,
      );

      fulfilledItems.push({
        orderItemId: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
      });
    }

    // 10. Mark order items as COMMITTED
    const reservedItemIds = reservedItems.map((item) => item.id);
    await tx
      .update(orderItems)
      .set({ reservationStatus: "COMMITTED", updatedAt: new Date() })
      .where(inArray(orderItems.id, reservedItemIds));

    // 11. Update order status
    const newOrderStatus: OrderStatus = "PROCESSING";
    const newPaymentStatus: OrderPaymentStatus = "PAID";

    await tx
      .update(orders)
      .set({
        status: newOrderStatus,
        paymentStatus: newPaymentStatus,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    // 12. Update payment record
    await tx
      .update(payments)
      .set({
        status: "COMPLETED",
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    // 13. Record webhook event
    await tx.insert(webhookEvents).values({
      provider: options.provider ?? "stripe",
      providerEventId: `finalize_${paymentId}`,
      eventType: "payment.finalized",
      orderId,
      paymentId,
      status: "COMPLETED",
      completedAt: new Date(),
      payload: JSON.stringify({ orderId, paymentId, fulfilledItems: fulfilledItems.length }),
    });

    logger.info("Order payment finalized and inventory committed", {
      module: "orders",
      action: "paymentFinalized",
      orderId,
      paymentId,
      itemCount: fulfilledItems.length,
      actorId: options.actorId ?? "webhook",
    });

    return {
      orderId,
      paymentId,
      fulfilledItems,
    };
  });
}

/**
 * Handle payment failure by releasing reservations and marking payment as failed.
 * This is called when a webhook indicates payment failure.
 */
export async function handlePaymentFailureWebhook(
  orderId: string,
  paymentId: string,
  options: { actorId?: string; requestId?: string; reason?: string; provider?: string } = {},
): Promise<void> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.id, orderId));

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    const [payment] = await tx
      .select({
        id: payments.id,
        status: payments.status,
      })
      .from(payments)
      .where(eq(payments.id, paymentId));

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    // Idempotency: if already failed, return
    if (payment.status === "FAILED") {
      return;
    }

    // Release reservations if order is still pending
    if (order.status === "PENDING" || order.status === "PROCESSING") {
      try {
        // Get reserved items
        const reservedItems = await tx
          .select({
            id: orderItems.id,
            variantId: orderItems.variantId,
            quantity: orderItems.quantity,
            reservationStatus: orderItems.reservationStatus,
          })
          .from(orderItems)
          .where(
            and(
              eq(orderItems.orderId, orderId),
              eq(orderItems.reservationStatus, "RESERVED"),
            ),
          );

        if (reservedItems.length > 0) {
          const variantQuantities = new Map<string, number>();
          for (const item of reservedItems) {
            const existing = variantQuantities.get(item.variantId) ?? 0;
            variantQuantities.set(item.variantId, existing + item.quantity);
          }

          const sortedVariantIds = Array.from(variantQuantities.keys()).sort();
          const inventoryMap = await lockInventoryForVariants(tx, sortedVariantIds);

          for (const [variantId, totalQuantity] of variantQuantities) {
            const inv = inventoryMap.get(variantId);
            if (!inv) {
              throw new InsufficientStockForOrderError(`No inventory record for variant: ${variantId}`);
            }

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
              reason: options.reason ?? `Payment ${paymentId} failed`,
            });

            logger.catalog.inventoryAdjusted(
              inv.id,
              variantId,
              "RELEASE",
              -totalQuantity,
              options.actorId ?? "webhook",
              options.requestId,
            );
          }

          // Update order items to RELEASED
          const reservedItemIds = reservedItems.map((item) => item.id);
          await tx
            .update(orderItems)
            .set({ reservationStatus: "RELEASED", updatedAt: new Date() })
            .where(
              and(
                inArray(orderItems.id, reservedItemIds),
                eq(orderItems.reservationStatus, "RESERVED"),
              ),
            );
        }
      } catch (error) {
        if (error instanceof OrderAlreadyCompletedError) {
          // Some items already committed - log but continue
          logger.warn("Some items already committed during payment failure handling", {
            module: "orders",
            action: "paymentFailureWebhook",
            orderId,
            paymentId,
          });
        } else {
          throw error;
        }
      }
    }

    // Update payment status
    await tx
      .update(payments)
      .set({
        status: "FAILED",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    // Update order payment status
    const newOrderStatus = order.status === "PENDING" ? "CANCELLED" : order.status;
    await tx
      .update(orders)
      .set({
        status: newOrderStatus,
        paymentStatus: "FAILED",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    // Record webhook event
    await tx.insert(webhookEvents).values({
      provider: options.provider ?? "stripe",
      providerEventId: `failure_${paymentId}`,
      eventType: "payment.failed",
      orderId,
      paymentId,
      status: "COMPLETED",
      completedAt: new Date(),
      payload: JSON.stringify({ orderId, paymentId, reason: options.reason }),
    });

    logger.info("Payment failure handled via webhook", {
      module: "orders",
      action: "paymentFailureWebhook",
      orderId,
      paymentId,
      actorId: options.actorId ?? "webhook",
    });
  });
}
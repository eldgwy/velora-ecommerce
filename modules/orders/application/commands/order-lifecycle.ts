import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { orders, orderStatusHistories } from "@/infrastructure/database/schema/orders";
import { orderStatusEnum, orderPaymentStatusEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";
import {
  OrderNotFoundError,
  OrderAlreadyCancelledError,
  OrderAlreadyCompletedError,
  InvalidOrderTransitionError,
} from "@/modules/orders/domain/errors/order-errors";
import type { OrderActor, OrderStatus as LifecycleStatus } from "@/modules/orders/domain/rules/order-transitions";
import { releaseOrderReservation } from "./reserve-order-inventory";

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type OrderPaymentStatus = (typeof orderPaymentStatusEnum.enumValues)[number];

/** Audit context threaded into history rows (migration 0017). */
export interface LifecycleAudit {
  actorType?: OrderActor;
  actorId?: string;
  eventType?: string;
  correlationId?: string;
}

const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>(["DELIVERED", "CANCELLED"]);
const RELEASABLE_ORDER_STATUSES = new Set<OrderStatus>(["PENDING", "PROCESSING"]);
const RELEASABLE_PAYMENT_STATUSES = new Set<OrderPaymentStatus>(["PENDING", "AUTHORIZED", "FAILED", "EXPIRED", "CANCELLED", "REQUIRES_ACTION"]);

function assertOrderExists(orderId: string): void {
  if (!orderId) {
    throw new OrderNotFoundError(orderId);
  }
}

async function recordStatusHistory(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orderId: string,
  status: OrderStatus,
  note?: string,
  audit?: LifecycleAudit & { previousStatus?: LifecycleStatus | null },
): Promise<void> {
  await tx.insert(orderStatusHistories).values({
    orderId,
    status,
    previousStatus: audit?.previousStatus ?? null,
    eventType: audit?.eventType ?? status.toLowerCase(),
    actorType: audit?.actorType ?? "system",
    actorId: audit?.actorId ?? null,
    correlationId: audit?.correlationId ?? null,
    note,
  });
}

function validateCancellable(order: { status: OrderStatus; paymentStatus: OrderPaymentStatus | null }): void {
  if (order.status === "CANCELLED") {
    throw new OrderAlreadyCancelledError("");
  }
  if (TERMINAL_ORDER_STATUSES.has(order.status)) {
    throw new OrderAlreadyCompletedError("");
  }
  if (!RELEASABLE_ORDER_STATUSES.has(order.status)) {
    throw new InvalidOrderTransitionError(`Cannot cancel order in status: ${order.status}`);
  }
  const paymentStatus = order.paymentStatus ?? "PENDING";
  if (!RELEASABLE_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new InvalidOrderTransitionError(`Cannot cancel order with payment status: ${paymentStatus}`);
  }
}

/**
 * Cancel an order and release its inventory reservations.
 *
 * This operation:
 * - Validates the order can be cancelled (not already terminal, not already fulfilled)
 * - Releases any RESERVED inventory reservations
 * - Updates order status to CANCELLED
 * - Updates payment status to CANCELLED if not already terminal
 * - Records status history
 *
 * Idempotent: calling multiple times on the same order will only cancel once.
 * Safe for concurrent invocation with payment failure or expiration handlers.
 */
export async function cancelOrder(
  orderId: string,
  options: { actorId?: string; requestId?: string; reason?: string } & LifecycleAudit = {},
): Promise<void> {
  assertOrderExists(orderId);

  return db.transaction(async (tx) => {
    // Lock the order row so concurrent transitions (finalize, expiry,
    // failure) serialize on fresh state instead of racing on snapshots.
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    // Idempotency: if already cancelled, return success
    if (order.status === "CANCELLED") {
      return;
    }

    validateCancellable(order);

    // Release inventory reservations (idempotent - safe to call multiple times)
    try {
      await releaseOrderReservation(orderId, {
        actorId: options.actorId,
        requestId: options.requestId,
        reason: options.reason ?? "Order cancelled",
      });
    } catch (error) {
      // If release fails because already completed, re-throw to indicate
      // the order has items that cannot be cancelled
      if (error instanceof OrderAlreadyCompletedError) {
        throw error;
      }
      throw error;
    }

    // Update order status
    const paymentStatus = order.paymentStatus ?? "PENDING";
    const newPaymentStatus = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(paymentStatus)
      ? paymentStatus
      : "CANCELLED";

    await tx
      .update(orders)
      .set({
        status: "CANCELLED",
        paymentStatus: newPaymentStatus,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    await recordStatusHistory(tx, orderId, "CANCELLED", options.reason ?? "Order cancelled", {
      previousStatus: order.status,
      eventType: options.eventType ?? "cancelled",
      actorType: options.actorType ?? "system",
      actorId: options.actorId,
      correlationId: options.correlationId ?? options.requestId,
    });

    logger.info("Order cancelled and reservations released", { module: "orders", action: "orderCancelled", orderId, actorId: options.actorId });
  });
}

/**
 * Handle payment failure for an order.
 *
 * This operation:
 * - Validates the order exists
 * - Releases any RESERVED inventory reservations
 * - Updates payment status to FAILED
 * - If order is still PENDING, updates order status to CANCELLED
 * - Records status history
 *
 * Idempotent: calling multiple times will only fail once.
 * Safe for concurrent invocation with cancellation or expiration handlers.
 */
export async function handlePaymentFailure(
  orderId: string,
  options: { actorId?: string; requestId?: string; reason?: string } & LifecycleAudit = {},
): Promise<void> {
  assertOrderExists(orderId);

  return db.transaction(async (tx) => {
    // Same ordering lock as cancelOrder/finalize: serialize on fresh state.
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    // Idempotency: if payment already failed or cancelled, return success
    if (order.paymentStatus === "FAILED" || order.paymentStatus === "CANCELLED") {
      return;
    }

    // Never overwrite a captured-money record with a failure: a PAID (or
    // refunded) order that reaches this handler indicates a stale or
    // duplicate failure signal, not an unpaid order.
    if (
      order.paymentStatus === "PAID" ||
      order.paymentStatus === "REFUNDED" ||
      order.paymentStatus === "PARTIALLY_REFUNDED"
    ) {
      logger.warn("Ignoring payment failure for paid order", {
        module: "orders",
        action: "paymentFailurePaidOrder",
        orderId,
        paymentStatus: order.paymentStatus,
      });
      return;
    }

    // Release inventory reservations (idempotent)
    try {
      await releaseOrderReservation(orderId, {
        actorId: options.actorId,
        requestId: options.requestId,
        reason: options.reason ?? "Payment failed",
      });
    } catch (error) {
      if (error instanceof OrderAlreadyCompletedError) {
        throw error;
      }
      throw error;
    }

    // Update payment status
    const newPaymentStatus = "FAILED";
    const newOrderStatus = order.status === "PENDING" ? "CANCELLED" : order.status;

    await tx
      .update(orders)
      .set({
        status: newOrderStatus,
        paymentStatus: newPaymentStatus,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    await recordStatusHistory(tx, orderId, newOrderStatus, options.reason ?? "Payment failed", {
      previousStatus: order.status,
      eventType: options.eventType ?? "payment_failed",
      actorType: options.actorType ?? "system",
      actorId: options.actorId,
      correlationId: options.correlationId ?? options.requestId,
    });

    logger.info("Payment failure handled", { module: "orders", action: "paymentFailureHandled", orderId, actorId: options.actorId, previousStatus: order.status });
  });
}

/**
 * Handle checkout expiration for an order.
 *
 * This operation:
 * - Validates the order exists and checkout has expired
 * - Releases any RESERVED inventory reservations
 * - Updates order status to CANCELLED
 * - Updates payment status to EXPIRED
 * - Records status history
 *
 * Idempotent: calling multiple times will only expire once.
 * Safe for concurrent invocation with cancellation or payment failure handlers.
 */
export async function handleCheckoutExpiration(
  orderId: string,
  options: { actorId?: string; requestId?: string; reason?: string } & LifecycleAudit = {},
): Promise<void> {
  assertOrderExists(orderId);

  return db.transaction(async (tx) => {
    // Same ordering lock as the other transitions: serialize on fresh state.
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        checkoutExpiresAt: orders.checkoutExpiresAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    // Idempotency: if already expired or cancelled, return success
    if (order.status === "CANCELLED" || order.paymentStatus === "EXPIRED") {
      return;
    }

    // Verify checkout has actually expired
    if (order.checkoutExpiresAt && new Date(order.checkoutExpiresAt) > new Date()) {
      throw new InvalidOrderTransitionError("Checkout has not yet expired");
    }

    // Release inventory reservations (idempotent)
    try {
      await releaseOrderReservation(orderId, {
        actorId: options.actorId,
        requestId: options.requestId,
        reason: options.reason ?? "Checkout expired",
      });
    } catch (error) {
      if (error instanceof OrderAlreadyCompletedError) {
        throw error;
      }
      throw error;
    }

    // Update order status
    await tx
      .update(orders)
      .set({
        status: "CANCELLED",
        paymentStatus: "EXPIRED",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    await recordStatusHistory(tx, orderId, "CANCELLED", options.reason ?? "Checkout expired", {
      previousStatus: order.status,
      eventType: options.eventType ?? "reservation_expired",
      actorType: options.actorType ?? "system",
      actorId: options.actorId,
      correlationId: options.correlationId ?? options.requestId,
    });

    logger.info("Checkout expired and reservations released", { module: "orders", action: "checkoutExpired", orderId, actorId: options.actorId });
  });
}
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import {
  orderNotifications,
  orders,
  orderStatusHistories,
  payments,
} from "@/infrastructure/database/schema/orders";
import {
  canTransitionOrder,
  type OrderActor,
  type OrderStatus,
} from "@/modules/orders/domain/rules/order-transitions";
import {
  InvalidOrderTransitionError,
  OrderNotFoundError,
} from "@/modules/orders/domain/errors/order-errors";
import { logger } from "@/shared/lib/logging/logger";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AuditContext {
  event: string;
  actorType: OrderActor;
  actorId?: string | null;
  correlationId?: string | null;
  note?: string;
}

/**
 * Durably record a state change alongside the mutation that caused it.
 * Must be called inside the caller's transaction so state and audit row
 * commit atomically.
 */
export async function recordTransition(
  tx: Tx,
  orderId: string,
  from: OrderStatus | null,
  to: OrderStatus,
  audit: AuditContext,
): Promise<void> {
  await tx.insert(orderStatusHistories).values({
    orderId,
    status: to,
    previousStatus: from,
    eventType: audit.event,
    actorType: audit.actorType,
    actorId: audit.actorId ?? null,
    correlationId: audit.correlationId ?? null,
    note: audit.note ?? null,
  });
}

/**
 * Claim a notification send exactly once. The winner (`true`) sends after
 * its transaction commits; losers (retries, duplicate webhooks) skip.
 * Safe to call in its own transaction when post-commit dispatch is used.
 */
export async function claimNotification(
  orderId: string,
  type: string,
): Promise<boolean> {
  const rows = (await db.execute(sql`
    INSERT INTO order_notifications (order_id, type, status)
    VALUES (${orderId}, ${type}, 'QUEUED')
    ON CONFLICT (order_id, type) DO NOTHING
    RETURNING id
  `)) as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * Pre-send lease for the synchronous dispatch path (GP-23b / T-3.4). CAS
 * QUEUED -> SENDING before the SMTP call so the retry worker's `claimDueRow`
 * cannot claim the same row while it is in flight (a crash then always
 * leaves either a lease the worker reaps or a backoff row). Returns false
 * when a concurrent worker already leased the row — the dispatch path must
 * skip instead of sending a duplicate.
 */
export async function startNotificationDispatch(
  orderId: string,
  type: string,
): Promise<boolean> {
  const rows = (await db.execute(sql`
    UPDATE order_notifications
    SET status = 'SENDING', updated_at = now()
    WHERE order_id = ${orderId}
      AND type = ${type}
      AND status = 'QUEUED'
    RETURNING id
  `)) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function markNotificationSent(
  orderId: string,
  type: string,
  providerMessageId?: string,
): Promise<void> {
  await db
    .update(orderNotifications)
    .set({
      status: "SENT",
      sentAt: new Date(),
      providerMessageId: providerMessageId ?? null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orderNotifications.orderId, orderId),
        eq(orderNotifications.type, type),
      ),
    );
}

interface TransitionOptions {
  actorType: OrderActor;
  actorId?: string;
  correlationId?: string;
  note?: string;
  event?: string;
}

/**
 * Generic audited transition. Loads the order row FOR UPDATE so concurrent
 * transitions serialize; repeats of the same state return success without
 * duplicating audit rows. Anything outside the matrix throws.
 */
export async function transitionOrderStatus(
  orderId: string,
  to: OrderStatus,
  opts: TransitionOptions,
): Promise<{ from: OrderStatus; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const [order] = await tx.execute(sql`
      SELECT id, status FROM orders WHERE id = ${orderId} FOR UPDATE
    `) as Array<{ id: string; status: OrderStatus }>;
    if (!order) throw new OrderNotFoundError(orderId);

    if (order.status === to) return { from: order.status, replayed: true };
    if (!canTransitionOrder(order.status, to, opts.actorType)) {
      throw new InvalidOrderTransitionError(
        `Cannot transition order from ${order.status} to ${to}`,
      );
    }

    await tx
      .update(orders)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await recordTransition(tx, orderId, order.status, to, {
      event: opts.event ?? to.toLowerCase(),
      actorType: opts.actorType,
      actorId: opts.actorId,
      correlationId: opts.correlationId,
      note: opts.note,
    });

    return { from: order.status, replayed: false };
  });
}

/**
 * Staff/admin fulfillment: PROCESSING → SHIPPED, plus PENDING → SHIPPED for
 * unpaid Cash on Delivery orders only. Inventory was already committed
 * (sold) at payment finalization for card orders, so shipment has no
 * inventory effect; COD reservations release through the normal
 * cancellation/expiry paths if the order never ships. Requires a
 * tracking/note reason for the audit trail.
 *
 * The PENDING → SHIPPED edge exists solely because COD orders never pass
 * through PROCESSING (no Stripe finalization). Card orders reaching this
 * command while PENDING are rejected: they must be paid first. The payment
 * precondition is checked under a row lock; the subsequent
 * `transitionOrderStatus` call re-validates the matrix state, so a concurrent
 * state change can only fail closed, never slip a card order through.
 */
export async function shipOrder(
  orderId: string,
  opts: { actorId: string; actorType?: Extract<OrderActor, "staff" | "admin">; correlationId?: string; note?: string },
): Promise<void> {
  const [order] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) throw new OrderNotFoundError(orderId);
  if (order.status === "PENDING") {
    const [payment] = await db
      .select({ provider: payments.provider, status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, orderId));
    if (
      !payment ||
      payment.provider !== "cod" ||
      payment.status !== "PENDING"
    ) {
      throw new InvalidOrderTransitionError(
        "Only unpaid Cash on Delivery orders may ship before payment.",
      );
    }
  }
  const { from } = await transitionOrderStatus(orderId, "SHIPPED", {
    actorType: opts.actorType ?? "staff",
    actorId: opts.actorId,
    correlationId: opts.correlationId,
    note: opts.note ?? "Order shipped",
    event: "shipped",
  });
  void from;
  logger.info("Order shipped", { module: "orders", action: "orderShipped", orderId, actorId: opts.actorId });
}

/** Staff/admin fulfillment: SHIPPED → DELIVERED. */
export async function deliverOrder(
  orderId: string,
  opts: { actorId: string; actorType?: Extract<OrderActor, "staff" | "admin">; correlationId?: string; note?: string },
): Promise<void> {
  const { from } = await transitionOrderStatus(orderId, "DELIVERED", {
    actorType: opts.actorType ?? "staff",
    actorId: opts.actorId,
    correlationId: opts.correlationId,
    note: opts.note ?? "Order delivered",
    event: "delivered",
  });
  void from;
  logger.info("Order delivered", { module: "orders", action: "orderDelivered", orderId, actorId: opts.actorId });
}

/**
 * Customer self-cancellation (BR-014): PENDING orders with unpaid status
 * only. Paid orders are rejected with an explicit escalation message —
 * refunds are admin-initiated via the refund workflow, never automatic.
 * Ownership is verified here (order.userId === customerId), so callers
 * cannot reach across customers. Repeated calls are safe.
 */
export async function cancelOrderAsCustomer(
  orderId: string,
  customerId: string,
  opts: { correlationId?: string; reason?: string } = {},
): Promise<void> {
  const outcome = await db.transaction(async (tx) => {
    const [order] = await tx.execute(sql`
      SELECT id, user_id AS "userId", status, payment_status AS "paymentStatus"
      FROM orders WHERE id = ${orderId} FOR UPDATE
    `) as Array<{
      id: string;
      userId: string;
      status: OrderStatus;
      paymentStatus: string | null;
    }>;
    if (!order || order.userId !== customerId) {
      // Same response for missing vs. foreign: no ownership oracle (BR-008).
      throw new OrderNotFoundError(orderId);
    }
    if (order.status === "CANCELLED") return { already: true as const };
    if (order.status !== "PENDING") {
      throw new InvalidOrderTransitionError(
        `Order ${orderId} can no longer be cancelled (status: ${order.status}). Contact support for help.`,
      );
    }
    if (order.paymentStatus === "PAID") {
      throw new InvalidOrderTransitionError(
        "This order has already been paid. Self-cancellation is closed — contact support to request a refund review.",
      );
    }
    return { already: false as const };
  });

  if (outcome.already) return;

  // Release + cancel + history through the established lifecycle, with full
  // audit context attached.
  const { cancelOrder } = await import("./order-lifecycle");
  await cancelOrder(orderId, {
    actorId: customerId,
    reason: opts.reason ?? "Cancelled by customer",
    actorType: "customer",
    eventType: "cancelled",
    correlationId: opts.correlationId,
  });
}

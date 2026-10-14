import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import {
  orders,
  orderStatusHistories,
  payments,
} from "@/infrastructure/database/schema/orders";
import {
  InvalidOrderTransitionError,
  OrderNotFoundError,
} from "@/modules/orders/domain/errors/order-errors";
import { canTransitionPayment } from "@/modules/payments/domain/payment-transitions";

export interface CollectCodResult {
  orderId: string;
  paymentId: string;
}

/**
 * Record cash collected on delivery (COD only).
 *
 * Preconditions, all re-checked under a row lock inside one transaction:
 * - order is SHIPPED or DELIVERED (cash changes hands at/after delivery —
 *   never at creation or shipment time),
 * - payment provider is `cod` (this path never touches Stripe logic),
 * - payment is PENDING (repeat collections replay idempotently).
 *
 * Effects: payment → COMPLETED + paidAt, order paymentStatus → PAID, one
 * audit row. Inventory is untouched (already committed at fulfillment).
 */
export async function collectCodPayment(
  orderId: string,
  options: { actorId: string; actorType?: "staff" | "admin"; correlationId?: string },
): Promise<CollectCodResult> {
  return db.transaction(async (tx) => {
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

    const [payment] = await tx
      .select({
        id: payments.id,
        provider: payments.provider,
        paymentMethod: payments.paymentMethod,
        status: payments.status,
      })
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .for("update");

    if (!payment) {
      throw new OrderNotFoundError(orderId);
    }

    // Idempotent replay: already collected.
    if (payment.status === "COMPLETED" && order.paymentStatus === "PAID") {
      return { orderId, paymentId: payment.id };
    }

    if (payment.provider !== "cod" || payment.paymentMethod !== "CASH_ON_DELIVERY") {
      throw new InvalidOrderTransitionError(
        "Cash collection applies only to Cash on Delivery payments.",
      );
    }
    if (!canTransitionPayment(
      (payment.status ?? "PENDING") as "PENDING" | "AUTHORIZED" | "COMPLETED" | "FAILED" | "REFUNDED",
      "COMPLETED",
    )) {
      throw new InvalidOrderTransitionError(
        `Cash cannot be collected while the payment is ${payment.status ?? "unknown"}.`,
      );
    }
    if (order.status !== "SHIPPED" && order.status !== "DELIVERED") {
      throw new InvalidOrderTransitionError(
        `Cash can only be collected for shipped or delivered orders (current: ${order.status}).`,
      );
    }

    await tx
      .update(payments)
      .set({ status: "COMPLETED", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    await tx
      .update(orders)
      .set({ paymentStatus: "PAID", updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await tx.insert(orderStatusHistories).values({
      orderId,
      status: order.status as typeof orders.status.enumValues[number],
      previousStatus: order.status as typeof orders.status.enumValues[number],
      eventType: "payment_collected",
      actorType: options.actorType ?? "staff",
      actorId: options.actorId,
      correlationId: options.correlationId ?? null,
      note: "Cash on delivery collected",
    });

    return { orderId, paymentId: payment.id };
  });
}

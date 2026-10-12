"use server";

import { getCurrentSession } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  getOrderDetail,
  listCustomerOrders,
  type OrderDetail,
  type PaginatedOrders,
} from "@/modules/orders/application/queries/orders";
import { cancelOrderAsCustomer } from "@/modules/orders/application/commands/order-transitions";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";
import { OrderNotFoundError } from "@/modules/orders/domain/errors/order-errors";
import { InvalidOrderTransitionError } from "@/modules/orders/domain/errors/order-errors";
import {
  historyQuerySchema,
  orderIdSchema,
} from "@/modules/orders/presentation/schemas/order.schema";

function logFailure(action: string, error: unknown, userId?: string): void {
  logger.error(`Order action failed: ${action}`, {
    module: "orders",
    action,
    userId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

/** Customer order history — identity strictly from the session. */
export async function getOrderHistoryAction(
  input: unknown,
): Promise<ActionResult<PaginatedOrders>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in." };
  const parsed = historyQuerySchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid pagination." };
  }
  const result = await listCustomerOrders(
    session.user.id,
    parsed.data.page,
    parsed.data.pageSize,
  );
  return { ok: true, data: result };
}

/** Customer order details — ownership enforced in the query. */
export async function getOrderDetailsAction(
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in." };
  const parsed = orderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  try {
    const detail = await getOrderDetail(parsed.data, { userId: session.user.id });
    return { ok: true, data: detail };
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { ok: false, error: "Order not found." };
    }
    logFailure("getOrderDetails", error, session.user.id);
    return { ok: false, error: "We couldn't load that order." };
  }
}

/**
 * Customer self-cancellation (BR-014: PENDING unpaid orders only).
 * Paid orders return an explicit escalation message — no refund is promised.
 * Idempotent: repeating a successful cancel succeeds quietly.
 */
export async function cancelCustomerOrderAction(
  input: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in." };
  const parsed = orderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  try {
    await cancelOrderAsCustomer(parsed.data, session.user.id);
    // Post-commit notice only; email failure never fails the cancellation.
    void dispatchOrderNotification(parsed.data, "order_cancelled").catch((error: unknown) =>
      logger.error("Cancel notification dispatch failed", {
        module: "orders",
        action: "cancelCustomerOrder",
        orderId: parsed.data,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return { ok: true, data: { orderId: parsed.data } };
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { ok: false, error: "Order not found." };
    }
    if (error instanceof InvalidOrderTransitionError) {
      return { ok: false, error: error.message };
    }
    logFailure("cancelCustomerOrder", error, session.user.id);
    return { ok: false, error: "We couldn't cancel that order." };
  }
}

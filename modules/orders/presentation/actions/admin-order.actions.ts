"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  getOrderDetail,
  listOrdersForAdmin,
  type OrderDetail,
  type PaginatedOrders,
} from "@/modules/orders/application/queries/orders";
import {
  deliverOrder,
  shipOrder,
} from "@/modules/orders/application/commands/order-transitions";
import { cancelOrder } from "@/modules/orders/application/commands/order-lifecycle";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";
import { OrderNotFoundError } from "@/modules/orders/domain/errors/order-errors";
import { InvalidOrderTransitionError } from "@/modules/orders/domain/errors/order-errors";
import {
  adminOrderFiltersSchema,
  cancelReasonSchema,
  orderIdSchema,
} from "@/modules/orders/presentation/schemas/order.schema";

/**
 * Staff order browser. `requireAdmin` enforces ADMIN/STAFF server-side —
 * the UI never decides authorization.
 */
export async function getAdminOrdersAction(
  input: unknown,
): Promise<ActionResult<PaginatedOrders>> {
  const session = await requireAdmin();
  const parsed = adminOrderFiltersSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  void session;
  const result = await listOrdersForAdmin(parsed.data);
  return { ok: true, data: result };
}

export async function getAdminOrderDetailsAction(
  input: unknown,
): Promise<ActionResult<OrderDetail>> {
  await requireAdmin();
  const parsed = orderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  try {
    const detail = await getOrderDetail(parsed.data, { admin: true });
    return { ok: true, data: detail };
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { ok: false, error: "Order not found." };
    }
    logger.error("Admin order details failed", {
      module: "orders",
      action: "getAdminOrderDetails",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "We couldn't load that order." };
  }
}

function staffFailure(action: string, error: unknown, userId?: string): ActionResult<never> {
  if (error instanceof OrderNotFoundError) {
    return { ok: false, error: "Order not found." };
  }
  if (error instanceof InvalidOrderTransitionError) {
    return { ok: false, error: error.message };
  }
  logger.error(`Admin order action failed: ${action}`, {
    module: "orders",
    action,
    userId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "That action could not be completed." };
}

/** PROCESSING → SHIPPED. Audited; customer notified post-commit. */
export async function shipOrderAction(
  input: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  const session = await requireAdmin();
  const parsed = orderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  try {
    await shipOrder(parsed.data, {
      actorId: session.user.id,
      actorType: session.user.role === "ADMIN" ? "admin" : "staff",
    });
    void dispatchOrderNotification(parsed.data, "order_shipped").catch(() => undefined);
    return { ok: true, data: { orderId: parsed.data } };
  } catch (error) {
    return staffFailure("shipOrder", error, session.user.id) as ActionResult<{ orderId: string }>;
  }
}

/** SHIPPED → DELIVERED. Audited; customer notified post-commit. */
export async function deliverOrderAction(
  input: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  const session = await requireAdmin();
  const parsed = orderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  try {
    await deliverOrder(parsed.data, {
      actorId: session.user.id,
      actorType: session.user.role === "ADMIN" ? "admin" : "staff",
    });
    void dispatchOrderNotification(parsed.data, "order_delivered").catch(() => undefined);
    return { ok: true, data: { orderId: parsed.data } };
  } catch (error) {
    return staffFailure("deliverOrder", error, session.user.id) as ActionResult<{ orderId: string }>;
  }
}

/**
 * Staff cancellation with a mandatory recorded reason. Paid orders keep
 * their payment state (cancelOrder preserves PAID/REFUNDED) — staff are
 * never given a "mark paid" control; money moves only via verified webhooks
 * and the (future) refund workflow.
 */
export async function cancelOrderAsStaffAction(
  input: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  const session = await requireAdmin();
  const parsed = staffCancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await cancelOrder(parsed.data.orderId, {
      actorId: session.user.id,
      actorType: session.user.role === "ADMIN" ? "admin" : "staff",
      eventType: "cancelled",
      reason: parsed.data.reason,
    });
    void dispatchOrderNotification(parsed.data.orderId, "order_cancelled").catch(() => undefined);
    return { ok: true, data: { orderId: parsed.data.orderId } };
  } catch (error) {
    return staffFailure("cancelOrderAsStaff", error, session.user.id) as ActionResult<{ orderId: string }>;
  }
}

const staffCancelSchema = z.object({
  orderId: orderIdSchema,
  reason: cancelReasonSchema,
});

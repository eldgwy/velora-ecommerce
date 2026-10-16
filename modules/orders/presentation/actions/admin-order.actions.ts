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
  let from: Date | undefined;
  let to: Date | undefined;
  try {
    if (parsed.data.from) from = new Date(`${parsed.data.from}T00:00:00Z`);
    if (parsed.data.to) to = new Date(`${parsed.data.to}T00:00:00Z`);
    if (from && to && from.getTime() >= to.getTime()) {
      return { ok: false, error: "Filter start date must precede the end date." };
    }
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return { ok: false, error: "Filter dates are invalid." };
    }
  } catch {
    return { ok: false, error: "Filter dates are invalid." };
  }
  const result = await listOrdersForAdmin({ ...parsed.data, from, to });
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

/**
 * Batch shipment (max 50 orders): sequential `shipOrder` per order so each
 * keeps its own transaction, audit row, and notification. Results are
 * per-order — successes, ineligible rows, and failures are reported
 * individually, never as a blanket success. Retries are safe: already
 * SHIPPED orders replay idempotently inside `shipOrder`.
 */
export async function shipOrdersBatchAction(
  input: unknown,
): Promise<
  ActionResult<{
    succeeded: Array<{ orderId: string }>;
    failed: Array<{ orderId: string; error: string }>;
  }>
> {
  const session = await requireAdmin();
  const parsed = z
    .object({ orderIds: z.array(orderIdSchema).min(1).max(50) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Select between 1 and 50 orders to ship." };
  }
  const actorType = session.user.role === "ADMIN" ? "admin" : "staff";
  const succeeded: Array<{ orderId: string }> = [];
  const failed: Array<{ orderId: string; error: string }> = [];
  for (const orderId of [...new Set(parsed.data.orderIds)]) {
    try {
      await shipOrder(orderId, { actorId: session.user.id, actorType });
      void dispatchOrderNotification(orderId, "order_shipped").catch(() => undefined);
      succeeded.push({ orderId });
    } catch (error) {
      if (error instanceof OrderNotFoundError) {
        failed.push({ orderId, error: "Order not found." });
      } else if (error instanceof InvalidOrderTransitionError) {
        failed.push({ orderId, error: error.message });
      } else {
        logger.error("Batch shipment failed for order", {
          module: "orders",
          action: "shipOrdersBatch",
          orderId,
          userId: session.user.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        failed.push({ orderId, error: "Shipment could not be completed." });
      }
    }
  }
  return { ok: true, data: { succeeded, failed } };
}

/**
 * Shipping manifest dataset for explicitly selected orders (admin-gated).
 * Eligibility is re-validated per order; ineligible selections are
 * reported, never silently dropped or included.
 */
export async function getShippingManifestAction(
  input: unknown,
): Promise<
  ActionResult<import("@/modules/orders/application/queries/orders").ShippingManifest>
> {
  await requireAdmin();
  const parsed = z
    .object({ orderIds: z.array(orderIdSchema).min(1).max(50) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Select between 1 and 50 orders." };
  const { getShippingManifest } = await import(
    "@/modules/orders/application/queries/orders"
  );
  const manifest = await getShippingManifest(parsed.data.orderIds);
  return { ok: true, data: manifest };
}

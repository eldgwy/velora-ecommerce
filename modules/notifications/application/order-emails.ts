import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { orderItems, orderNotifications, orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { sendMail } from "@/shared/lib/mail";
import { logger } from "@/shared/lib/logging/logger";
import {
  claimNotification,
  markNotificationSent,
  startNotificationDispatch,
} from "@/modules/orders/application/commands/order-transitions";
import { computeBackoffMs, sanitizeProviderError } from "@/modules/notifications/application/backoff";

export type OrderNotificationType =
  | "order_placed"
  | "payment_succeeded"
  | "payment_failed"
  | "order_cancelled"
  | "reservation_expired"
  | "order_shipped"
  | "order_delivered"
  | "refund_issued";

const SUBJECTS: Record<OrderNotificationType, string> = {
  order_placed: "Your VELORA order is confirmed",
  payment_succeeded: "Payment confirmed for your VELORA order",
  payment_failed: "There was a problem with your VELORA payment",
  order_cancelled: "Your VELORA order was cancelled",
  reservation_expired: "Your VELORA reservation expired",
  order_shipped: "Your VELORA order has shipped",
  order_delivered: "Your VELORA order was delivered",
  refund_issued: "A refund was issued for your VELORA order",
};

/**
 * Claim-once order emails. Call AFTER the corresponding state transition
 * commits (never inside the transaction — SMTP stays out of the DB tx).
 * The unique (order, type) claim makes webhook/job retries safe: only the
 * first claim wins and sends; everyone else skips silently. `SENT` is
 * recorded only after the provider accepts the message — delivery is never
 * claimed otherwise.
 */
export async function dispatchOrderNotification(
  orderId: string,
  type: OrderNotificationType,
): Promise<{ sent: boolean; reason?: string }> {
  const won = await claimNotification(orderId, type);
  if (!won) return { sent: false, reason: "already-handled" };

  // Lease the row for the SMTP call (T-3.4): QUEUED -> SENDING. A retry
  // worker claiming the row between our insert and this CAS wins — then we
  // skip instead of double-sending. A crash after this point leaves a
  // SENDING lease the worker reaps at expiry.
  const leased = await startNotificationDispatch(orderId, type);
  if (!leased) return { sent: false, reason: "already-handled" };

  const context = await loadNotificationContext(orderId);
  if (!context) return { sent: false, reason: "context-missing" };

  const subject = `${SUBJECTS[type]} — ${context.orderNumber}`;
  const { html, text } = renderOrderEmail(type, context);

  try {
    const info = await sendMail({ to: context.toEmail, subject, html, text });
    await markNotificationSent(
      orderId,
      type,
      (info as { messageId?: string } | undefined)?.messageId,
    );
  } catch (error) {
    // State transition already committed; schedule a bounded retry instead
    // of failing the caller. Never fail the caller (webhook/action) over email.
    await recordDeliveryFailure(orderId, type, error);
    logger.error("Order notification send failed", {
      module: "notifications",
      action: "orderEmailFailed",
      orderId,
      type,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { sent: false, reason: "provider-error" };
  }

  return { sent: true };
}

export interface NotificationContext {
  toEmail: string;
  toName: string;
  orderNumber: string;
  total: string;
  lines: Array<{ name: string; quantity: number; total: string }>;
}

/** Load recipient + snapshot content. No secrets leave with this object. */
export async function loadNotificationContext(
  orderId: string,
): Promise<NotificationContext | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const [owner] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, order.userId));
  if (!owner) return null;

  const lines = await db
    .select({
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      totalAmount: orderItems.totalAmount,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return {
    toEmail: owner.email,
    toName: owner.name,
    orderNumber: order.orderNumber,
    total: `${order.totalAmount} ${order.currency}`,
    lines: lines.map((l) => ({
      name: l.productName ?? "Item",
      quantity: l.quantity,
      total: l.totalAmount ?? "",
    })),
  };
}

/**
 * Record a failed attempt: bump attempts, schedule backoff, keep a safe
 * error prefix. The retry worker picks the row up when due.
 */
export async function recordDeliveryFailure(
  orderId: string,
  type: string,
  error: unknown,
): Promise<void> {
  const [row] = await db
    .select({ attempts: orderNotifications.attempts })
    .from(orderNotifications)
    .where(
      and(
        eq(orderNotifications.orderId, orderId),
        eq(orderNotifications.type, type),
      ),
    );
  const attempts = (row?.attempts ?? 0) + 1;
  await db
    .update(orderNotifications)
    .set({
      status: "QUEUED",
      attempts,
      nextRetryAt: new Date(Date.now() + computeBackoffMs(attempts)),
      lastError: sanitizeProviderError(error),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orderNotifications.orderId, orderId),
        eq(orderNotifications.type, type),
      ),
    );
}

export function renderOrderEmail(
  type: OrderNotificationType,
  data: {
    toName: string;
    orderNumber: string;
    total: string;
    lines: Array<{ name: string; quantity: number; total: string }>;
  },
): { html: string; text: string } {
  const bodies: Record<OrderNotificationType, string> = {
    order_placed: `Thank you — your order is confirmed and stock is reserved while payment completes.`,
    payment_succeeded: `Your payment cleared and your order is now being prepared.`,
    payment_failed: `Your payment did not go through and the reservation was released. You can check out again from your bag.`,
    order_cancelled: `Your order was cancelled and any held stock was released.`,
    reservation_expired: `Your checkout reservation expired before payment completed, so held stock was released. Start a new checkout when ready.`,
    order_shipped: `Good news — your order is on its way.`,
    order_delivered: `Your order was delivered. Enjoy, and consider leaving a review.`,
    refund_issued: `A refund was issued to your original payment method. It can take 5–10 business days to appear. Returned goods re-enter stock only after a verified return — never automatically.`,
  };
  const itemsHtml = data.lines
    .map((l) => `<li>${escapeHtml(l.name)} × ${l.quantity} — ${escapeHtml(l.total)}</li>`)
    .join("");
  const itemsText = data.lines.map((l) => `- ${l.name} × ${l.quantity} — ${l.total}`).join("\n");
  return {
    html: `<div><p>Hi ${escapeHtml(data.toName)},</p><p>${bodies[type]}</p><p><strong>Order ${escapeHtml(data.orderNumber)} · ${escapeHtml(data.total)}</strong></p><ul>${itemsHtml}</ul><p>— VELORA</p></div>`,
    text: `Hi ${data.toName},\n\n${bodies[type]}\n\nOrder ${data.orderNumber} · ${data.total}\n${itemsText}\n\n— VELORA`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

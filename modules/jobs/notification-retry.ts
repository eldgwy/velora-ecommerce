import { and, eq, lte, or, sql, isNull } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { orderNotifications } from "@/infrastructure/database/schema/orders";
import { sendMail } from "@/shared/lib/mail";
import { logger } from "@/shared/lib/logging/logger";
import {
  computeBackoffMs,
  retryConfigFromEnv,
  sanitizeProviderError,
} from "@/modules/notifications/application/backoff";
import {
  loadNotificationContext,
  renderOrderEmail,
  type OrderNotificationType,
} from "@/modules/notifications/application/order-emails";

export interface NotificationJobConfig {
  batchSize: number;
  maxAttempts: number;
  leaseMs: number;
}

export function defaultNotificationJobConfig(): NotificationJobConfig {
  const env = retryConfigFromEnv();
  return { batchSize: env.batchSize, maxAttempts: env.maxAttempts, leaseMs: env.leaseMs };
}

export interface NotificationRetryResult {
  notificationId: string;
  orderId: string;
  type: string;
  outcome: "sent" | "scheduled" | "failed" | "skipped";
}

export interface NotificationJobRunResult {
  processed: number;
  sent: number;
  scheduled: number;
  failed: number;
  skipped: number;
  results: NotificationRetryResult[];
  durationMs: number;
}

interface DueRow {
  id: string;
  orderId: string;
  type: string;
  attempts: number;
}

/**
 * Atomically claim one notification for this worker: only QUEUED rows whose
 * retry is due, or SENDING rows whose lease expired (crashed worker). The
 * single UPDATE...RETURNING serializes concurrent workers — exactly one
 * wins each row.
 */
async function claimDueRow(id: string, leaseCutoff: Date): Promise<DueRow | null> {
  const rows = (await db.execute(sql`
    UPDATE order_notifications
    SET status = 'SENDING',
        attempts = attempts + 1,
        updated_at = now()
    WHERE id = ${id}
      AND (
        status = 'QUEUED'
        OR (status = 'SENDING' AND updated_at < ${leaseCutoff.toISOString()})
      )
    RETURNING id, order_id AS "orderId", type, attempts
  `)) as unknown as Array<DueRow>;
  return rows[0] ?? null;
}

async function findDueNotifications(limit: number, leaseMs: number): Promise<DueRow[]> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - leaseMs);
  return db
    .select({
      id: orderNotifications.id,
      orderId: orderNotifications.orderId,
      type: orderNotifications.type,
      attempts: orderNotifications.attempts,
    })
    .from(orderNotifications)
    .where(
      and(
        or(
          and(
            eq(orderNotifications.status, "QUEUED"),
            or(
              isNull(orderNotifications.nextRetryAt),
              lte(orderNotifications.nextRetryAt, now),
            ),
          ),
          and(
            eq(orderNotifications.status, "SENDING"),
            lte(orderNotifications.updatedAt, leaseCutoff),
          ),
        ),
      ),
    )
    .orderBy(orderNotifications.nextRetryAt)
    .limit(limit);
}

const SUBJECTS: Record<string, string> = {
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
 * Process one notification end-to-end. SMTP stays outside every database
 * transaction; the claim (above) and the outcome write (below) are separate
 * short transactions, so a send never holds locks and a crash always leaves
 * either a lease to reap or a scheduled retry.
 */
export async function processNotificationRetry(
  notificationId: string,
  config: Partial<NotificationJobConfig> = {},
): Promise<NotificationRetryResult> {
  const { maxAttempts, leaseMs } = { ...defaultNotificationJobConfig(), ...config };
  const leaseCutoff = new Date(Date.now() - leaseMs);

  const claimed = await claimDueRow(notificationId, leaseCutoff);
  if (!claimed) {
    return { notificationId, orderId: "", type: "", outcome: "skipped" };
  }

  const context = await loadNotificationContext(claimed.orderId);
  if (!context) {
    // Order or owner gone: nothing to send to. Park as permanently failed
    // with a safe note (no PII beyond the fact of the missing link).
    await db
      .update(orderNotifications)
      .set({
        status: "FAILED",
        lastError: "notification context missing (order or owner deleted)",
        updatedAt: new Date(),
      })
      .where(eq(orderNotifications.id, claimed.id));
    return { notificationId: claimed.id, orderId: claimed.orderId, type: claimed.type, outcome: "failed" };
  }

  const type = claimed.type as OrderNotificationType;
  const { html, text } = renderOrderEmail(type, context);
  const subject = `${SUBJECTS[type] ?? "Your VELORA order update"} — ${context.orderNumber}`;

  try {
    const info = await sendMail({ to: context.toEmail, subject, html, text });
    await db
      .update(orderNotifications)
      .set({
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: (info as { messageId?: string } | undefined)?.messageId ?? null,
        lastError: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(eq(orderNotifications.id, claimed.id));
    return { notificationId: claimed.id, orderId: claimed.orderId, type: claimed.type, outcome: "sent" };
  } catch (error) {
    if (claimed.attempts >= maxAttempts) {
      await db
        .update(orderNotifications)
        .set({
          status: "FAILED",
          lastError: sanitizeProviderError(error),
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(eq(orderNotifications.id, claimed.id));
      logger.error("Notification retries exhausted", {
        module: "jobs",
        action: "notificationRetryExhausted",
        notificationId: claimed.id,
        orderId: claimed.orderId,
        type: claimed.type,
        attempts: claimed.attempts,
      });
      return { notificationId: claimed.id, orderId: claimed.orderId, type: claimed.type, outcome: "failed" };
    }
    await db
      .update(orderNotifications)
      .set({
        status: "QUEUED",
        lastError: sanitizeProviderError(error),
        nextRetryAt: new Date(Date.now() + computeBackoffMs(claimed.attempts)),
        updatedAt: new Date(),
      })
      .where(eq(orderNotifications.id, claimed.id));
    return { notificationId: claimed.id, orderId: claimed.orderId, type: claimed.type, outcome: "scheduled" };
  }
}

export async function processNotificationRetries(
  config: Partial<NotificationJobConfig> = {},
): Promise<NotificationJobRunResult> {
  const full = { ...defaultNotificationJobConfig(), ...config };
  const startTime = Date.now();
  const runId = `notif-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  logger.info("Starting notification retry job", {
    module: "jobs",
    action: "processNotificationRetries",
    runId,
    batchSize: full.batchSize,
  });

  const due = await findDueNotifications(full.batchSize, full.leaseMs);
  const results: NotificationRetryResult[] = [];
  let sent = 0;
  let scheduled = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of due) {
    const result = await processNotificationRetry(row.id, full);
    results.push(result);
    if (result.outcome === "sent") sent += 1;
    else if (result.outcome === "scheduled") scheduled += 1;
    else if (result.outcome === "failed") failed += 1;
    else skipped += 1;
  }

  const durationMs = Date.now() - startTime;
  logger.info("Notification retry job completed", {
    module: "jobs",
    action: "processNotificationRetries",
    runId,
    processed: results.length,
    sent,
    scheduled,
    failed,
    skipped,
    durationMs,
  });

  return { processed: results.length, sent, scheduled, failed, skipped, results, durationMs };
}

/**
 * Internal API handler, protected by the same CRON_SECRET bearer pattern as
 * the reservation-expiry endpoint.
 */
export async function handleNotificationRetryRequest(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized attempt to access notification retry endpoint", {
      module: "jobs",
      action: "handleNotificationRetryRequest",
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await processNotificationRetries();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    logger.error("Notification retry job failed", {
      module: "jobs",
      action: "handleNotificationRetryRequest",
      error: errorMessage,
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

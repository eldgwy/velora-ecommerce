import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { orders } from "@/infrastructure/database/schema/orders";
import { orderStatusEnum, orderReservationStatusEnum } from "@/infrastructure/database/schema/enums";
import { logger } from "@/shared/lib/logging/logger";
import { handleCheckoutExpiration } from "@/modules/orders/application/commands/order-lifecycle";

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type OrderReservationStatus = (typeof orderReservationStatusEnum.enumValues)[number];

export interface ExpiredReservationJobConfig {
  batchSize: number;
  maxRetries: number;
  retryDelayMs: number;
}

export const DEFAULT_JOB_CONFIG: ExpiredReservationJobConfig = {
  batchSize: 100,
  maxRetries: 3,
  retryDelayMs: 5000,
};

export interface ExpiredOrderResult {
  orderId: string;
  success: boolean;
  error?: string;
}

export interface JobRunResult {
  processed: number;
  succeeded: number;
  failed: number;
  results: ExpiredOrderResult[];
  durationMs: number;
}

/**
 * Find orders with expired checkout that still have active reservations.
 * 
 * Returns orders that:
 * - Have a checkoutExpiresAt in the past
 * - Are in PENDING or PROCESSING status
 * - Have paymentStatus not in terminal states (PAID, REFUNDED, PARTIALLY_REFUNDED)
 * - Have at least one order item with RESERVED status
 */
export async function findExpiredOrdersWithReservations(
  limit: number,
): Promise<Array<{ id: string; checkoutExpiresAt: Date | null }>> {
  const now = new Date().toISOString();

  const expiredOrders = await db.execute(sql`
    SELECT o.id, o.checkout_expires_at AS "checkoutExpiresAt"
    FROM orders AS o
    WHERE o.checkout_expires_at IS NOT NULL
      AND o.checkout_expires_at <= ${now}
      AND o.status IN ('PENDING', 'PROCESSING')
      AND o.payment_status NOT IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')
      AND EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.reservation_status = 'RESERVED'
      )
    ORDER BY o.checkout_expires_at ASC
    LIMIT ${limit}
  `) as Array<{ id: string; checkoutExpiresAt: Date | null }>;

  return expiredOrders;
}

/**
 * Process a single expired order by releasing its reservations.
 * Uses the shared handleCheckoutExpiration operation which is idempotent
 * and safe for concurrent invocation.
 */
export async function processExpiredOrder(
  orderId: string,
  options: { actorId?: string; requestId?: string } = {},
): Promise<ExpiredOrderResult> {
  const requestId = options.requestId ?? `expire-${orderId}-${Date.now()}`;

  try {
    await handleCheckoutExpiration(orderId, {
      actorId: options.actorId ?? "expired-reservation-worker",
      requestId,
      reason: "Checkout expired",
    });

    logger.info("Expired order processed successfully", {
      module: "jobs",
      action: "processExpiredOrder",
      orderId,
      requestId,
    });

    return { orderId, success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error("Failed to process expired order", {
      module: "jobs",
      action: "processExpiredOrder",
      orderId,
      requestId,
      error: errorMessage,
    });

    return { orderId, success: false, error: errorMessage };
  }
}

/**
 * Process expired reservations in batches with retry logic.
 * 
 * This function:
 * - Finds expired orders with active reservations (up to batchSize)
 * - Processes each order using the shared release operation
 * - Retries failed orders up to maxRetries times
 * - Continues processing remaining orders even if some fail
 * - Returns a summary of the job run
 */
export async function processExpiredReservations(
  config: Partial<ExpiredReservationJobConfig> = {},
): Promise<JobRunResult> {
  const { batchSize, maxRetries, retryDelayMs } = {
    ...DEFAULT_JOB_CONFIG,
    ...config,
  };

  const startTime = Date.now();
  const runId = `expire-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  logger.info("Starting expired reservation processing job", {
    module: "jobs",
    action: "processExpiredReservations",
    runId,
    batchSize,
    maxRetries,
  });

  // Find expired orders with reservations
  const expiredOrders = await findExpiredOrdersWithReservations(batchSize);

  if (expiredOrders.length === 0) {
    logger.info("No expired reservations to process", {
      module: "jobs",
      action: "processExpiredReservations",
      runId,
    });

    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      durationMs: Date.now() - startTime,
    };
  }

  logger.info(`Found ${expiredOrders.length} expired orders with active reservations`, {
    module: "jobs",
    action: "processExpiredReservations",
    runId,
    count: expiredOrders.length,
  });

  const results: ExpiredOrderResult[] = [];
  let succeeded = 0;
  let failed = 0;

  // Process each order with retry logic
  for (const order of expiredOrders) {
    let attempt = 0;
    let lastResult: ExpiredOrderResult = { orderId: order.id, success: false, error: "Not attempted" };

    while (attempt <= maxRetries) {
      if (attempt > 0) {
        // Wait before retry with exponential backoff
        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));

        logger.info("Retrying expired order processing", {
          module: "jobs",
          action: "processExpiredReservations",
          runId,
          orderId: order.id,
          attempt,
        });
      }

      lastResult = await processExpiredOrder(order.id, { requestId: `${runId}-${order.id}-attempt-${attempt}` });

      if (lastResult.success) {
        succeeded++;
        break;
      }

      attempt++;
    }

    if (!lastResult.success) {
      failed++;
    }

    results.push(lastResult);
  }

  const durationMs = Date.now() - startTime;

  logger.info("Expired reservation processing job completed", {
    module: "jobs",
    action: "processExpiredReservations",
    runId,
    processed: results.length,
    succeeded,
    failed,
    durationMs,
  });

  return {
    processed: results.length,
    succeeded,
    failed,
    results,
    durationMs,
  };
}

/**
 * Internal API handler for the expired reservation worker endpoint.
 * Protected by CRON_SECRET authentication.
 */
export async function handleExpiredReservationsRequest(
  request: Request,
  config: Partial<ExpiredReservationJobConfig> = {},
): Promise<Response> {
  // Verify cron secret for authentication
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized attempt to access expired reservations endpoint", {
      module: "jobs",
      action: "handleExpiredReservationsRequest",
    });

    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await processExpiredReservations(config);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    logger.error("Expired reservations job failed", {
      module: "jobs",
      action: "handleExpiredReservationsRequest",
      error: errorMessage,
    });

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Standalone worker function that can be run as a scheduled process.
 * This is the entry point for cron/job runners.
 */
export async function runExpiredReservationsWorker(
  config: Partial<ExpiredReservationJobConfig> = {},
): Promise<void> {
  const result = await processExpiredReservations(config);

  if (result.failed > 0) {
    const failedOrders = result.results.filter((r) => !r.success).map((r) => r.orderId).join(", ");
    throw new Error(`Expired reservation worker completed with ${result.failed} failures: ${failedOrders}`);
  }
}

export { releaseOrderReservation } from "@/modules/orders/application/commands/reserve-order-inventory";
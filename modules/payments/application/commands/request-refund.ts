import { and, eq, sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/infrastructure/database";
import {
  orders,
  orderStatusHistories,
  payments,
  refunds,
} from "@/infrastructure/database/schema/orders";
import {
  OrderNotFoundError,
  InvalidOrderTransitionError,
} from "@/modules/orders/domain/errors/order-errors";

export interface RefundRequest {
  orderId: string;
  /** Minor units. Defaults to the full remaining refundable amount. */
  amountCents?: number;
  reason: string;
  actorId: string;
  actorType?: "admin" | "staff";
}

export interface RefundResult {
  refundId: string;
  orderId: string;
  paymentId: string;
  amountCents: number;
  status: "COMPLETED" | "PENDING";
  providerRefundId: string | null;
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

function sanitizeStripeMessage(message: string): string {
  return message.slice(0, 200);
}

/**
 * Minimal admin refund workflow (SRS FR-11, BR-007).
 *
 * - Only against a COMPLETED payment; cumulative COMPLETED refunds never
 *   exceed the captured amount (checked under a payment-row lock, so
 *   concurrent requests cannot overshoot).
 * - Duplicate requests: an identical PENDING row (same payment + amount) is
 *   returned instead of duplicated; the Stripe call carries a deterministic
 *   idempotency key (`refund-{paymentId}-{amountCents}`), so even a race
 *   that slips past the local check settles to one Stripe refund.
 * - Stripe runs OUTSIDE every database transaction. PENDING → COMPLETED /
 *   FAILED transitions happen in short follow-up transactions.
 * - Inventory is NEVER restocked by a refund. Returned goods re-enter stock
 *   only through the verified-return path (`restockReturn`), which is a
 *   separate, explicitly authorized step.
 * - No Stripe key configured → blocked with a clear error (documented
 *   production requirement), never a silent no-op.
 */
export async function requestRefund(request: RefundRequest): Promise<RefundResult> {
  if (!request.reason || request.reason.trim().length === 0) {
    throw new InvalidOrderTransitionError("A refund reason is required.");
  }

  const stripe = stripeClient();
  if (!stripe) {
    throw new InvalidOrderTransitionError(
      "Card refunds are not configured (missing Stripe key).",
    );
  }

  // TxA: lock the payment, validate, and stage a PENDING refund.
  const staged = await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT p.id AS "paymentId", p.order_id AS "orderId",
             p.provider AS "provider", p.provider_payment_id AS "providerPaymentId",
             p.amount AS "amount", p.status AS "status",
             o.status AS "orderStatus", o.payment_status AS "orderPaymentStatus"
      FROM payments AS p
      JOIN orders AS o ON o.id = p.order_id
      WHERE p.order_id = ${request.orderId}
      FOR UPDATE OF p
    `)) as Array<{
      paymentId: string;
      orderId: string;
      provider: string | null;
      providerPaymentId: string | null;
      amount: string | null;
      status: string | null;
      orderStatus: string;
      orderPaymentStatus: string | null;
    }>;
    const payment = rows[0];
    if (!payment) throw new OrderNotFoundError(request.orderId);
    if (payment.status !== "COMPLETED") {
      throw new InvalidOrderTransitionError(
        "Refunds are only available for completed payments.",
      );
    }
    if (!payment.providerPaymentId || payment.provider !== "stripe") {
      throw new InvalidOrderTransitionError(
        "Only Stripe card payments can be refunded here.",
      );
    }

    const capturedCents = Math.round(Number(payment.amount) * 100);
    const prior = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(
        and(eq(refunds.paymentId, payment.paymentId), eq(refunds.status, "COMPLETED")),
      );
    const refundedCents = prior.reduce(
      (s, r) => s + Math.round(Number(r.amount) * 100),
      0,
    );
    const remaining = capturedCents - refundedCents;
    if (remaining <= 0) {
      throw new InvalidOrderTransitionError("Nothing remains refundable on this payment.");
    }

    const amountCents = request.amountCents ?? remaining;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remaining) {
      throw new InvalidOrderTransitionError(
        `Refund amount must be between 1 and ${remaining} (minor units).`,
      );
    }

    // Idempotent replay of an in-flight identical request.
    const [pending] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.paymentId, payment.paymentId),
          eq(refunds.status, "PENDING"),
          eq(refunds.amount, (amountCents / 100).toFixed(2)),
        ),
      );
    if (pending) {
      return { refundId: pending.id, amountCents, replayed: true as const, payment };
    }

    const [created] = await tx
      .insert(refunds)
      .values({
        paymentId: payment.paymentId,
        amount: (amountCents / 100).toFixed(2),
        reason: request.reason.trim().slice(0, 500),
        status: "PENDING",
      })
      .returning({ id: refunds.id });
    if (!created) throw new Error("Refund insert failed");
    return { refundId: created.id, amountCents, replayed: false as const, payment };
  });

  // A twin owns this attempt (identical PENDING row): never mint a second
  // Stripe refund. Wait briefly for the twin's outcome instead.
  if (staged.replayed) {
    return await awaitTwinRefund(staged.refundId, request.orderId, staged.payment.paymentId, staged.amountCents);
  }

  // Stripe call outside the transaction.
  let stripeRefund: Stripe.Refund;
  try {
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: staged.payment.providerPaymentId!,
        amount: staged.amountCents,
        reason: "requested_by_customer",
        metadata: { orderId: request.orderId, paymentId: staged.payment.paymentId },
      },
      { idempotencyKey: `refund-${staged.payment.paymentId}-${staged.amountCents}` },
    );
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx
        .update(refunds)
        .set({
          status: "FAILED",
          reason: sanitizeStripeMessage(
            `${request.reason.trim().slice(0, 300)} | provider: ${
              error instanceof Error ? error.message : "unknown"
            }`.slice(0, 500),
          ),
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, staged.refundId));
    });
    throw new InvalidOrderTransitionError(
      "The refund was rejected by the payment provider. No money moved; try again.",
    );
  }

  // TxB: record success, recompute capped status, audit.
  await db.transaction(async (tx) => {
    await tx
      .update(refunds)
      .set({
        status: "COMPLETED",
        providerRefundId: stripeRefund.id,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, staged.refundId));

    const all = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(
        and(eq(refunds.paymentId, staged.payment.paymentId), eq(refunds.status, "COMPLETED")),
      );
    const totalCents = all.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    const capturedCents = Math.round(Number(staged.payment.amount) * 100);
    await tx
      .update(orders)
      .set({
        paymentStatus: totalCents >= capturedCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, request.orderId));

    const [order] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, request.orderId));
    await tx.insert(orderStatusHistories).values({
      orderId: request.orderId,
      status: order!.status as typeof orders.status.enumValues[number],
      previousStatus: order!.status as typeof orders.status.enumValues[number],
      eventType: "refund_issued",
      actorType: request.actorType ?? "admin",
      actorId: request.actorId,
      correlationId: staged.refundId,
      note: `Refund ${(staged.amountCents / 100).toFixed(2)} issued (${stripeRefund.id})`,
    });
  });

  return {
    refundId: staged.refundId,
    orderId: request.orderId,
    paymentId: staged.payment.paymentId,
    amountCents: staged.amountCents,
    status: "COMPLETED",
    providerRefundId: stripeRefund.id,
  };
}

/**
 * Follow a twin-owned refund attempt to its conclusion without issuing a
 * second Stripe call. Polls briefly (the twin completes in milliseconds);
 * on timeout returns the PENDING row so the caller can retry later, and on
 * twin failure surfaces a retryable error (the FAILED row stays terminal,
 * the next attempt stages fresh).
 */
async function awaitTwinRefund(
  refundId: string,
  orderId: string,
  paymentId: string,
  amountCents: number,
  deadlineMs = 10_000,
): Promise<RefundResult> {
  const started = Date.now();
  for (;;) {
    const [row] = await db
      .select({ status: refunds.status, providerRefundId: refunds.providerRefundId })
      .from(refunds)
      .where(eq(refunds.id, refundId));
    if (!row) throw new OrderNotFoundError(orderId);
    if (row.status === "COMPLETED") {
      return {
        refundId,
        orderId,
        paymentId,
        amountCents,
        status: "COMPLETED",
        providerRefundId: row.providerRefundId,
      };
    }
    if (row.status === "FAILED") {
      throw new InvalidOrderTransitionError(
        "The concurrent refund attempt failed. Start a new refund request to retry.",
      );
    }
    if (Date.now() - started > deadlineMs) {
      return {
        refundId,
        orderId,
        paymentId,
        amountCents,
        status: "PENDING",
        providerRefundId: null,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Reconcile a `charge.refunded` webhook event without trusting it blindly.
 * The charge object carries the running `amount_refunded` total; local
 * COMPLETED rows are converged up to that total (idempotent), and an
 * over-report is logged as an anomaly instead of deleting records.
 * Never touches inventory.
 */
export async function reconcileRefundEvent(input: {
  paymentIntentId: string;
  chargeId: string;
  amountRefundedCents: number;
}): Promise<{ reconciled: boolean; reason: string }> {
  const [payment] = await db
    .select({ id: payments.id, orderId: payments.orderId, amount: payments.amount })
    .from(payments)
    .where(eq(payments.providerPaymentId, input.paymentIntentId));
  if (!payment) {
    return { reconciled: false, reason: "unknown-payment-intent" };
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: refunds.id, amount: refunds.amount, providerRefundId: refunds.providerRefundId })
      .from(refunds)
      .where(
        and(eq(refunds.paymentId, payment.id), eq(refunds.status, "COMPLETED")),
      );
    const localCents = rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    if (localCents >= input.amountRefundedCents) {
      return { reconciled: false, reason: "already-recorded" };
    }

    const missing = input.amountRefundedCents - localCents;
    const capturedCents = Math.round(Number(payment.amount) * 100);
    if (localCents + missing > capturedCents) {
      // Provider reports more than captured: record nothing, flag loudly.
      const { logger } = await import("@/shared/lib/logging/logger");
      logger.error("Refund reconciliation over-report", {
        module: "payments",
        action: "reconcileRefundEvent",
        orderId: payment.orderId,
        paymentId: payment.id,
        reportedCents: input.amountRefundedCents,
        capturedCents,
      });
      return { reconciled: false, reason: "exceeds-captured" };
    }

    await tx.insert(refunds).values({
      paymentId: payment.id,
      providerRefundId: `stripe-reconcile-${input.chargeId}`,
      amount: (missing / 100).toFixed(2),
      reason: "Reconciled from charge.refunded webhook",
      status: "COMPLETED",
    });
    const [order] = await tx
      .select({ status: orders.status, paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, payment.orderId));
    await tx
      .update(orders)
      .set({
        paymentStatus: localCents + missing >= capturedCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, payment.orderId));
    await tx.insert(orderStatusHistories).values({
      orderId: payment.orderId,
      status: order!.status as typeof orders.status.enumValues[number],
      previousStatus: order!.status as typeof orders.status.enumValues[number],
      eventType: "refund_reconciled",
      actorType: "webhook",
      actorId: input.chargeId,
      correlationId: input.chargeId,
      note: `Reconciled ${(missing / 100).toFixed(2)} from provider event`,
    });
    return { reconciled: true, reason: "recorded" };
  });
}

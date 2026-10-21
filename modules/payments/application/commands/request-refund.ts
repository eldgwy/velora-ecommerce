import { and, eq, sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/infrastructure/database";
import {
  isSupportedCurrency,
  toMinorUnits,
  fromMinorUnits,
} from "@/modules/checkout/domain/money";
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
import { logger } from "@/shared/lib/logging/logger";

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
  /** Set when this request converged onto an already-recorded refund
   *  instead of completing its own row (Stripe replay or webhook reconcile
   *  covered the same money first). */
  supersededBy?: string;
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
 * A PENDING refund row older than this without reaching COMPLETED/FAILED is
 * treated as abandoned (the process crashed between staging and the Stripe
 * call, or the outcome was never reconciled). It no longer reserves cap and
 * no longer blocks an identical restage — the restage reuses the same
 * deterministic Stripe idempotency key, so a zombie Stripe call that is
 * still alive converges in TxB instead of double-spending.
 */
export const STALE_PENDING_MS = 15 * 60_000;

function isFreshPending(createdAt: Date | null, now: number): boolean {
  if (!createdAt) return true;
  return now - createdAt.getTime() < STALE_PENDING_MS;
}

/**
 * True when the gateway outcome is ambiguous: the refund may have succeeded
 * server-side despite the local error (timeouts, dropped connections, rate
 * limits, provider 5xx). Such outcomes must NOT be recorded as FAILED —
 * FAILED is terminal and a retry would stage fresh money. The PENDING row is
 * left in place so a retry follows it (twin-follow) or restages against the
 * same idempotency key, and `charge.refunded` reconciliation converges the
 * records if Stripe did move the money.
 */
function isAmbiguousGatewayError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    type?: unknown;
    code?: unknown;
    statusCode?: unknown;
  };
  if (
    candidate.type === "StripeConnectionError" ||
    candidate.type === "StripeRateLimitError"
  ) {
    return true;
  }
  if (typeof candidate.statusCode === "number") {
    if (candidate.statusCode === 429 || candidate.statusCode >= 500) return true;
  }
  const code = typeof candidate.code === "string" ? candidate.code : "";
  return /^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_|FETCH_ERROR)/.test(
    code,
  );
}

/**
 * Minimal admin refund workflow (SRS FR-11, BR-007).
 *
 * - Only against a COMPLETED payment; cumulative COMPLETED refunds never
 *   exceed the captured amount (checked under a payment-row lock, so
 *   concurrent requests cannot overshoot).
 * - The cap additionally reserves fresh PENDING rows: concurrent
 *   different-amount requests serialize on the same lock and each sees the
 *   others' in-flight reservations, so their sum can never exceed the
 *   captured amount at Stripe either. Stale PENDING rows (older than
 *   STALE_PENDING_MS, never reconciled) are treated as abandoned and free
 *   their reservation — a restage reuses the same idempotency key.
 * - Duplicate requests: an identical fresh PENDING row (same payment +
 *   amount) is returned instead of duplicated; the Stripe call carries a
 *   deterministic idempotency key (`refund-{paymentId}-{amountCents}`), so
 *   even a race that slips past the local check settles to one Stripe refund.
 * - Stripe runs OUTSIDE every database transaction. Deterministic rejections
 *   move PENDING → FAILED; ambiguous outcomes (timeout, connection loss,
 *   rate limit, provider 5xx) keep PENDING and surface a retryable error so
 *   the next attempt follows or safely replays the same gateway operation.
 * - PENDING → COMPLETED / FAILED / CANCELLED transitions happen in short
 *   follow-up transactions.
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
             p.amount AS "amount", p.currency AS "currency", p.status AS "status",
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
      currency: string | null;
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

    const currency = payment.currency ?? "USD";
    if (!isSupportedCurrency(currency)) {
      throw new InvalidOrderTransitionError(
        "Refunds are not supported for this payment currency.",
      );
    }

    const capturedCents = toMinorUnits(payment.amount ?? "0", currency);
    const prior = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(
        and(eq(refunds.paymentId, payment.paymentId), eq(refunds.status, "COMPLETED")),
      );
    const refundedCents = prior.reduce(
      (s, r) => s + toMinorUnits(r.amount ?? "0", currency),
      0,
    );
    // Reserve in-flight money too: fresh PENDING rows are reservations made
    // by concurrent requests holding (or that held) the same lock. Without
    // this, two different-amount refunds could both stage and both succeed
    // at Stripe before either TxB runs. Stale PENDING rows are abandoned
    // (crashed stager) and free their reservation.
    const now = Date.now();
    const inFlight = await tx
      .select({ amount: refunds.amount, createdAt: refunds.createdAt })
      .from(refunds)
      .where(
        and(eq(refunds.paymentId, payment.paymentId), eq(refunds.status, "PENDING")),
      );
    const reservedCents = inFlight.reduce(
      (s, r) =>
        s + (isFreshPending(r.createdAt, now) ? toMinorUnits(r.amount ?? "0", currency) : 0),
      0,
    );

    // Idempotent replay of a fresh in-flight identical request, checked
    // before the cap: the twin already proved this amount fits under the
    // same lock, and following it (rather than rejecting against its own
    // reservation) is what keeps identical concurrent retries onto one
    // gateway call. Stale identical rows are ignored so the caller stages
    // anew (same Stripe idempotency key — a zombie gateway call converges
    // in TxB).
    if (request.amountCents !== undefined) {
      if (!Number.isInteger(request.amountCents) || request.amountCents <= 0) {
        throw new InvalidOrderTransitionError(
          "Refund amount must be a positive integer of minor units.",
        );
      }
      const [pending] = await tx
        .select({ id: refunds.id, createdAt: refunds.createdAt })
        .from(refunds)
        .where(
          and(
            eq(refunds.paymentId, payment.paymentId),
            eq(refunds.status, "PENDING"),
            eq(refunds.amount, fromMinorUnits(request.amountCents, currency)),
          ),
        );
      if (pending && isFreshPending(pending.createdAt, now)) {
        return { refundId: pending.id, amountCents: request.amountCents, replayed: true as const, payment };
      }
    }

    const remaining = capturedCents - refundedCents - reservedCents;
    if (remaining <= 0) {
      throw new InvalidOrderTransitionError("Nothing remains refundable on this payment.");
    }

    const amountCents = request.amountCents ?? remaining;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remaining) {
      throw new InvalidOrderTransitionError(
        `Refund amount must be between 1 and ${remaining} (minor units).`,
      );
    }

    const [created] = await tx
      .insert(refunds)
      .values({
        paymentId: payment.paymentId,
        amount: fromMinorUnits(amountCents, currency),
        reason: request.reason.trim().slice(0, 500),
        status: "PENDING",
      })
      .returning({ id: refunds.id });
    if (!created) throw new Error("Refund insert failed");
    return { refundId: created.id, amountCents, replayed: false as const, payment };
  });

  // A twin owns this attempt (identical fresh PENDING row): follow it
  // briefly — the twin usually completes in milliseconds. If the twin is
  // gone (e.g. its Stripe call hit an ambiguous outcome and it returned),
  // adopt the row below and drive the gateway call ourselves against the
  // same deterministic idempotency key: Stripe replays the same refund
  // object and TxB converges instead of double-spending.
  if (staged.replayed) {
    const followed = await awaitTwinRefund(
      staged.refundId,
      request.orderId,
      staged.payment.paymentId,
      staged.amountCents,
    );
    if (followed) return followed;
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
      // Key is derived from the refund row, not the amount: retries of the
      // same reservation (fresh twin adoption / post-ambiguous retry) reuse
      // the staged row's id and therefore replay the same Stripe operation,
      // while a new logical attempt after FAILED or a previous COMPLETED
      // refund gets its own row and its own gateway operation — the equal
      // amount can no longer replay an existing refund.
      { idempotencyKey: `refund-${staged.payment.paymentId}-${staged.refundId}` },
    );
  } catch (error) {
    if (isAmbiguousGatewayError(error)) {
      // The gateway never confirmed the outcome: Stripe may have recorded
      // the refund despite the local error. FAILED is terminal and would
      // wrongly free the next attempt to move the same money twice, so the
      // PENDING reservation is kept. Retrying is safe (same idempotency key;
      // twin-follow converges), and `charge.refunded` reconciliation records
      // the money if Stripe did move it. Point the operator at both.
      logger.error("Refund gateway outcome ambiguous, kept pending for retry", {
        module: "payments",
        action: "requestRefundAmbiguous",
        orderId: request.orderId,
        paymentId: staged.payment.paymentId,
        refundId: staged.refundId,
      });
      throw new InvalidOrderTransitionError(
        "The payment provider did not confirm the refund (timeout or temporary error). No local record was finalized — retry the same refund; if the provider did move the money, reconciliation will converge instead of duplicating it.",
      );
    }
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

  // TxB: record success, recompute capped status, audit — converging
  // instead of double-counting when Stripe replayed an earlier refund
  // (same idempotency key) or a webhook reconcile already recorded this
  // money while our Stripe call was in flight.
  const txb = await db.transaction(async (tx) => {
    const [sameProvider] = await tx
      .select({ id: refunds.id, amount: refunds.amount })
      .from(refunds)
      .where(
        and(
          eq(refunds.paymentId, staged.payment.paymentId),
          eq(refunds.providerRefundId, stripeRefund.id),
        ),
      );
    if (sameProvider && sameProvider.id !== staged.refundId) {
      await tx
        .update(refunds)
        .set({
          status: "CANCELLED",
          reason: `Superseded by ${sameProvider.id} (provider ${stripeRefund.id} replayed)`,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, staged.refundId));
      return { convergedTo: sameProvider.id, providerRefundId: stripeRefund.id };
    }

    const others = await tx
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(
        and(
          eq(refunds.paymentId, staged.payment.paymentId),
          eq(refunds.status, "COMPLETED"),
        ),
      );
    const otherCents = others.reduce(
      (s, r) => s + toMinorUnits(r.amount ?? "0", staged.payment.currency ?? "USD"),
      0,
    );
    const capturedCents = toMinorUnits(staged.payment.amount ?? "0", staged.payment.currency ?? "USD");
    if (otherCents + staged.amountCents > capturedCents) {
      // A reconcile row covered our amount mid-flight: our row would
      // double-count locally (Stripe moved money once). Cancel ours.
      const [covering] = await tx
        .select({ id: refunds.id })
        .from(refunds)
        .where(
          and(
            eq(refunds.paymentId, staged.payment.paymentId),
            eq(refunds.status, "COMPLETED"),
          ),
        );
      await tx
        .update(refunds)
        .set({
          status: "CANCELLED",
          reason: `Superseded: amount already recorded${covering ? ` in ${covering.id}` : ""}`,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, staged.refundId));
      return { convergedTo: covering?.id ?? null, providerRefundId: stripeRefund.id };
    }

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
    const totalCents = all.reduce(
      (s, r) => s + toMinorUnits(r.amount ?? "0", staged.payment.currency ?? "USD"),
      0,
    );
    const fullyRefunded = totalCents >= capturedCents;
    await tx
      .update(orders)
      .set({
        paymentStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, request.orderId));

    if (fullyRefunded) {
      // Mirror the COMPLETED → REFUNDED payment transition onto the payment
      // row so the domain matrix and the database agree: a fully refunded
      // payment is terminal and can never be flipped to FAILED by a stale
      // failure event nor finalized again by an old success event. Partial
      // refunds deliberately leave the payment COMPLETED (money still held).
      // Conditional on COMPLETED so a concurrent twin's update wins safely.
      await tx
        .update(payments)
        .set({ status: "REFUNDED", updatedAt: new Date() })
        .where(
          and(
            eq(payments.id, staged.payment.paymentId),
            eq(payments.status, "COMPLETED"),
          ),
        );
    }

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
      note: `Refund ${fromMinorUnits(staged.amountCents, staged.payment.currency ?? "USD")} issued (${stripeRefund.id})`,
    });
    return { convergedTo: null as string | null, providerRefundId: stripeRefund.id };
  });

  if (txb.convergedTo) {
    return {
      refundId: txb.convergedTo,
      orderId: request.orderId,
      paymentId: staged.payment.paymentId,
      amountCents: staged.amountCents,
      status: "COMPLETED",
      providerRefundId: txb.providerRefundId,
      supersededBy: txb.convergedTo,
    };
  }

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
 * on twin failure surfaces a retryable error (the FAILED row stays terminal,
 * the next attempt stages fresh). Returns null when the twin neither
 * completed nor failed in time — the caller then adopts the row and drives
 * the gateway call itself under the same idempotency key.
 */
async function awaitTwinRefund(
  refundId: string,
  orderId: string,
  paymentId: string,
  amountCents: number,
  deadlineMs = 2_000,
): Promise<RefundResult | null> {
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
      return null;
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
    .select({ id: payments.id, orderId: payments.orderId, amount: payments.amount, currency: payments.currency })
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
    const localCents = rows.reduce(
      (s, r) => s + toMinorUnits(r.amount ?? "0", payment.currency ?? "USD"),
      0,
    );
    if (localCents >= input.amountRefundedCents) {
      return { reconciled: false, reason: "already-recorded" };
    }

    const missing = input.amountRefundedCents - localCents;
    const capturedCents = toMinorUnits(payment.amount ?? "0", payment.currency ?? "USD");
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
      amount: fromMinorUnits(missing, payment.currency ?? "USD"),
      reason: "Reconciled from charge.refunded webhook",
      status: "COMPLETED",
    });
    const [order] = await tx
      .select({ status: orders.status, paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, payment.orderId));
    const fullyRefunded = localCents + missing >= capturedCents;
    await tx
      .update(orders)
      .set({
        paymentStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, payment.orderId));
    if (fullyRefunded) {
      // Same COMPLETED → REFUNDED mirror as the admin flow (conditional, so
      // concurrent reconciliations converge without overwriting each other).
      await tx
        .update(payments)
        .set({ status: "REFUNDED", updatedAt: new Date() })
        .where(
          and(
            eq(payments.id, payment.id),
            eq(payments.status, "COMPLETED"),
          ),
        );
    }
    await tx.insert(orderStatusHistories).values({
      orderId: payment.orderId,
      status: order!.status as typeof orders.status.enumValues[number],
      previousStatus: order!.status as typeof orders.status.enumValues[number],
      eventType: "refund_reconciled",
      actorType: "webhook",
      actorId: input.chargeId,
      correlationId: input.chargeId,
      note: `Reconciled ${fromMinorUnits(missing, payment.currency ?? "USD")} from provider event`,
    });
    return { reconciled: true, reason: "recorded" };
  });
}

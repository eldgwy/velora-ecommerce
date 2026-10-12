import { and, eq } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/infrastructure/database";
import { orders, payments } from "@/infrastructure/database/schema/orders";
import {
  OrderNotFoundError,
  PaymentInitError,
} from "@/modules/checkout/domain/errors";

export interface PaymentInitResult {
  paymentId: string;
  provider: "stripe" | "cod";
  status: "PENDING" | "AUTHORIZED" | "COMPLETED" | "FAILED" | "REFUNDED";
  /** Stripe client secret for Elements. Never logged; null for COD/replays. */
  clientSecret: string | null;
  paymentRequired: boolean;
  /** True when card was requested but no Stripe key is configured. */
  configurationMissing?: boolean;
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

/**
 * Payment initialization (FR-10), running strictly OUTSIDE every
 * inventory-locking transaction: external Stripe calls must never hold
 * database locks.
 *
 * - COD: marks the payment row, no external call. The order keeps its
 *   reservation with `checkoutExpiresAt = NULL`, so the expiry job (which
 *   only picks `NOT NULL` expiries) never auto-cancels COD orders; release
 *   happens through the existing admin fulfillment/cancellation path.
 * - Card: creates (or reuses, via Stripe idempotency on `checkout-{orderId}`)
 *   a PaymentIntent for the server-calculated total and stores its id on the
 *   payment row, which is what the existing webhook route uses to associate
 *   events (`payments.providerPaymentId`). Order state is untouched here —
 *   only a verified webhook finalizes (existing lifecycle, reused).
 * - Never marks an order paid from client input; never duplicates intents or
 *   reservations on retry.
 */
export async function initializeOrderPayment(
  userId: string,
  orderId: string,
  method: "card" | "cod",
  totalCents: number,
  currency: string,
): Promise<PaymentInitResult> {
  const [order] = await db
    .select({ id: orders.id, userId: orders.userId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order || order.userId !== userId) {
    throw new OrderNotFoundError(orderId);
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId));
  if (!payment) throw new OrderNotFoundError(orderId);

  if (payment.status === "COMPLETED") {
    return {
      paymentId: payment.id,
      provider: (payment.provider as "stripe" | "cod") ?? "stripe",
      status: "COMPLETED",
      clientSecret: null,
      paymentRequired: false,
    };
  }

  if (method === "cod") {
    await db
      .update(payments)
      .set({
        provider: "cod",
        paymentMethod: "CASH_ON_DELIVERY",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));
    return {
      paymentId: payment.id,
      provider: "cod",
      status: "PENDING",
      clientSecret: null,
      paymentRequired: false,
    };
  }

  // Reuse an existing intent when a previous attempt already created one
  // (timeout retries must not mint a second intent).
  if (payment.providerPaymentId && payment.provider === "stripe") {
    const stripe = stripeClient();
    if (!stripe) {
      return {
        paymentId: payment.id,
        provider: "stripe",
        status: "PENDING",
        clientSecret: null,
        paymentRequired: true,
        configurationMissing: true,
      };
    }
    try {
      const intent = await stripe.paymentIntents.retrieve(payment.providerPaymentId);
      if (intent.status === "succeeded" || intent.status === "canceled") {
        // Terminal at Stripe but webhook may still be in flight; report
        // truthfully and let the verified event drive the order.
        return {
          paymentId: payment.id,
          provider: "stripe",
          status: "PENDING",
          clientSecret: null,
          paymentRequired: true,
        };
      }
      return {
        paymentId: payment.id,
        provider: "stripe",
        status: "PENDING",
        clientSecret: intent.client_secret,
        paymentRequired: true,
      };
    } catch {
      // Fall through and create a fresh intent below.
    }
  }

  const stripe = stripeClient();
  if (!stripe) {
    // Order + reservation stand; the client retries once keys are configured.
    return {
      paymentId: payment.id,
      provider: "stripe",
      status: "PENDING",
      clientSecret: null,
      paymentRequired: true,
      configurationMissing: true,
    };
  }

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: currency.toLowerCase(),
        metadata: { orderId },
      },
      { idempotencyKey: `checkout-${orderId}` },
    );
  } catch (error) {
    // Reservation stays held until expiry; retry is safe (same idempotency).
    const message =
      error instanceof Error ? error.message : "Payment service unavailable";
    throw new PaymentInitError(
      `We could not start the card payment (${sanitizeStripeMessage(message)}). Your order is reserved — retry payment shortly.`,
    );
  }

  await db
    .update(payments)
    .set({
      provider: "stripe",
      providerPaymentId: intent.id,
      paymentMethod: "CARD",
      updatedAt: new Date(),
    })
    .where(
      and(eq(payments.id, payment.id), eq(payments.orderId, orderId)),
    );

  return {
    paymentId: payment.id,
    provider: "stripe",
    status: "PENDING",
    clientSecret: intent.client_secret,
    paymentRequired: true,
  };
}

/** Retry payment initialization for an owned order (idempotent). */
export async function retryOrderPayment(
  userId: string,
  orderId: string,
): Promise<PaymentInitResult> {
  const [order] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      totalAmount: orders.totalAmount,
      currency: orders.currency,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order || order.userId !== userId) {
    throw new OrderNotFoundError(orderId);
  }
  if (order.status === "CANCELLED") {
    throw new PaymentInitError("This order was cancelled and cannot be paid.");
  }
  const [payment] = await db
    .select({ paymentMethod: payments.paymentMethod })
    .from(payments)
    .where(eq(payments.orderId, orderId));
  const method = payment?.paymentMethod === "CASH_ON_DELIVERY" ? "cod" : "card";
  return initializeOrderPayment(
    userId,
    orderId,
    method,
    Math.round(Number(order.totalAmount) * 100),
    order.currency,
  );
}

/** Stripe messages can contain account details — keep only the safe prefix. */
function sanitizeStripeMessage(message: string): string {
  return message.slice(0, 120);
}

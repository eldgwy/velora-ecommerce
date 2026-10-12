import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/infrastructure/database";
import { orders, payments, webhookEvents } from "@/infrastructure/database/schema/orders";
import { and, eq } from "drizzle-orm";
import { logger } from "@/shared/lib/logging/logger";
import { verifyStripeSignature } from "@/modules/orders/application/webhooks/verify-signature";
import { finalizeOrderPayment, handlePaymentFailureWebhook } from "@/modules/orders/application/commands/finalize-payment";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";

export const runtime = "nodejs";

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
  created: number;
}

async function findOrderByPaymentIntent(paymentIntentId: string): Promise<{ orderId: string; paymentId: string } | null> {
  const [payment] = await db
    .select({
      id: payments.id,
      orderId: payments.orderId,
    })
    .from(payments)
    .where(eq(payments.providerPaymentId, paymentIntentId));

  if (!payment) {
    return null;
  }

  return { orderId: payment.orderId, paymentId: payment.id };
}

async function processStripeEvent(event: StripeEvent): Promise<{ success: boolean; error?: string }> {
  const { id: eventId, type: eventType, data } = event;
  const object = data.object;

  // Extract payment intent ID from the event object
  let paymentIntentId: string | undefined;
  if (object.id && typeof object.id === "string") {
    paymentIntentId = object.id;
  } else if (object.payment_intent && typeof object.payment_intent === "string") {
    paymentIntentId = object.payment_intent;
  }

  if (!paymentIntentId) {
    logger.warn("Webhook event missing payment intent ID", {
      module: "webhooks",
      action: "stripeWebhookMissingPaymentIntent",
      eventId,
      eventType,
    });
    return { success: true }; // Not an error, just not actionable
  }

  const association = await findOrderByPaymentIntent(paymentIntentId);
  if (!association) {
    logger.warn("No order found for payment intent", {
      module: "webhooks",
      action: "stripeWebhookNoOrder",
      eventId,
      eventType,
      paymentIntentId,
    });
    return { success: true }; // Not an error, payment might not be for our orders
  }

  const { orderId, paymentId } = association;

  // Check if we've already processed this event
  const [existingEvent] = await db
    .select({ id: webhookEvents.id, status: webhookEvents.status, attempts: webhookEvents.attempts })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, "stripe"),
        eq(webhookEvents.providerEventId, eventId),
      ),
    );

  if (existingEvent) {
    if (existingEvent.status === "COMPLETED") {
      logger.info("Webhook event already processed", {
        module: "webhooks",
        action: "stripeWebhookIdempotent",
        eventId,
        orderId,
      });
      return { success: true };
    }
    if (existingEvent.status === "PROCESSING") {
      logger.warn("Webhook event currently being processed", {
        module: "webhooks",
        action: "stripeWebhookConcurrent",
        eventId,
        orderId,
      });
      return { success: false, error: "Event currently being processed" };
    }
    // If FAILED, we can retry
  }

  // Mark event as processing
  if (existingEvent) {
    await db
      .update(webhookEvents)
      .set({ status: "PROCESSING", attempts: (existingEvent.attempts || 0) + 1, updatedAt: new Date() })
      .where(eq(webhookEvents.id, existingEvent.id));
  } else {
    await db.insert(webhookEvents).values({
      provider: "stripe",
      providerEventId: eventId,
      eventType,
      orderId,
      paymentId,
      status: "PROCESSING",
      attempts: 1,
      payload: JSON.stringify(event),
    });
  }

  try {
    let result: { success: boolean; error?: string } = { success: false };

    switch (eventType) {
      case "payment_intent.succeeded":
        // Payment succeeded - finalize the order
        await finalizeOrderPayment(orderId, paymentId, {
          actorId: "webhook",
          requestId: eventId,
          provider: "stripe",
        });
        // Post-commit notice only; a send failure never fails the webhook.
        await dispatchOrderNotification(orderId, "payment_succeeded");
        result = { success: true };
        break;

      case "payment_intent.payment_failed":
      case "payment_intent.canceled":
        // Payment failed - release reservations
        await handlePaymentFailureWebhook(orderId, paymentId, {
          actorId: "webhook",
          requestId: eventId,
          provider: "stripe",
          reason: eventType,
        });
        await dispatchOrderNotification(orderId, "payment_failed");
        result = { success: true };
        break;

      case "charge.refunded":
      case "charge.refund.updated": {
        // Best-effort reconciliation against local refund records. Never
        // trusts the redirect/event alone: converges stored COMPLETED totals
        // toward the provider-reported amount_refunded, idempotently.
        const chargeIntent =
          typeof object.payment_intent === "string" ? object.payment_intent : paymentIntentId;
        const amountRefunded =
          typeof object.amount_refunded === "number" ? object.amount_refunded : null;
        if (chargeIntent && amountRefunded !== null) {
          const { reconcileRefundEvent } = await import(
            "@/modules/payments/application/commands/request-refund"
          );
          const outcome = await reconcileRefundEvent({
            paymentIntentId: chargeIntent,
            chargeId: typeof object.id === "string" ? object.id : eventId,
            amountRefundedCents: amountRefunded,
          });
          logger.info("Refund event reconciled", {
            module: "webhooks",
            action: "stripeRefundReconciled",
            eventId,
            orderId,
            ...outcome,
          });
        } else {
          logger.info("Refund event received", {
            module: "webhooks",
            action: "stripeRefund",
            eventId,
            orderId,
          });
        }
        result = { success: true };
        break;
      }

      default:
        logger.info("Unhandled Stripe event type", {
          module: "webhooks",
          action: "stripeWebhookUnhandled",
          eventId,
          eventType,
        });
        result = { success: true };
    }

    // Mark event as completed
    await db
      .update(webhookEvents)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhookEvents.providerEventId, eventId));

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Mark event as failed
    await db
      .update(webhookEvents)
      .set({
        status: "FAILED",
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(webhookEvents.providerEventId, eventId));

    logger.error("Webhook processing failed", {
      module: "webhooks",
      action: "stripeWebhookError",
      eventId,
      eventType,
      orderId,
      paymentId,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    
    // Get signature header
    const headersList = await headers();
    const signature = headersList.get("stripe-signature");

    // Verify signature
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      logger.error("Stripe webhook secret not configured", {
        module: "webhooks",
        action: "stripeWebhookMissingSecret",
      });
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }

    const verification = verifyStripeSignature(rawBody, signature || "", secret);
    if (!verification.verified) {
      logger.warn("Stripe signature verification failed", {
        module: "webhooks",
        action: "stripeWebhookInvalidSignature",
        error: verification.error,
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Parse event
    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      logger.error("Invalid JSON in webhook payload", {
        module: "webhooks",
        action: "stripeWebhookInvalidJson",
      });
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Process event
    const result = await processStripeEvent(event);

    const duration = Date.now() - startTime;
    logger.info("Webhook processed", {
      module: "webhooks",
      action: "stripeWebhookComplete",
      eventId: event.id,
      eventType: event.type,
      durationMs: duration,
      success: result.success,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error("Webhook handler error", {
      module: "webhooks",
      action: "stripeWebhookHandlerError",
      durationMs: duration,
      error: errorMessage,
    });

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
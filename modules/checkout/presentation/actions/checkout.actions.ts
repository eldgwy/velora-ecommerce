"use server";

import { cookies } from "next/headers";

import { getCurrentSession } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  GUEST_CART_COOKIE_NAME,
  verifyGuestCartCookie,
} from "@/modules/cart/domain/guest-cookie";
import { mergeGuestCartIntoUserCart } from "@/modules/cart/application/commands/merge-guest-cart";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";
import {
  placeOrder,
  type CheckoutResult,
} from "@/modules/checkout/application/commands/create-order";
import {
  getCheckoutSummary,
  type CheckoutSummary,
} from "@/modules/checkout/application/queries/checkout-summary";
import {
  previewCheckout,
  type CheckoutPreview,
} from "@/modules/checkout/application/queries/checkout-preview";
import { retryOrderPayment } from "@/modules/checkout/application/payment-init";
import { cancelOrder } from "@/modules/orders/application/commands/order-lifecycle";
import { db } from "@/infrastructure/database";
import { orders } from "@/infrastructure/database/schema/orders";
import { eq } from "drizzle-orm";
import {
  AddressOwnershipError,
  CartConflictError,
  CartConsumedError,
  CouponInvalidError,
  EmptyCartError,
  IdempotencyConflictError,
  OrderNotFoundError,
  PaymentInitError,
  ShippingMethodError,
  StockConflictError,
  TotalChangedError,
  UnsupportedDestinationError,
} from "@/modules/checkout/domain/errors";
import {
  checkoutInputSchema,
  idempotencyKeySchema,
  orderIdSchema,
} from "@/modules/checkout/presentation/schemas/checkout.schema";

/** Checkout requires authentication: guest checkout is unsupported because
 *  `orders.user_id` is NOT NULL (documented gap, docs/checkout.md). */
async function requireCheckoutSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}

async function convergeGuestCart(userId: string): Promise<void> {
  const jar = await cookies();
  const verified = verifyGuestCartCookie(jar.get(GUEST_CART_COOKIE_NAME)?.value ?? null);
  if (!verified) return;
  try {
    const result = await mergeGuestCartIntoUserCart(userId, verified.guestId);
    if (result.guestCartConsumed) jar.delete(GUEST_CART_COOKIE_NAME);
  } catch (error) {
    logger.error("Checkout guest merge failed", {
      module: "checkout",
      action: "convergeGuestCart",
      userId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

function toErrorMessage(error: unknown): { error: string; code: string } {
  if (error instanceof EmptyCartError) return { error: error.message, code: "EMPTY_CART" };
  if (error instanceof CartConflictError) return { error: error.message, code: "CART_CONFLICT" };
  if (error instanceof CartConsumedError) return { error: error.message, code: "CART_CONSUMED" };
  if (error instanceof AddressOwnershipError) return { error: error.message, code: "ADDRESS_INVALID" };
  if (error instanceof ShippingMethodError) return { error: error.message, code: "SHIPPING_INVALID" };
  if (error instanceof UnsupportedDestinationError) return { error: error.message, code: "SHIPPING_INVALID" };
  if (error instanceof TotalChangedError) return { error: error.message, code: "TOTAL_CHANGED" };
  if (error instanceof CouponInvalidError) return { error: error.message, code: "COUPON_INVALID" };
  if (error instanceof StockConflictError) return { error: error.message, code: "STOCK_CONFLICT" };
  if (error instanceof IdempotencyConflictError) return { error: error.message, code: "IDEMPOTENCY_CONFLICT" };
  if (error instanceof PaymentInitError) return { error: error.message, code: "PAYMENT_INIT_FAILED" };
  if (error instanceof OrderNotFoundError) return { error: "Order not found.", code: "NOT_FOUND" };
  return { error: "We couldn't place your order. Please try again.", code: "CHECKOUT_FAILED" };
}

function logFailure(action: string, error: unknown, userId?: string): void {
  logger.error(`Checkout action failed: ${action}`, {
    module: "checkout",
    action,
    userId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

/** Server-action result with a machine-readable code for conflict UI. */
export type CheckoutActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; details?: unknown };

export async function getCheckoutDataAction(): Promise<ActionResult<CheckoutSummary>> {
  let session;
  try {
    session = await requireCheckoutSession();
  } catch {
    return { ok: false, error: "You must be signed in to check out." };
  }
  await convergeGuestCart(session.user.id);
  const summary = await getCheckoutSummary(session.user.id, session.user.name);
  return { ok: true, data: summary };
}

export async function placeOrderAction(
  input: unknown,
  idempotencyKey: unknown,
  expectedTotalCents?: unknown,
): Promise<CheckoutActionResult<CheckoutResult>> {
  let session;
  try {
    session = await requireCheckoutSession();
  } catch {
    return { ok: false, error: "You must be signed in to check out." };
  }

  const parsedInput = checkoutInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: parsedInput.error.issues[0]?.message ?? "Invalid checkout details." };
  }
  const parsedKey = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!parsedKey.success) {
    return { ok: false, error: "Invalid checkout key. Start a new checkout attempt." };
  }
  // Preview echo: integer minor units only. Anything else is rejected —
  // the client can request confirmation semantics but never set the amount.
  let expected: number | undefined;
  if (expectedTotalCents !== undefined) {
    if (
      typeof expectedTotalCents !== "number" ||
      !Number.isSafeInteger(expectedTotalCents) ||
      expectedTotalCents < 0
    ) {
      return { ok: false, error: "Invalid expected total. Refresh your preview." };
    }
    expected = expectedTotalCents;
  }

  await convergeGuestCart(session.user.id);

  try {
    const result = await placeOrder(
      { id: session.user.id, name: session.user.name, email: session.user.email },
      {
        shippingAddress: parsedInput.data.shippingAddress,
        billingAddress: parsedInput.data.billingAddress,
        shippingMethod: parsedInput.data.shippingMethod,
        couponCode: parsedInput.data.couponCode,
        contactPhone: parsedInput.data.contactPhone,
        paymentMethod: parsedInput.data.paymentMethod,
        notes: parsedInput.data.notes,
      },
      parsedKey.data,
      expected === undefined ? undefined : { expectedTotalCents: expected },
    );
    // Post-commit confirmation notice (claim-guarded; replays and retries
    // never resend). Fire-and-forget: email failure never fails checkout.
    void dispatchOrderNotification(result.orderId, "order_placed").catch((error: unknown) =>
      logger.error("Placed notification dispatch failed", {
        module: "checkout",
        action: "placeOrder",
        orderId: result.orderId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return { ok: true, data: result };
  } catch (error) {
    logFailure("placeOrder", error, session.user.id);
    if (error instanceof CartConflictError && error.details) {
      return { ok: false, error: error.message, code: "CART_CONFLICT", details: error.details };
    }
    const mapped = toErrorMessage(error);
    return { ok: false, error: mapped.error, code: mapped.code };
  }
}

/**
 * Read-only financial preview for the review step. Same input schema as
 * placement, same server code path minus persistence — the UI renders this
 * breakdown and echoes `totalCents` back as confirmation.
 */
export async function previewCheckoutAction(
  input: unknown,
): Promise<CheckoutActionResult<CheckoutPreview>> {
  let session;
  try {
    session = await requireCheckoutSession();
  } catch {
    return { ok: false, error: "You must be signed in to check out." };
  }

  const parsedInput = checkoutInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: parsedInput.error.issues[0]?.message ?? "Invalid checkout details." };
  }

  try {
    const preview = await previewCheckout(
      { id: session.user.id, name: session.user.name, email: session.user.email },
      {
        shippingAddress: parsedInput.data.shippingAddress,
        billingAddress: parsedInput.data.billingAddress,
        shippingMethod: parsedInput.data.shippingMethod,
        couponCode: parsedInput.data.couponCode,
        contactPhone: parsedInput.data.contactPhone,
        paymentMethod: parsedInput.data.paymentMethod,
        notes: parsedInput.data.notes,
      },
    );
    return { ok: true, data: preview };
  } catch (error) {
    logFailure("previewCheckout", error, session.user.id);
    if (error instanceof CartConflictError && error.details) {
      return { ok: false, error: error.message, code: "CART_CONFLICT", details: error.details };
    }
    const mapped = toErrorMessage(error);
    return { ok: false, error: mapped.error, code: mapped.code };
  }
}

export async function retryPaymentAction(
  orderId: unknown,
): Promise<ActionResult<{ orderId: string; clientSecret: string | null; paymentRequired: boolean }>> {
  let session;
  try {
    session = await requireCheckoutSession();
  } catch {
    return { ok: false, error: "You must be signed in." };
  }
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  try {
    const result = await retryOrderPayment(session.user.id, parsed.data);
    return {
      ok: true,
      data: {
        orderId: parsed.data,
        clientSecret: result.clientSecret,
        paymentRequired: result.paymentRequired,
      },
    };
  } catch (error) {
    logFailure("retryPayment", error, session.user.id);
    const mapped = toErrorMessage(error);
    return { ok: false, error: mapped.error };
  }
}

export async function cancelOrderAction(
  orderId: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  let session;
  try {
    session = await requireCheckoutSession();
  } catch {
    return { ok: false, error: "You must be signed in." };
  }
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  const [order] = await db
    .select({ userId: orders.userId })
    .from(orders)
    .where(eq(orders.id, parsed.data));
  if (!order || order.userId !== session.user.id) {
    return { ok: false, error: "Order not found." };
  }
  try {
    await cancelOrder(parsed.data, { actorId: session.user.id, reason: "Cancelled by customer" });
    return { ok: true, data: { orderId: parsed.data } };
  } catch (error) {
    logFailure("cancelOrder", error, session.user.id);
    return { ok: false, error: "We couldn't cancel that order." };
  }
}

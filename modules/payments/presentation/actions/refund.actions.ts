"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import { requestRefund } from "@/modules/payments/application/commands/request-refund";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";
import { InvalidOrderTransitionError } from "@/modules/orders/domain/errors/order-errors";
import { OrderNotFoundError } from "@/modules/orders/domain/errors/order-errors";

const refundSchema = z.object({
  orderId: z.string().uuid("Invalid order identifier."),
  // Optional partial amount in major units; omitted means full remaining.
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount must look like 12.50.")
    .refine((v) => Number(v) > 0, "Amount must be positive.")
    .optional(),
  reason: z
    .string()
    .trim()
    .min(1, "A refund reason is required.")
    .max(500, "Reason cannot exceed 500 characters."),
});

/**
 * Staff refund request (SRS FR-11). Admin-only, reason mandatory, money moves
 * only through the Stripe call inside the command — never from client input.
 * No inventory is restocked by this action, ever.
 */
export async function requestRefundAction(
  input: unknown,
): Promise<ActionResult<{ refundId: string; amount: string; status: string }>> {
  const session = await requireAdmin();
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid refund details." };
  }
  try {
    const result = await requestRefund({
      orderId: parsed.data.orderId,
      amountCents: parsed.data.amount
        ? Math.round(Number(parsed.data.amount) * 100)
        : undefined,
      reason: parsed.data.reason,
      actorId: session.user.id,
      actorType: session.user.role === "ADMIN" ? "admin" : "staff",
    });
    void dispatchOrderNotification(parsed.data.orderId, "refund_issued").catch(() => undefined);
    return {
      ok: true,
      data: {
        refundId: result.refundId,
        amount: (result.amountCents / 100).toFixed(2),
        status: result.status,
      },
    };
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { ok: false, error: "Order not found." };
    }
    if (error instanceof InvalidOrderTransitionError) {
      return { ok: false, error: error.message };
    }
    logger.error("Refund request failed", {
      module: "payments",
      action: "requestRefund",
      userId: session.user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "The refund could not be completed." };
  }
}

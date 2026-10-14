"use server";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import { collectCodPayment } from "@/modules/payments/application/commands/collect-cod-payment";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";
import { InvalidOrderTransitionError } from "@/modules/orders/domain/errors/order-errors";
import { OrderNotFoundError } from "@/modules/orders/domain/errors/order-errors";
import { orderIdSchema } from "@/modules/orders/presentation/schemas/order.schema";

/**
 * Record cash collected on delivery (staff/admin only). The command enforces
 * SHIPPED/DELIVERED status, COD provider, and PENDING payment — this action
 * only authenticates the actor and validates the identifier shape.
 */
export async function collectCodPaymentAction(
  input: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  const session = await requireAdmin();
  const parsed = orderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  try {
    await collectCodPayment(parsed.data, {
      actorId: session.user.id,
      actorType: session.user.role === "ADMIN" ? "admin" : "staff",
    });
    void dispatchOrderNotification(parsed.data, "payment_succeeded").catch(() => undefined);
    return { ok: true, data: { orderId: parsed.data } };
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { ok: false, error: "Order not found." };
    }
    if (error instanceof InvalidOrderTransitionError) {
      return { ok: false, error: error.message };
    }
    logger.error("COD collection failed", {
      module: "payments",
      action: "collectCodPayment",
      userId: session.user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "Cash collection could not be recorded." };
  }
}

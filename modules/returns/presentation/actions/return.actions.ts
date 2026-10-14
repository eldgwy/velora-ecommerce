"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  createReturnCase,
  receiveReturnItem,
  inspectReturnItem,
  cancelReturnItem,
  restockReturn,
} from "@/modules/returns/application/commands/returns";
import {
  getOrderReturns,
  type ReturnCaseView,
} from "@/modules/returns/application/queries/return-cases";
import { orderIdSchema } from "@/modules/orders/presentation/schemas/order.schema";
import {
  InvalidOrderTransitionError,
  InvalidOrderItemQuantityError,
  OrderNotFoundError,
  OrderItemNotFoundError,
} from "@/modules/orders/domain/errors/order-errors";
import {
  ReturnCaseNotFoundError,
  ReturnItemNotFoundError,
} from "@/modules/returns/domain/return-errors";

const uuidSchema = z.string().uuid("Invalid identifier.");

const createCaseSchema = z.object({
  orderId: uuidSchema,
  items: z
    .array(
      z.object({
        orderItemId: uuidSchema,
        quantity: z.number().int().min(1, "Quantity must be at least 1."),
      }),
    )
    .min(1, "Select at least one line to return."),
  reason: z.string().trim().min(1, "A return reason is required.").max(500),
  refundId: uuidSchema.nullish(),
});

const inspectSchema = z.object({
  itemId: uuidSchema,
  approved: z.boolean(),
  condition: z.enum(["RESTOCKABLE", "DAMAGED"]),
});

function actor(session: { user: { id: string; role?: string | null } }) {
  return {
    actorId: session.user.id,
    actorType: (session.user.role === "ADMIN" ? "admin" : "staff") as "admin" | "staff",
  };
}

function returnFailure(action: string, error: unknown): ActionResult<never> {
  if (error instanceof OrderNotFoundError) {
    return { ok: false, error: "Order not found." };
  }
  if (
    error instanceof OrderItemNotFoundError ||
    error instanceof ReturnCaseNotFoundError ||
    error instanceof ReturnItemNotFoundError
  ) {
    return { ok: false, error: error.message };
  }
  if (
    error instanceof InvalidOrderTransitionError ||
    error instanceof InvalidOrderItemQuantityError
  ) {
    return { ok: false, error: error.message };
  }
  logger.error(`Return action failed: ${action}`, {
    module: "returns",
    action,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "That return action could not be completed." };
}

/** Open a return case for order lines. Never approves, restocks, or refunds. */
export async function createReturnCaseAction(
  input: unknown,
): Promise<ActionResult<{ caseId: string }>> {
  const session = await requireAdmin();
  const parsed = createCaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid return details." };
  }
  try {
    const result = await createReturnCase({
      orderId: parsed.data.orderId,
      items: parsed.data.items,
      reason: parsed.data.reason,
      refundId: parsed.data.refundId ?? null,
      ...actor(session),
    });
    return { ok: true, data: result };
  } catch (error) {
    return returnFailure("createReturnCase", error) as ActionResult<{ caseId: string }>;
  }
}

/** Record physical receipt of a return line. Idempotent on replay. */
export async function receiveReturnItemAction(
  input: unknown,
): Promise<ActionResult<{ itemId: string }>> {
  const session = await requireAdmin();
  const parsed = uuidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid return item." };
  try {
    await receiveReturnItem(parsed.data, actor(session));
    return { ok: true, data: { itemId: parsed.data } };
  } catch (error) {
    return returnFailure("receiveReturnItem", error) as ActionResult<{ itemId: string }>;
  }
}

/** Record inspection: approve (restockable only) or reject a return line. */
export async function inspectReturnItemAction(
  input: unknown,
): Promise<ActionResult<{ itemId: string }>> {
  const session = await requireAdmin();
  const parsed = inspectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid inspection." };
  }
  try {
    await inspectReturnItem(
      parsed.data.itemId,
      { approved: parsed.data.approved, condition: parsed.data.condition },
      actor(session),
    );
    return { ok: true, data: { itemId: parsed.data.itemId } };
  } catch (error) {
    return returnFailure("inspectReturnItem", error) as ActionResult<{ itemId: string }>;
  }
}

/** Cancel a return line that never moved past PENDING. */
export async function cancelReturnItemAction(
  input: unknown,
): Promise<ActionResult<{ itemId: string }>> {
  const session = await requireAdmin();
  const parsed = uuidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid return item." };
  try {
    await cancelReturnItem(parsed.data, actor(session));
    return { ok: true, data: { itemId: parsed.data } };
  } catch (error) {
    return returnFailure("cancelReturnItem", error) as ActionResult<{ itemId: string }>;
  }
}

/**
 * Restock an approved, restockable return line. Exactly-once per line:
 * replays return the existing movement without touching stock.
 */
export async function restockReturnItemAction(
  input: unknown,
): Promise<ActionResult<{ movementId: string; replayed: boolean }>> {
  const session = await requireAdmin();
  const parsed = uuidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid return item." };
  try {
    const result = await restockReturn(parsed.data, actor(session));
    return { ok: true, data: result };
  } catch (error) {
    return returnFailure("restockReturnItem", error) as ActionResult<{
      movementId: string;
      replayed: boolean;
    }>;
  }
}

/** Read-only return history for the admin order view (admin-gated). */
export async function getOrderReturnsAction(
  input: unknown,
): Promise<ActionResult<ReturnCaseView[]>> {
  await requireAdmin();
  const parsed = orderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  const cases = await getOrderReturns(parsed.data);
  return { ok: true, data: cases };
}

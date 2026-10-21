import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { inventory, inventoryMovements } from "@/infrastructure/database/schema/inventory";
import {
  orderItems,
  orders,
  orderStatusHistories,
  refunds,
} from "@/infrastructure/database/schema/orders";
import { returnCases, returnItems } from "@/infrastructure/database/schema/returns";
import {
  OrderNotFoundError,
  OrderItemNotFoundError,
  InvalidOrderItemQuantityError,
  InvalidOrderTransitionError,
} from "@/modules/orders/domain/errors/order-errors";
import {
  ReturnCaseNotFoundError,
  ReturnItemNotFoundError,
} from "@/modules/returns/domain/return-errors";
import {
  canTransitionReturnItem,
  isRestockEligible,
  type ReturnCaseStatus,
  type ReturnCondition,
  type ReturnItemStatus,
} from "@/modules/returns/domain/return-transitions";
import {
  checkAndCreateLowStockAlert,
  checkAndResolveLowStockAlert,
} from "@/modules/inventory/application/low-stock-alerts";
import { logger } from "@/shared/lib/logging/logger";

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Order states whose goods left (or are leaving) the building. */
const RETURNABLE_ORDER_STATUSES = new Set(["PROCESSING", "SHIPPED", "DELIVERED"]);

/** Lines in these states still count against the order line's return quota. */
const QUOTA_HOLDING_STATUSES = ["PENDING", "RECEIVED", "APPROVED", "RESTOCKED"];

export interface ReturnLineInput {
  orderItemId: string;
  quantity: number;
}

export interface CreateReturnCaseInput {
  orderId: string;
  items: ReturnLineInput[];
  reason: string;
  /** Optional informational link to a monetary refund. Never moves money. */
  refundId?: string | null;
  actorId: string;
  actorType?: "admin" | "staff";
}

async function auditReturn(
  tx: TxClient,
  orderId: string,
  eventType: string,
  note: string,
  opts: { actorId: string; actorType: "admin" | "staff"; correlationId: string },
): Promise<void> {
  const [order] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) throw new OrderNotFoundError(orderId);
  await tx.insert(orderStatusHistories).values({
    orderId,
    status: order.status,
    previousStatus: order.status,
    eventType,
    actorType: opts.actorType,
    actorId: opts.actorId,
    correlationId: opts.correlationId,
    note,
  });
}

/**
 * Open a return case for order lines. Validates, under a row lock per order
 * line, that every line belongs to the order and that previously requested
 * (non-rejected, non-cancelled) quantities plus the new request never exceed
 * what was purchased. Never approves, never restocks, never refunds.
 */
export async function createReturnCase(input: CreateReturnCaseInput): Promise<{ caseId: string }> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new InvalidOrderTransitionError("A return reason is required.");
  }
  if (input.items.length === 0) {
    throw new InvalidOrderItemQuantityError("At least one return line is required.");
  }

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update");
    if (!order) throw new OrderNotFoundError(input.orderId);

    if (input.refundId) {
      const [refund] = await tx
        .select({ id: refunds.id, paymentId: refunds.paymentId })
        .from(refunds)
        .where(eq(refunds.id, input.refundId));
      if (!refund) {
        throw new InvalidOrderTransitionError("The linked refund does not exist.");
      }
    }

    const [created] = await tx
      .insert(returnCases)
      .values({
        orderId: input.orderId,
        refundId: input.refundId ?? null,
        status: "OPEN",
        reason: input.reason.trim().slice(0, 500),
        createdBy: input.actorId,
      })
      .returning({ id: returnCases.id });
    if (!created) throw new Error("Return case insert failed");

    for (const line of input.items) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new InvalidOrderItemQuantityError(
          "Return quantity must be a positive integer.",
        );
      }
      const [orderLine] = await tx
        .select({
          id: orderItems.id,
          orderId: orderItems.orderId,
          variantId: orderItems.variantId,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.id, line.orderItemId))
        .for("update");
      if (!orderLine || orderLine.orderId !== input.orderId) {
        throw new OrderItemNotFoundError(input.orderId);
      }

      const prior = await tx
        .select({ quantity: returnItems.quantity })
        .from(returnItems)
        .where(
          and(
            eq(returnItems.orderItemId, line.orderItemId),
            inArray(returnItems.status, QUOTA_HOLDING_STATUSES),
          ),
        );
      const alreadyRequested = prior.reduce((s, r) => s + r.quantity, 0);
      if (alreadyRequested + line.quantity > orderLine.quantity) {
        throw new InvalidOrderItemQuantityError(
          `Cannot return ${alreadyRequested + line.quantity} of a line purchased ${orderLine.quantity} times.`,
        );
      }

      await tx.insert(returnItems).values({
        caseId: created.id,
        orderItemId: line.orderItemId,
        variantId: orderLine.variantId,
        quantity: line.quantity,
        status: "PENDING",
        processedBy: input.actorId,
      });
    }

    await auditReturn(tx, input.orderId, "return_requested", "Return case opened", {
      actorId: input.actorId,
      actorType: input.actorType ?? "admin",
      correlationId: created.id,
    });

    logger.info("Return case opened", {
      module: "returns",
      action: "returnCaseOpened",
      orderId: input.orderId,
      caseId: created.id,
      actorId: input.actorId,
    });

    return { caseId: created.id };
  });
}

/** PENDING → RECEIVED: physical goods arrived back. Idempotent on replay. */
export async function receiveReturnItem(
  itemId: string,
  opts: { actorId: string; actorType?: "admin" | "staff" },
): Promise<void> {
  await transitionReturnItem(itemId, "RECEIVED", opts, "return_received", "Return goods received");
}

/** RECEIVED → APPROVED (RESTOCKABLE) or → REJECTED. Inspection outcome. */
export async function inspectReturnItem(
  itemId: string,
  decision: { approved: boolean; condition: ReturnCondition },
  opts: { actorId: string; actorType?: "admin" | "staff" },
): Promise<void> {
  if (decision.approved && decision.condition !== "RESTOCKABLE") {
    throw new InvalidOrderTransitionError(
      "Only goods inspected as restockable can be approved for restocking.",
    );
  }
  await db.transaction(async (tx) => {
    const item = await lockReturnItem(tx, itemId);
    const to: ReturnItemStatus = decision.approved ? "APPROVED" : "REJECTED";
    if (!canTransitionReturnItem(item.status as ReturnItemStatus, to)) {
      throw new InvalidOrderTransitionError(
        `Return item cannot move from ${item.status} to ${to}.`,
      );
    }
    if (item.status === to) return;

    const updated = await tx
      .update(returnItems)
      .set({
        status: to,
        condition: decision.condition,
        processedBy: opts.actorId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(returnItems.id, itemId), eq(returnItems.status, item.status)),
      )
      .returning({ id: returnItems.id });
    if (updated.length === 0) {
      throw new InvalidOrderTransitionError(
        "The return line changed concurrently. Reload and try again.",
      );
    }

    await auditReturn(
      tx,
      item.orderId,
      decision.approved ? "return_approved" : "return_rejected",
      decision.approved ? "Return line approved for restocking" : `Return line rejected (${decision.condition})`,
      {
        actorId: opts.actorId,
        actorType: opts.actorType ?? "admin",
        correlationId: itemId,
      },
    );
    await maybeCompleteCase(tx, item.caseId);
  });
}

/** OPEN case lines that never moved (PENDING only) → CANCELLED. */
export async function cancelReturnItem(
  itemId: string,
  opts: { actorId: string; actorType?: "admin" | "staff" },
): Promise<void> {
  await transitionReturnItem(itemId, "CANCELLED", opts, "return_cancelled", "Return line cancelled");
}

async function transitionReturnItem(
  itemId: string,
  to: Extract<ReturnItemStatus, "RECEIVED" | "CANCELLED">,
  opts: { actorId: string; actorType?: "admin" | "staff" },
  eventType: string,
  note: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await lockReturnItem(tx, itemId);
    if (!canTransitionReturnItem(item.status as ReturnItemStatus, to)) {
      throw new InvalidOrderTransitionError(
        `Return item cannot move from ${item.status} to ${to}.`,
      );
    }
    if (item.status === to) return;

    const updated = await tx
      .update(returnItems)
      .set({ status: to, processedBy: opts.actorId, updatedAt: new Date() })
      .where(and(eq(returnItems.id, itemId), eq(returnItems.status, item.status)))
      .returning({ id: returnItems.id });
    if (updated.length === 0) {
      throw new InvalidOrderTransitionError(
        "The return line changed concurrently. Reload and try again.",
      );
    }

    await auditReturn(tx, item.orderId, eventType, note, {
      actorId: opts.actorId,
      actorType: opts.actorType ?? "admin",
      correlationId: itemId,
    });
    await maybeCompleteCase(tx, item.caseId);
  });
}

interface LockedReturnItem {
  id: string;
  caseId: string;
  orderId: string;
  orderItemId: string;
  variantId: string;
  quantity: number;
  status: string;
  condition: string | null;
  restockedMovementId: string | null;
}

async function lockReturnItem(tx: TxClient, itemId: string): Promise<LockedReturnItem> {
  const rows = (await tx.execute(sql`
    SELECT ri.id, ri.case_id AS "caseId", o.id AS "orderId",
           ri.order_item_id AS "orderItemId", ri.variant_id AS "variantId",
           ri.quantity, ri.status, ri.condition,
           ri.restocked_movement_id AS "restockedMovementId"
    FROM return_items AS ri
    JOIN return_cases AS rc ON rc.id = ri.case_id
    JOIN orders AS o ON o.id = rc.order_id
    WHERE ri.id = ${itemId}
    FOR UPDATE OF ri
  `)) as unknown as LockedReturnItem[];
  const item = rows[0];
  if (!item) throw new ReturnItemNotFoundError(itemId);
  return item;
}

/**
 * Restock verified returned goods (`restockReturn`).
 *
 * Preconditions, all re-checked under row locks inside one transaction:
 * - line is APPROVED with a RESTOCKABLE inspection condition (received,
 *   inspected, explicitly eligible — never PENDING/RECEIVED/REJECTED/DAMAGED),
 * - the parent order is PROCESSING/SHIPPED/DELIVERED (goods actually left;
 *   cancelled/expired orders released their stock already, so restocking
 *   them would double-count).
 *
 * Effects, atomically: line → RESTOCKED (conditional on APPROVED, so a
 * concurrent twin loses safely), inventory `quantity` += approved quantity,
 * one RETURN movement referencing order/case/item, low-stock recheck, audit
 * row, and case completion when every line is terminal.
 *
 * Idempotent: RESTOCKED lines return their existing movement without
 * touching stock. Retries never duplicate movements or counts.
 */
export async function restockReturn(
  itemId: string,
  opts: { actorId: string; actorType?: "admin" | "staff" },
): Promise<{ movementId: string; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const item = await lockReturnItem(tx, itemId);

    if (item.status === "RESTOCKED") {
      if (!item.restockedMovementId) {
        throw new Error("Return line is RESTOCKED without a movement link.");
      }
      return { movementId: item.restockedMovementId, replayed: true };
    }

    if (!isRestockEligible(item.status as ReturnItemStatus, item.condition as ReturnCondition | null)) {
      throw new InvalidOrderTransitionError(
        `Only received, inspected, restockable goods can be restocked (line is ${item.status}${item.condition ? `/${item.condition}` : ""}).`,
      );
    }

    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, item.orderId))
      .for("update");
    if (!order) throw new OrderNotFoundError(item.orderId);
    if (!RETURNABLE_ORDER_STATUSES.has(order.status)) {
      throw new InvalidOrderTransitionError(
        `Goods for an order in ${order.status} state cannot be restocked (stock was never sold).`,
      );
    }

    // Claim the transition first: the loser of a race affects zero rows and
    // converges below instead of inserting a second movement.
    const claimed = await tx
      .update(returnItems)
      .set({ status: "RESTOCKED", processedBy: opts.actorId, updatedAt: new Date() })
      .where(and(eq(returnItems.id, itemId), eq(returnItems.status, "APPROVED")))
      .returning({ id: returnItems.id });
    if (claimed.length === 0) {
      const [current] = await tx
        .select({ status: returnItems.status, restockedMovementId: returnItems.restockedMovementId })
        .from(returnItems)
        .where(eq(returnItems.id, itemId));
      if (current?.status === "RESTOCKED" && current.restockedMovementId) {
        return { movementId: current.restockedMovementId, replayed: true };
      }
      throw new InvalidOrderTransitionError(
        "The return line changed concurrently. Reload and try again.",
      );
    }

    const invRows = (await tx.execute(sql`
      SELECT i.id, i.quantity, i.reserved_quantity AS "reservedQuantity"
      FROM inventory AS i
      WHERE i.variant_id = ${item.variantId}
      FOR UPDATE
    `)) as Array<{ id: string; quantity: number; reservedQuantity: number }>;
    const inv = invRows[0];
    if (!inv) {
      throw new InvalidOrderTransitionError(
        "No inventory record exists for the returned variant.",
      );
    }

    const newQuantity = inv.quantity + item.quantity;
    await tx
      .update(inventory)
      .set({ quantity: newQuantity, updatedAt: new Date() })
      .where(eq(inventory.id, inv.id));

    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        inventoryId: inv.id,
        quantity: item.quantity,
        type: "RETURN",
        reason: `Return ${item.caseId} line ${itemId} restocked for order ${item.orderId}`,
        actorType: opts.actorType ?? "staff",
        actorId: opts.actorId,
      })
      .returning({ id: inventoryMovements.id });
    if (!movement) throw new Error("Return movement insert failed");

    await tx
      .update(returnItems)
      .set({ restockedMovementId: movement.id, updatedAt: new Date() })
      .where(eq(returnItems.id, itemId));

    await checkAndCreateLowStockAlert(tx, item.variantId, { actorId: opts.actorId });
    await checkAndResolveLowStockAlert(tx, item.variantId, { actorId: opts.actorId });

    logger.catalog.inventoryAdjusted(
      inv.id,
      item.variantId,
      "RETURN",
      item.quantity,
      opts.actorId,
    );

    await auditReturn(tx, item.orderId, "return_restocked", `Restocked ${item.quantity} unit(s) from return`, {
      actorId: opts.actorId,
      actorType: opts.actorType ?? "admin",
      correlationId: itemId,
    });
    await maybeCompleteCase(tx, item.caseId);

    return { movementId: movement.id, replayed: false };
  });
}

/** Complete the case once every line reached a terminal state. */
async function maybeCompleteCase(tx: TxClient, caseId: string): Promise<void> {
  const lines = await tx
    .select({ status: returnItems.status })
    .from(returnItems)
    .where(eq(returnItems.caseId, caseId));
  if (lines.length === 0) return;
  const terminal: ReturnItemStatus[] = ["REJECTED", "RESTOCKED", "CANCELLED"];
  if (!lines.every((l) => terminal.includes(l.status as ReturnItemStatus))) return;

  await tx
    .update(returnCases)
    .set({ status: "COMPLETED", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(returnCases.id, caseId), eq(returnCases.status, "OPEN")));

  const [current] = await tx
    .select({ orderId: returnCases.orderId })
    .from(returnCases)
    .where(eq(returnCases.id, caseId));
  if (current) {
    await auditReturn(tx, current.orderId, "return_completed", "Return case completed", {
      actorId: "system",
      actorType: "admin",
      correlationId: caseId,
    });
  }
}

export type { ReturnCaseStatus, ReturnItemStatus, ReturnCondition };
export { ReturnCaseNotFoundError, ReturnItemNotFoundError };

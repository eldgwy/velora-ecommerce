import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { returnCases, returnItems } from "@/infrastructure/database/schema/returns";

export interface ReturnItemView {
  id: string;
  orderItemId: string;
  variantId: string;
  quantity: number;
  status: string;
  condition: string | null;
  restockedMovementId: string | null;
  processedBy: string | null;
}

export interface ReturnCaseView {
  id: string;
  orderId: string;
  refundId: string | null;
  status: string;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
  items: ReturnItemView[];
}

/** All return cases (with lines) for an order, newest first. */
export async function getOrderReturns(orderId: string): Promise<ReturnCaseView[]> {
  const cases = await db
    .select()
    .from(returnCases)
    .where(eq(returnCases.orderId, orderId));

  const views: ReturnCaseView[] = [];
  for (const c of cases) {
    const lines = await db
      .select()
      .from(returnItems)
      .where(eq(returnItems.caseId, c.id));
    views.push({
      id: c.id,
      orderId: c.orderId,
      refundId: c.refundId,
      status: c.status,
      reason: c.reason,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      completedAt: c.completedAt,
      items: lines.map((l) => ({
        id: l.id,
        orderItemId: l.orderItemId,
        variantId: l.variantId,
        quantity: l.quantity,
        status: l.status,
        condition: l.condition,
        restockedMovementId: l.restockedMovementId,
        processedBy: l.processedBy,
      })),
    });
  }
  return views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

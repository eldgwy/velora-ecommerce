import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { payments, refunds } from "@/infrastructure/database/schema/orders";
import { toMinorUnits, fromMinorUnits } from "@/modules/checkout/domain/money";

export interface RefundSummary {
  paymentId: string;
  provider: string | null;
  paymentStatus: string | null;
  captured: string;
  currency: string;
  refunded: string;
  refundedCents: number;
  remaining: string;
  remainingCents: number;
  refunds: Array<{
    id: string;
    amount: string;
    status: string;
    providerRefundId: string | null;
    reason: string | null;
    createdAt: Date;
  }>;
}

/**
 * Payment amount, refunded amount, and remaining refundable amount for the
 * admin order view. Computed from persisted rows with the same semantics as
 * the refund command: COMPLETED rows count as refunded; fresh PENDING rows
 * reserve cap (shown separately so staff can see in-flight money).
 */
export async function getRefundSummary(orderId: string): Promise<RefundSummary | null> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId));
  if (!payment) return null;

  const currency = payment.currency ?? "USD";
  const rows = await db
    .select()
    .from(refunds)
    .where(eq(refunds.paymentId, payment.id));

  const completedCents = rows
    .filter((r) => r.status === "COMPLETED")
    .reduce((s, r) => s + toMinorUnits(r.amount ?? "0", currency), 0);
  const capturedCents = toMinorUnits(payment.amount ?? "0", currency);
  const remainingCents = Math.max(0, capturedCents - completedCents);

  return {
    paymentId: payment.id,
    provider: payment.provider,
    paymentStatus: payment.status,
    captured: payment.amount ?? "0.00",
    currency,
    refunded: fromMinorUnits(completedCents, currency),
    refundedCents: completedCents,
    remaining: fromMinorUnits(remainingCents, currency),
    remainingCents,
    refunds: rows.map((r) => ({
      id: r.id,
      amount: r.amount ?? "0.00",
      status: r.status,
      providerRefundId: r.providerRefundId,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
  };
}

/** True when no fresh PENDING refund is still in flight for the payment. */
export async function hasFreshPendingRefund(paymentId: string, staleMs: number): Promise<boolean> {
  const now = Date.now();
  const pending = await db
    .select({ createdAt: refunds.createdAt })
    .from(refunds)
    .where(and(eq(refunds.paymentId, paymentId), eq(refunds.status, "PENDING")));
  return pending.some((r) => !r.createdAt || now - r.createdAt.getTime() < staleMs);
}

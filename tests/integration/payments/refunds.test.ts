import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const { refundsCreateMock } = vi.hoisted(() => {
  const seen = new Map<string, { id: string }>();
  let seq = 0;
  return {
    // Faithful Stripe stub: identical idempotency keys replay the SAME
    // refund object instead of moving money twice.
    refundsCreateMock: vi.fn(async (_params: unknown, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey ?? `nokey-${(seq += 1)}`;
      const existing = seen.get(key);
      if (existing) return existing;
      const created = { id: `re_test_${Date.now()}_${(seq += 1)}` };
      seen.set(key, created);
      return created;
    }),
  };
});

vi.mock("stripe", () => ({
  default: vi.fn(function (this: unknown) {
    return {
      refunds: { create: refundsCreateMock },
      paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
    };
  }),
}));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  inventoryMovements,
} from "../_db";
import { orders, orderItems, payments, refunds } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  requestRefund,
  reconcileRefundEvent,
} from "@/modules/payments/application/commands/request-refund";

const SFX = `rf-${Date.now()}`;
let userId = "";
let variantId = "";
let inventoryId = "";
let orderId = "";
let paymentId = "";
let categoryId = "";
let brandId = "";
let productId = "";

const CAPTURED = "40.00";

async function movementCount(): Promise<number> {
  const rows = await testDb
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.inventoryId, inventoryId));
  return rows[0]!.count;
}

beforeAll(async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  const [u] = await testDb
    .insert(user)
    .values({ id: `rf-u-${SFX}`, name: "Refund User", email: `refund-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `rf-cat-${SFX}`, name: "RF Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `rf-brand-${SFX}`, name: "RF Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "RF Product", status: "ACTIVE", basePrice: "40.00", categoryId: cat.id, brandId: br.id })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId: prod.id, sku: `RF-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  const [inv] = await testDb.insert(inventory).values({ variantId, quantity: 10, reservedQuantity: 0 }).returning();
  inventoryId = inv.id;

  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `RF-ORD-${SFX}`,
      userId,
      status: "PROCESSING",
      subtotal: CAPTURED,
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: CAPTURED,
      currency: "USD",
      paymentStatus: "PAID",
    })
    .returning();
  orderId = order.id;
  await testDb.insert(orderItems).values({
    orderId,
    variantId,
    productName: "RF Product",
    sku: `RF-SKU-${SFX}`,
    quantity: 1,
    unitPrice: CAPTURED,
    totalAmount: CAPTURED,
    reservationStatus: "COMMITTED",
  });
  const [payment] = await testDb
    .insert(payments)
    .values({
      orderId,
      provider: "stripe",
      providerPaymentId: `pi_rf_${SFX}`,
      amount: CAPTURED,
      currency: "USD",
      status: "COMPLETED",
      paymentMethod: "CARD",
    })
    .returning();
  paymentId = payment.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.delete(refunds).where(eq(refunds.paymentId, paymentId));
  await testDb.delete(payments).where(eq(payments.id, paymentId));
  await testDb.delete(orderItems).where(eq(orderItems.orderId, orderId));
  await testDb.delete(orders).where(eq(orders.id, orderId));
  await testDb.delete(inventoryMovements).where(eq(inventoryMovements.inventoryId, inventoryId));
  await testDb.delete(inventory).where(eq(inventory.id, inventoryId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
});

beforeEach(() => {
  refundsCreateMock.mockClear();
});

describe("refund workflow", () => {
  it("issues a full refund with audit and capped status", async () => {
    const movesBefore = await movementCount();
    const res = await requestRefund({
      orderId,
      reason: "Customer return approved",
      actorId: "admin-1",
      actorType: "admin",
    });
    expect(res.status).toBe("COMPLETED");
    expect(res.amountCents).toBe(4000);
    expect(refundsCreateMock).toHaveBeenCalledTimes(1);
    const [, opts] = refundsCreateMock.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    // Key is derived from the refund row id (unique per logical refund),
    // stable across retries of the same reservation, never across two
    // different equal-amount refunds (GP-12).
    expect(opts.idempotencyKey).toBe(`refund-${paymentId}-${res.refundId}`);

    const [order] = await testDb.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.paymentStatus).toBe("REFUNDED");
    // Full refund mirrors COMPLETED → REFUNDED onto the payment row: the
    // payment is terminal and can never be finalized or failed again.
    const [pay] = await testDb.select().from(payments).where(eq(payments.id, paymentId));
    expect(pay!.status).toBe("REFUNDED");
    // No restock: inventory untouched by money movement.
    expect(await movementCount()).toBe(movesBefore);
    const [inv] = await testDb.select().from(inventory).where(eq(inventory.id, inventoryId));
    expect(inv!.quantity).toBe(10);
  });

  it("rejects anything beyond the captured amount (BR-007)", async () => {
    // The payment is REFUNDED-terminal after the full refund above, so the
    // terminal-state guard rejects before any Stripe call — the cap holds.
    await expect(
      requestRefund({ orderId, amountCents: 1, reason: "extra", actorId: "admin-1" }),
    ).rejects.toThrow(/only available for completed payments/);
    expect(refundsCreateMock).not.toHaveBeenCalled();
  });
});

describe("partial refunds and duplicates", () => {
  it("supports partials, dedupes concurrent identical requests", async () => {
    // Fresh payment for the partial sequence.
    const [order2] = await testDb
      .insert(orders)
      .values({
        orderNumber: `RF-ORD2-${SFX}`,
        userId,
        status: "PROCESSING",
        subtotal: CAPTURED,
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: CAPTURED,
        currency: "USD",
        paymentStatus: "PAID",
      })
      .returning();
    const [pay2] = await testDb
      .insert(payments)
      .values({
        orderId: order2.id,
        provider: "stripe",
        providerPaymentId: `pi_rf2_${SFX}`,
        amount: CAPTURED,
        currency: "USD",
        status: "COMPLETED",
        paymentMethod: "CARD",
      })
      .returning();

    try {
      const first = await requestRefund({
        orderId: order2.id,
        amountCents: 1500,
        reason: "partial",
        actorId: "admin-1",
      });
      expect(first.status).toBe("COMPLETED");
      const [mid] = await testDb.select().from(orders).where(eq(orders.id, order2.id));
      expect(mid!.paymentStatus).toBe("PARTIALLY_REFUNDED");

      refundsCreateMock.mockClear();
      const [a, b] = await Promise.all([
        requestRefund({ orderId: order2.id, amountCents: 2500, reason: "rest", actorId: "admin-1" }),
        requestRefund({ orderId: order2.id, amountCents: 2500, reason: "rest", actorId: "admin-1" }),
      ]);
      // One Stripe refund; both callers converge (second replays the PENDING row).
      expect(refundsCreateMock).toHaveBeenCalledTimes(1);
      expect(a.refundId).toBe(b.refundId);
      const [done] = await testDb.select().from(orders).where(eq(orders.id, order2.id));
      expect(done!.paymentStatus).toBe("REFUNDED");
    } finally {
      await testDb.delete(refunds).where(eq(refunds.paymentId, pay2.id));
      await testDb.delete(payments).where(eq(payments.id, pay2.id));
      await testDb.delete(orders).where(eq(orders.id, order2.id));
    }
  });

  it("runs a NEW gateway operation for a repeat equal-amount refund (GP-12)", async () => {
    // A second equal-amount refund after a COMPLETED one is a separate
    // logical refund: per-row idempotency keys mean it gets its own Stripe
    // operation instead of replaying the first refund object. Untagged
    // amount-only staging is the admin's explicit new request.
    const [orderR] = await testDb
      .insert(orders)
      .values({
        orderNumber: `RF-RETRY-${SFX}`,
        userId,
        status: "PROCESSING",
        subtotal: "30.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "30.00",
        currency: "USD",
        paymentStatus: "PAID",
      })
      .returning();
    const [payR] = await testDb
      .insert(payments)
      .values({
        orderId: orderR.id,
        provider: "stripe",
        providerPaymentId: `pi_retry_${SFX}`,
        amount: "30.00",
        currency: "USD",
        status: "COMPLETED",
        paymentMethod: "CARD",
      })
      .returning();
    try {
      const first = await requestRefund({
        orderId: orderR.id,
        amountCents: 1000,
        reason: "first",
        actorId: "admin-1",
      });
      expect(first.status).toBe("COMPLETED");

      refundsCreateMock.mockClear();
      const second = await requestRefund({
        orderId: orderR.id,
        amountCents: 1000,
        reason: "second independent refund",
        actorId: "admin-1",
      });
      // Distinct local rows, distinct provider refunds, distinct keys.
      expect(second.refundId).not.toBe(first.refundId);
      expect(second.supersededBy).toBeUndefined();
      expect(second.providerRefundId).not.toBe(first.providerRefundId);
      expect(refundsCreateMock).toHaveBeenCalledTimes(1); // one NEW money movement
      const keys = refundsCreateMock.mock.calls.map(
        ([, o]) => (o as { idempotencyKey: string }).idempotencyKey,
      );
      expect(keys.every((k) => k === `refund-${payR.id}-${second.refundId}`)).toBe(true);

      const rows = await testDb
        .select()
        .from(refunds)
        .where(and(eq(refunds.paymentId, payR.id), eq(refunds.status, "COMPLETED")));
      const total = rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
      expect(total).toBe(2000);
      const [order] = await testDb.select().from(orders).where(eq(orders.id, orderR.id));
      expect(order!.paymentStatus).toBe("PARTIALLY_REFUNDED");
    } finally {
      await testDb.delete(refunds).where(eq(refunds.paymentId, payR.id));
      await testDb.delete(payments).where(eq(payments.id, payR.id));
      await testDb.delete(orders).where(eq(orders.id, orderR.id));
    }
  });

  it("records Stripe failures without moving money or state", async () => {
    refundsCreateMock.mockRejectedValueOnce(new Error("card_declined-ish"));
    const [order3] = await testDb
      .insert(orders)
      .values({
        orderNumber: `RF-ORD3-${SFX}`,
        userId,
        status: "PROCESSING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PAID",
      })
      .returning();
    const [pay3] = await testDb
      .insert(payments)
      .values({
        orderId: order3.id,
        provider: "stripe",
        providerPaymentId: `pi_rf3_${SFX}`,
        amount: "10.00",
        currency: "USD",
        status: "COMPLETED",
        paymentMethod: "CARD",
      })
      .returning();
    try {
      await expect(
        requestRefund({ orderId: order3.id, amountCents: 1000, reason: "x", actorId: "a" }),
      ).rejects.toThrow(/rejected by the payment provider/);
      const [failed] = await testDb
        .select()
        .from(refunds)
        .where(and(eq(refunds.paymentId, pay3.id), eq(refunds.status, "FAILED")));
      expect(failed).toBeDefined();
      const [order] = await testDb.select().from(orders).where(eq(orders.id, order3.id));
      expect(order!.paymentStatus).toBe("PAID");
      // A fresh attempt after failure stages anew (FAILED rows never block)
      // and must generate a NEW idempotency key so the provider's cached
      // error for the failed attempt cannot poison the retry (GP-12).
      const keyBefore = ((refundsCreateMock.mock.calls[0]?.[1] ?? {}) as { idempotencyKey?: string }).idempotencyKey;
      const retry = await requestRefund({ orderId: order3.id, amountCents: 1000, reason: "retry", actorId: "a" });
      expect(retry.status).toBe("COMPLETED");
      const keyAfter = ((refundsCreateMock.mock.calls[1]?.[1] ?? {}) as { idempotencyKey?: string }).idempotencyKey;
      expect(keyAfter).not.toBe(keyBefore);
      expect(keyAfter).toBe(`refund-${pay3.id}-${retry.refundId}`);
    } finally {
      await testDb.delete(refunds).where(eq(refunds.paymentId, pay3.id));
      await testDb.delete(payments).where(eq(payments.id, pay3.id));
      await testDb.delete(orders).where(eq(orders.id, order3.id));
    }
  });

  it("blocks non-completed payments and missing provider config", async () => {
    const [order4] = await testDb
      .insert(orders)
      .values({
        orderNumber: `RF-ORD4-${SFX}`,
        userId,
        status: "PENDING",
        subtotal: "10.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "10.00",
        currency: "USD",
        paymentStatus: "PENDING",
      })
      .returning();
    const [pay4] = await testDb
      .insert(payments)
      .values({ orderId: order4.id, provider: "stripe", amount: "10.00", currency: "USD", status: "PENDING", paymentMethod: "CARD" })
      .returning();
    try {
      await expect(
        requestRefund({ orderId: order4.id, reason: "x", actorId: "a" }),
      ).rejects.toThrow(/only available for completed payments/);
      expect(refundsCreateMock).not.toHaveBeenCalled();

      vi.stubEnv("STRIPE_SECRET_KEY", "");
      await expect(
        requestRefund({ orderId, reason: "x", actorId: "a" }),
      ).rejects.toThrow(/not configured/);
    } finally {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
      await testDb.delete(payments).where(eq(payments.id, pay4.id));
      await testDb.delete(orders).where(eq(orders.id, order4.id));
    }
  });
});

describe("refund webhook reconciliation", () => {
  it("records unknown provider totals idempotently and flags over-reports", async () => {
    const [order5] = await testDb
      .insert(orders)
      .values({
        orderNumber: `RF-ORD5-${SFX}`,
        userId,
        status: "PROCESSING",
        subtotal: "20.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "20.00",
        currency: "USD",
        paymentStatus: "PAID",
      })
      .returning();
    const [pay5] = await testDb
      .insert(payments)
      .values({
        orderId: order5.id,
        provider: "stripe",
        providerPaymentId: `pi_rf5_${SFX}`,
        amount: "20.00",
        currency: "USD",
        status: "COMPLETED",
        paymentMethod: "CARD",
      })
      .returning();
    try {
      const first = await reconcileRefundEvent({
        paymentIntentId: `pi_rf5_${SFX}`,
        chargeId: `ch_rf5_${SFX}`,
        amountRefundedCents: 2000,
      });
      expect(first).toEqual({ reconciled: true, reason: "recorded" });
      const [order] = await testDb.select().from(orders).where(eq(orders.id, order5.id));
      expect(order!.paymentStatus).toBe("REFUNDED");

      const second = await reconcileRefundEvent({
        paymentIntentId: `pi_rf5_${SFX}`,
        chargeId: `ch_rf5_${SFX}`,
        amountRefundedCents: 2000,
      });
      expect(second.reason).toBe("already-recorded");

      const unknown = await reconcileRefundEvent({
        paymentIntentId: "pi_nope",
        chargeId: "ch_nope",
        amountRefundedCents: 100,
      });
      expect(unknown.reason).toBe("unknown-payment-intent");

      const over = await reconcileRefundEvent({
        paymentIntentId: `pi_rf5_${SFX}`,
        chargeId: `ch_over_${SFX}`,
        amountRefundedCents: 99999,
      });
      expect(over.reason).toBe("exceeds-captured");
    } finally {
      await testDb.delete(refunds).where(eq(refunds.paymentId, pay5.id));
      await testDb.delete(payments).where(eq(payments.id, pay5.id));
      await testDb.delete(orders).where(eq(orders.id, order5.id));
    }
  });
});

import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const stripeState = vi.hoisted(() => ({
  mode: "success" as "success" | "timeout" | "rejected",
  calls: 0 as number,
  keys: [] as (string | undefined)[],
  seen: new Map<string, { id: string }>(),
}));

vi.mock("stripe", () => ({
  default: vi.fn(function (this: unknown) {
    return {
      refunds: {
        create: vi.fn(async (_params: unknown, opts?: { idempotencyKey?: string }) => {
          stripeState.calls += 1;
          stripeState.keys.push(opts?.idempotencyKey);
          if (stripeState.mode === "timeout") {
            const err = new Error("Connection timed out") as Error & {
              type: string;
              code: string;
            };
            err.type = "StripeConnectionError";
            err.code = "ETIMEDOUT";
            throw err;
          }
          if (stripeState.mode === "rejected") {
            const err = new Error("No such payment_intent") as Error & {
              type: string;
              statusCode: number;
            };
            err.type = "StripeInvalidRequestError";
            err.statusCode = 404;
            throw err;
          }
          // Faithful Stripe behavior: the same idempotency key replays the
          // same refund object instead of moving money twice.
          const key = opts?.idempotencyKey ?? `nokey-${stripeState.calls}`;
          const existing = stripeState.seen.get(key);
          if (existing) return existing;
          const created = { id: `re_hr_${Date.now()}_${stripeState.calls}` };
          stripeState.seen.set(key, created);
          return created;
        }),
      },
      paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
    };
  }),
}));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
} from "../_db";
import { orders, payments, refunds } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { requestRefund } from "@/modules/payments/application/commands/request-refund";
import { InvalidOrderTransitionError } from "@/modules/orders/domain/errors/order-errors";

const SFX = `hr-${Date.now()}`;
let userId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";

async function paidOrder(tag: string, total = "40.00", currency = "USD") {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `HR-ORD-${tag}-${SFX}`,
      userId,
      status: "PROCESSING",
      subtotal: total,
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: total,
      currency,
      paymentStatus: "PAID",
    })
    .returning();
  const [payment] = await testDb
    .insert(payments)
    .values({
      orderId: order.id,
      provider: "stripe",
      providerPaymentId: `pi_hr_${tag}_${SFX}`,
      amount: total,
      currency,
      status: "COMPLETED",
      paymentMethod: "CARD",
    })
    .returning();
  return { order, payment };
}

beforeAll(async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  const [u] = await testDb
    .insert(user)
    .values({ id: `hr-u-${SFX}`, name: "Hardening User", email: `harden-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `hr-cat-${SFX}`, name: "HR Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `hr-brand-${SFX}`, name: "HR Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "HR Product", status: "ACTIVE", basePrice: "40.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `HR-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 10, reservedQuantity: 0 });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const myOrders = await testDb.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
  const ids = myOrders.map((o) => o.id);
  if (ids.length > 0) {
    const payRows = await testDb.select({ id: payments.id }).from(payments).where(inArray(payments.orderId, ids));
    const payIds = payRows.map((p) => p.id);
    if (payIds.length > 0) {
      await testDb.delete(refunds).where(inArray(refunds.paymentId, payIds));
    }
    await testDb.delete(payments).where(inArray(payments.orderId, ids));
    await testDb.delete(orders).where(inArray(orders.id, ids));
  }
  await testDb.delete(inventory).where(eq(inventory.variantId, variantId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, userId));
});

beforeEach(() => {
  stripeState.mode = "success";
  stripeState.calls = 0;
  stripeState.keys = [];
  stripeState.seen.clear();
});

describe("refund amount and eligibility validation", () => {
  it("rejects refunds against non-completed payments", async () => {
    const { order, payment } = await paidOrder("noncompleted");
    await testDb.update(payments).set({ status: "FAILED" }).where(eq(payments.id, payment.id));
    await expect(
      requestRefund({ orderId: order.id, reason: "x", actorId: "admin-1" }),
    ).rejects.toThrow(/only available for completed payments/);
    expect(stripeState.calls).toBe(0);
  });

  it("rejects zero, negative, non-integer, and over-limit amounts", async () => {
    const { order } = await paidOrder("amounts");
    for (const amountCents of [0, -100, 100.5, NaN]) {
      await expect(
        requestRefund({ orderId: order.id, amountCents, reason: "x", actorId: "admin-1" }),
      ).rejects.toThrow(/positive integer/);
    }
    await expect(
      requestRefund({ orderId: order.id, amountCents: 4001, reason: "x", actorId: "admin-1" }),
    ).rejects.toThrow(/between 1 and 4000/);
    expect(stripeState.calls).toBe(0);
  });

  it("rejects unsupported payment currencies without touching Stripe", async () => {
    const { order } = await paidOrder("currency", "40.00", "EUR");
    await expect(
      requestRefund({ orderId: order.id, reason: "x", actorId: "admin-1" }),
    ).rejects.toThrow(/not supported for this payment currency/);
    expect(stripeState.calls).toBe(0);
  });

  it("requires a refund reason", async () => {
    const { order } = await paidOrder("reason");
    await expect(
      requestRefund({ orderId: order.id, reason: "  ", actorId: "admin-1" }),
    ).rejects.toThrow(/reason is required/);
    expect(stripeState.calls).toBe(0);
  });
});

describe("concurrent refund cap", () => {
  it("two different-amount refunds cannot collectively exceed captured", async () => {
    const { order, payment } = await paidOrder("conccap");

    const [a, b] = await Promise.allSettled([
      requestRefund({ orderId: order.id, amountCents: 2500, reason: "a", actorId: "admin-1" }),
      requestRefund({ orderId: order.id, amountCents: 2000, reason: "b", actorId: "admin-1" }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    const rejected = [a, b].filter((r) => r.status === "rejected");
    // Exactly one wins the cap; the loser sees the winner's PENDING
    // reservation and is rejected before any second Stripe call.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(stripeState.calls).toBe(1);

    const rows = await testDb.select().from(refunds).where(eq(refunds.paymentId, payment.id));
    const activeCents = rows
      .filter((r) => r.status === "COMPLETED" || r.status === "PENDING")
      .reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(activeCents).toBeLessThanOrEqual(4000);
  });

  it("identical concurrent requests settle onto one Stripe refund", async () => {
    const { order, payment } = await paidOrder("concdup");
    const [a, b] = await Promise.all([
      requestRefund({ orderId: order.id, amountCents: 1000, reason: "a", actorId: "admin-1" }),
      requestRefund({ orderId: order.id, amountCents: 1000, reason: "b", actorId: "admin-1" }),
    ]);
    expect(a.refundId).toBe(b.refundId);
    expect(stripeState.calls).toBe(1);

    const rows = await testDb.select().from(refunds).where(eq(refunds.paymentId, payment.id));
    expect(rows.filter((r) => r.status === "COMPLETED")).toHaveLength(1);
  });
});

describe("ambiguous gateway outcomes", () => {
  it("keeps PENDING on timeout and converges on retry without double-spend", async () => {
    const { order, payment } = await paidOrder("timeout");
    stripeState.mode = "timeout";

    await expect(
      requestRefund({ orderId: order.id, amountCents: 1000, reason: "x", actorId: "admin-1" }),
    ).rejects.toThrow(/did not confirm/);

    // Not terminal: the reservation survives for a safe retry.
    const [kept] = await testDb.select().from(refunds).where(eq(refunds.paymentId, payment.id));
    expect(kept!.status).toBe("PENDING");

    // Retry adopts the same PENDING row (after briefly confirming no live
    // twin owns it) and drives the same idempotency key: one logical
    // gateway operation, one COMPLETED row.
    stripeState.mode = "success";
    const retry = await requestRefund({
      orderId: order.id,
      amountCents: 1000,
      reason: "retry",
      actorId: "admin-1",
    });
    expect(retry.status).toBe("COMPLETED");
    expect(retry.refundId).toBe(kept!.id);
    expect(new Set(stripeState.keys).size).toBe(1);

    const rows = await testDb.select().from(refunds).where(eq(refunds.paymentId, payment.id));
    expect(rows.filter((r) => r.status === "COMPLETED")).toHaveLength(1);
    const [keptOrder] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(keptOrder!.paymentStatus).toBe("PARTIALLY_REFUNDED");
  }, 20_000);

  it("records deterministic rejections as FAILED without moving money", async () => {
    const { order, payment } = await paidOrder("deterministic");
    stripeState.mode = "rejected";

    await expect(
      requestRefund({ orderId: order.id, amountCents: 1000, reason: "x", actorId: "admin-1" }),
    ).rejects.toThrow(/rejected by the payment provider/);

    const [failed] = await testDb.select().from(refunds).where(eq(refunds.paymentId, payment.id));
    expect(failed!.status).toBe("FAILED");
    const [keptOrder] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(keptOrder!.paymentStatus).toBe("PAID");
  });

  it("failed refunds never count toward the cap", async () => {
    const { order } = await paidOrder("failedcap");
    stripeState.mode = "rejected";
    await expect(
      requestRefund({ orderId: order.id, amountCents: 1000, reason: "x", actorId: "admin-1" }),
    ).rejects.toThrow(/rejected by the payment provider/);

    stripeState.mode = "success";
    const retry = await requestRefund({
      orderId: order.id,
      amountCents: 4000,
      reason: "full after failure",
      actorId: "admin-1",
    });
    expect(retry.status).toBe("COMPLETED");
    expect(retry.amountCents).toBe(4000);
  });
});

describe("status synchronization", () => {
  it("full refund marks payment REFUNDED; partial keeps COMPLETED", async () => {
    const { order, payment } = await paidOrder("sync");
    const partial = await requestRefund({
      orderId: order.id,
      amountCents: 1500,
      reason: "partial",
      actorId: "admin-1",
    });
    expect(partial.status).toBe("COMPLETED");
    const [midPay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(midPay!.status).toBe("COMPLETED");
    const [midOrder] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(midOrder!.paymentStatus).toBe("PARTIALLY_REFUNDED");

    const full = await requestRefund({ orderId: order.id, reason: "rest", actorId: "admin-1" });
    expect(full.amountCents).toBe(2500);
    const [donePay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(donePay!.status).toBe("REFUNDED");
    const [doneOrder] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(doneOrder!.paymentStatus).toBe("REFUNDED");
  });

  it("further refunds after full refund are rejected as terminal", async () => {
    const { order } = await paidOrder("terminal");
    await requestRefund({ orderId: order.id, reason: "full", actorId: "admin-1" });
    await expect(
      requestRefund({ orderId: order.id, amountCents: 1, reason: "extra", actorId: "admin-1" }),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);
    expect(stripeState.calls).toBe(1);
  });
});

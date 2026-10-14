import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const headerStore = vi.hoisted(() => ({ signature: "" as string }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name.toLowerCase() === "stripe-signature" ? headerStore.signature : null,
  })),
}));

vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["a@ex.com"], messageId: "m1" })),
}));

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
      const created = { id: `re_whh_${Date.now()}_${(seq += 1)}` };
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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
  inventoryMovements,
} from "../_db";
import {
  orders,
  orderItems,
  orderStatusHistories,
  payments,
  refunds,
  webhookEvents,
} from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { reserveOrderInventory } from "@/modules/orders/application/commands/reserve-order-inventory";
import {
  finalizeOrderPayment,
  handlePaymentFailureWebhook,
} from "@/modules/orders/application/commands/finalize-payment";
import { cancelOrder } from "@/modules/orders/application/commands/order-lifecycle";
import { requestRefund } from "@/modules/payments/application/commands/request-refund";
import { POST } from "@/app/api/webhooks/stripe/route";

const SFX = `whh-${Date.now()}`;
const WEBHOOK_SECRET = "whsec_test_secret";
let evtSeq = 0;

let userId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";

function signWebhook(rawBody: string, secret = WEBHOOK_SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function postEvent(rawBody: string, signature: string) {
  headerStore.signature = signature;
  return POST(
    new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: rawBody,
    }),
  );
}

function succeededEvent(intentId: string, amountCents: number, currency = "usd", eventId?: string) {
  evtSeq += 1;
  return {
    id: eventId ?? `evt_whh_suc_${SFX}_${evtSeq}`,
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: intentId, amount_received: amountCents, currency } },
  };
}

function failedEvent(intentId: string) {
  evtSeq += 1;
  return {
    id: `evt_whh_fail_${SFX}_${evtSeq}`,
    type: "payment_intent.payment_failed",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: intentId } },
  };
}

/** Fresh PENDING order with RESERVED stock and a PENDING card payment. */
async function reservedOrder(total: string, tag: string) {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `WHH-ORD-${tag}-${SFX}`,
      userId,
      status: "PENDING",
      subtotal: total,
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: total,
      currency: "USD",
      paymentStatus: "PENDING",
    })
    .returning();
  await testDb.insert(orderItems).values({
    orderId: order.id,
    variantId,
    productName: "WHH Product",
    sku: `WHH-SKU-${SFX}`,
    quantity: 1,
    unitPrice: total,
    totalAmount: total,
    reservationStatus: "PENDING",
  });
  const [payment] = await testDb
    .insert(payments)
    .values({
      orderId: order.id,
      provider: "stripe",
      providerPaymentId: `pi_whh_${tag}_${SFX}`,
      amount: total,
      currency: "USD",
      status: "PENDING",
      paymentMethod: "CARD",
    })
    .returning();
  await reserveOrderInventory(order.id, { actorId: "test" });
  return { order, payment };
}

async function movementCount(orderId: string, type: "SALE" | "RELEASE"): Promise<number> {
  const rows = await testDb
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryMovements)
    .where(sql`${inventoryMovements.reason} LIKE ${`%${orderId}%`} AND ${inventoryMovements.type} = ${type}`);
  return rows[0]!.count;
}

async function historyCount(orderId: string, eventType: string): Promise<number> {
  const rows = await testDb
    .select({ count: sql<number>`count(*)::int` })
    .from(orderStatusHistories)
    .where(and(eq(orderStatusHistories.orderId, orderId), eq(orderStatusHistories.eventType, eventType)));
  return rows[0]!.count;
}

beforeAll(async () => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  const [u] = await testDb
    .insert(user)
    .values({ id: `whh-u-${SFX}`, name: "Hardening User", email: `hardening-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `whh-cat-${SFX}`, name: "WHH Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `whh-brand-${SFX}`, name: "WHH Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ name: "WHH Product", status: "ACTIVE", basePrice: "40.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `WHH-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 100, reservedQuantity: 0 });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const myOrders = await testDb.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
  const ids = myOrders.map((o) => o.id);
  if (ids.length > 0) {
    await testDb.delete(refunds).where(
      inArray(
        refunds.paymentId,
        (await testDb.select({ id: payments.id }).from(payments).where(inArray(payments.orderId, ids))).map((p) => p.id),
      ),
    );
    await testDb.delete(payments).where(inArray(payments.orderId, ids));
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await testDb.delete(orderStatusHistories).where(inArray(orderStatusHistories.orderId, ids));
    await testDb.delete(webhookEvents).where(inArray(webhookEvents.orderId, ids));
    await testDb.delete(orders).where(inArray(orders.id, ids));
  }
  const invs = await testDb.select({ id: inventory.id }).from(inventory).where(eq(inventory.variantId, variantId));
  const invIds = invs.map((i) => i.id);
  if (invIds.length > 0) {
    await testDb.delete(inventoryMovements).where(inArray(inventoryMovements.inventoryId, invIds));
    await testDb.delete(inventory).where(inArray(inventory.id, invIds));
  }
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
  await testDb.delete(user).where(eq(user.id, userId));
});

describe("late success after cancellation", () => {
  it("rejects finalization loudly without resurrecting the order or stock", async () => {
    const { order, payment } = await reservedOrder("40.00", "cancelrace");
    await cancelOrder(order.id, { actorId: "customer", reason: "Changed mind" });

    const [cancelled] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(cancelled!.status).toBe("CANCELLED");

    // A late (but validly signed, amount-correct) success event must NOT
    // revive the order: it fails loudly so Stripe retries/escalates instead
    // of silently committing inventory for a cancelled order.
    const raw = JSON.stringify(succeededEvent(`pi_whh_cancelrace_${SFX}`, 4000));
    const res = await postEvent(raw, signWebhook(raw));
    expect(res.status).toBe(500);

    const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(kept!.status).toBe("CANCELLED");
    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("PENDING");
    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items.every((i) => i.reservationStatus === "RELEASED")).toBe(true);
    expect(await movementCount(order.id, "SALE")).toBe(0);
  });
});

describe("retry after a safely rolled-back failure", () => {
  it("leaves a FAILED webhook row retryable and finalizes on the corrected event", async () => {
    const { order, payment } = await reservedOrder("40.00", "retryok");
    const bad = succeededEvent(`pi_whh_retryok_${SFX}`, 3999);
    const badRes = await postEvent(JSON.stringify(bad), signWebhook(JSON.stringify(bad)));
    expect(badRes.status).toBe(500);

    const [failedRow] = await testDb
      .select()
      .from(webhookEvents)
      .where(
        and(eq(webhookEvents.provider, "stripe"), eq(webhookEvents.providerEventId, bad.id)),
      );
    expect(failedRow!.status).toBe("FAILED");

    // Order untouched by the failed attempt: still reservable, still pending.
    const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(kept!.status).toBe("PENDING");
    expect(kept!.paymentStatus).toBe("PENDING");

    // Corrected redelivery (new event id, same intent) finalizes exactly once.
    const good = succeededEvent(`pi_whh_retryok_${SFX}`, 4000);
    const goodRes = await postEvent(JSON.stringify(good), signWebhook(JSON.stringify(good)));
    expect(goodRes.status).toBe(200);

    const [done] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(done!.status).toBe("PROCESSING");
    expect(done!.paymentStatus).toBe("PAID");
    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("COMPLETED");
    expect(await movementCount(order.id, "SALE")).toBe(1);
    expect(await historyCount(order.id, "payment_succeeded")).toBe(1);
  });
});

describe("concurrent duplicate finalization", () => {
  it("commits inventory and audit history exactly once", async () => {
    const { order, payment } = await reservedOrder("40.00", "concdup");

    const [a, b] = await Promise.allSettled([
      finalizeOrderPayment(order.id, payment.id, { actorId: "webhook", requestId: "evt-a" }),
      finalizeOrderPayment(order.id, payment.id, { actorId: "webhook", requestId: "evt-b" }),
    ]);

    // Both callers converge: at least one finalizes; a loser either replays
    // idempotently (fulfilled) or fails loudly on the winner's state — but
    // stock and audit move exactly once either way.
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const [done] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(done!.status).toBe("PROCESSING");
    expect(done!.paymentStatus).toBe("PAID");
    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("COMPLETED");
    expect(await movementCount(order.id, "SALE")).toBe(1);
    expect(await historyCount(order.id, "payment_succeeded")).toBe(1);
  });

  it("writes exactly one audit row across duplicate webhook deliveries", async () => {
    const { order } = await reservedOrder("40.00", "auditonce");
    const event = succeededEvent(`pi_whh_auditonce_${SFX}`, 4000);
    const raw = JSON.stringify(event);

    expect((await postEvent(raw, signWebhook(raw))).status).toBe(200);
    expect((await postEvent(raw, signWebhook(raw))).status).toBe(200);

    expect(await movementCount(order.id, "SALE")).toBe(1);
    expect(await historyCount(order.id, "payment_succeeded")).toBe(1);
  });
});

describe("payment-to-order ownership", () => {
  it("refuses to finalize when the payment belongs to another order", async () => {
    const first = await reservedOrder("40.00", "owna");
    const second = await reservedOrder("40.00", "ownb");

    await expect(finalizeOrderPayment(second.order.id, first.payment.id)).rejects.toThrow(
      /does not belong/,
    );

    for (const { order, payment } of [first, second]) {
      const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
      expect(kept!.status).toBe("PENDING");
      const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
      expect(pay!.status).toBe("PENDING");
      expect(await movementCount(order.id, "SALE")).toBe(0);
    }
  });
});

describe("failure events after refunds", () => {
  it("leaves a fully refunded payment terminal and never downgrades it", async () => {
    const { order, payment } = await reservedOrder("40.00", "failrefund");
    const raw = JSON.stringify(succeededEvent(`pi_whh_failrefund_${SFX}`, 4000));
    expect((await postEvent(raw, signWebhook(raw))).status).toBe(200);

    const refund = await requestRefund({
      orderId: order.id,
      reason: "Customer return approved",
      actorId: "admin-1",
      actorType: "admin",
    });
    expect(refund.status).toBe("COMPLETED");

    // Full refund mirrors COMPLETED → REFUNDED onto the payment row so the
    // domain matrix and the database agree.
    const [refundedPay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(refundedPay!.status).toBe("REFUNDED");
    const [refundedOrder] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(refundedOrder!.paymentStatus).toBe("REFUNDED");

    // A stale failure event is a safe no-op: 200 (no retry needed), nothing
    // downgraded, no reservation released a second time.
    const failRaw = JSON.stringify(failedEvent(`pi_whh_failrefund_${SFX}`));
    const failRes = await postEvent(failRaw, signWebhook(failRaw));
    expect(failRes.status).toBe(200);

    const [keptPay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(keptPay!.status).toBe("REFUNDED");
    const [keptOrder] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(keptOrder!.paymentStatus).toBe("REFUNDED");
    expect(await movementCount(order.id, "RELEASE")).toBe(0);
  });

  it("keeps partially refunded payments COMPLETED and still guards them", async () => {
    const { order, payment } = await reservedOrder("40.00", "partguard");
    await finalizeOrderPayment(order.id, payment.id, { actorId: "test" });

    const partial = await requestRefund({
      orderId: order.id,
      amountCents: 1500,
      reason: "partial",
      actorId: "admin-1",
    });
    expect(partial.status).toBe("COMPLETED");

    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("COMPLETED");
    const [ord] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(ord!.paymentStatus).toBe("PARTIALLY_REFUNDED");

    // Failure guard holds at both levels: payment row (COMPLETED terminal)
    // and order record (captured money) — a stale failure changes nothing.
    await handlePaymentFailureWebhook(order.id, payment.id, { actorId: "webhook" });
    const [keptPay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(keptPay!.status).toBe("COMPLETED");
    const [keptOrder] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(keptOrder!.paymentStatus).toBe("PARTIALLY_REFUNDED");
  });

  it("keeps the remaining-cap backstop for legacy fully-refunded rows", async () => {
    // Rows refunded before the payment-row REFUNDED mirror existed keep
    // payments.status = COMPLETED with COMPLETED refunds covering the full
    // captured amount. The cumulative cap must still reject without a
    // Stripe call.
    const { order, payment } = await reservedOrder("40.00", "legacycap");
    await finalizeOrderPayment(order.id, payment.id, { actorId: "test" });
    await testDb.insert(refunds).values({
      paymentId: payment.id,
      providerRefundId: `re_legacy_${SFX}`,
      amount: "40.00",
      reason: "legacy full refund",
      status: "COMPLETED",
    });

    await expect(
      requestRefund({ orderId: order.id, amountCents: 100, reason: "extra", actorId: "admin-1" }),
    ).rejects.toThrow(/Nothing remains refundable/);
    expect(refundsCreateMock).not.toHaveBeenCalled();
  });
});

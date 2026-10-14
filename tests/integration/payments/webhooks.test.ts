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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
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
  webhookEvents,
} from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { reserveOrderInventory } from "@/modules/orders/application/commands/reserve-order-inventory";
import { POST } from "@/app/api/webhooks/stripe/route";

const SFX = `wh-${Date.now()}`;
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

function succeededEvent(intentId: string, amountCents: number, currency = "usd") {
  evtSeq += 1;
  return {
    id: `evt_suc_${SFX}_${evtSeq}`,
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: intentId, amount_received: amountCents, currency } },
  };
}

function failedEvent(intentId: string) {
  evtSeq += 1;
  return {
    id: `evt_fail_${SFX}_${evtSeq}`,
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
      orderNumber: `WH-ORD-${tag}-${SFX}`,
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
    productName: "WH Product",
    sku: `WH-SKU-${SFX}`,
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
      providerPaymentId: `pi_wh_${tag}_${SFX}`,
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

beforeAll(async () => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  const [u] = await testDb
    .insert(user)
    .values({ id: `wh-u-${SFX}`, name: "Webhook User", email: `webhook-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `wh-cat-${SFX}`, name: "WH Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `wh-brand-${SFX}`, name: "WH Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ name: "WH Product", status: "ACTIVE", basePrice: "40.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `WH-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(inventory).values({ variantId, quantity: 100, reservedQuantity: 0 });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const myOrders = await testDb.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
  const ids = myOrders.map((o) => o.id);
  if (ids.length > 0) {
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

describe("webhook signature security", () => {
  it("rejects invalid signatures with 400 and changes nothing", async () => {
    const { order } = await reservedOrder("40.00", "sig1");
    const raw = JSON.stringify(succeededEvent(`pi_wh_sig1_${SFX}`, 4000));
    const res = await postEvent(raw, "t=123,v1=deadbeef");
    expect(res.status).toBe(400);
    const [unchanged] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(unchanged!.status).toBe("PENDING");
  });

  it("rejects missing signatures with 400", async () => {
    const { order } = await reservedOrder("40.00", "sig2");
    const raw = JSON.stringify(succeededEvent(`pi_wh_sig2_${SFX}`, 4000));
    const res = await postEvent(raw, "");
    expect(res.status).toBe(400);
    const [unchanged] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(unchanged!.status).toBe("PENDING");
  });

  it("rejects malformed JSON with 400 even when signed", async () => {
    const raw = "{not json";
    const res = await postEvent(raw, signWebhook(raw));
    expect(res.status).toBe(400);
  });

  it("ignores unsupported event types without side effects", async () => {
    const { order } = await reservedOrder("40.00", "sig3");
    evtSeq += 1;
    const raw = JSON.stringify({
      id: `evt_weird_${SFX}_${evtSeq}`,
      type: "customer.created",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `pi_wh_sig3_${SFX}` } },
    });
    const res = await postEvent(raw, signWebhook(raw));
    expect(res.status).toBe(200);
    const [unchanged] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(unchanged!.status).toBe("PENDING");
  });

  it("ignores unknown PaymentIntents without side effects", async () => {
    const raw = JSON.stringify(succeededEvent("pi_unknown_123", 100));
    const res = await postEvent(raw, signWebhook(raw));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });
});

describe("webhook success path", () => {
  it("finalizes a verified payment exactly once across duplicate deliveries", async () => {
    const { order, payment } = await reservedOrder("40.00", "dup");
    const [invBefore] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));
    const event = succeededEvent(`pi_wh_dup_${SFX}`, 4000);
    const raw = JSON.stringify(event);

    const first = await postEvent(raw, signWebhook(raw));
    expect(first.status).toBe(200);
    const second = await postEvent(raw, signWebhook(raw));
    expect(second.status).toBe(200);

    const [done] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(done!.status).toBe("PROCESSING");
    expect(done!.paymentStatus).toBe("PAID");
    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("COMPLETED");
    expect(await movementCount(order.id, "SALE")).toBe(1);
    const [inv] = await testDb.select().from(inventory).where(eq(inventory.variantId, variantId));
    expect(inv!.quantity).toBe(invBefore!.quantity - 1);
  });

  it("rejects amount mismatches without mutating anything", async () => {
    const { order, payment } = await reservedOrder("40.00", "mismatch");
    const raw = JSON.stringify(succeededEvent(`pi_wh_mismatch_${SFX}`, 3999));
    const res = await postEvent(raw, signWebhook(raw));
    expect(res.status).toBe(500);

    const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(kept!.status).toBe("PENDING");
    expect(kept!.paymentStatus).toBe("PENDING");
    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("PENDING");
    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items.every((i) => i.reservationStatus === "RESERVED")).toBe(true);
    expect(await movementCount(order.id, "SALE")).toBe(0);
  });

  it("rejects currency mismatches without mutating anything", async () => {
    const { order } = await reservedOrder("40.00", "cur");
    const raw = JSON.stringify(succeededEvent(`pi_wh_cur_${SFX}`, 4000, "eur"));
    const res = await postEvent(raw, signWebhook(raw));
    expect(res.status).toBe(500);
    const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(kept!.status).toBe("PENDING");
  });
});

describe("webhook concurrency and staleness", () => {
  // NOTE: route ingress reads the signature from the global headers()
  // store, so two truly-concurrent POSTs would race on test-harness state,
  // not application logic. The DB-level race is exercised deterministically
  // below at the command layer (same locks, same transactions); route-level
  // success and failure paths are covered individually above.
  it("lets concurrent success and failure settle to exactly one outcome", async () => {
    const { order, payment } = await reservedOrder("40.00", "race");
    const { finalizeOrderPayment, handlePaymentFailureWebhook } = await import(
      "@/modules/orders/application/commands/finalize-payment"
    );

    const [okOutcome, failOutcome] = await Promise.allSettled([
      finalizeOrderPayment(order.id, payment.id, { actorId: "webhook" }),
      handlePaymentFailureWebhook(order.id, payment.id, { actorId: "webhook" }),
    ]);
    expect([okOutcome.status, failOutcome.status].sort()).toEqual(
      okOutcome.status === "fulfilled" ? ["fulfilled", "fulfilled"] : ["fulfilled", "rejected"],
    );

    const [done] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, order.id));

    // Exactly one consistent terminal outcome: either the success path owns
    // the order (failure became a terminal-guard no-op) or the failure path
    // owns it (success threw loudly). Mixed states are impossible.
    if (okOutcome.status === "fulfilled") {
      // Success won: paid, committed, failure recorded nothing.
      expect(done!.status).toBe("PROCESSING");
      expect(done!.paymentStatus).toBe("PAID");
      expect(pay!.status).toBe("COMPLETED");
      expect(items.every((i) => i.reservationStatus === "COMMITTED")).toBe(true);
    } else {
      // Failure won: failed/cancelled, released, success could not revive.
      expect(done!.status).toBe("CANCELLED");
      expect(done!.paymentStatus).toBe("FAILED");
      expect(pay!.status).toBe("FAILED");
      expect(items.every((i) => i.reservationStatus === "RELEASED")).toBe(true);
    }
  });

  it("blocks late success after failure without reviving the order", async () => {
    const { order } = await reservedOrder("40.00", "latefail");
    const failRaw = JSON.stringify(failedEvent(`pi_wh_latefail_${SFX}`));
    expect((await postEvent(failRaw, signWebhook(failRaw))).status).toBe(200);

    const lateRaw = JSON.stringify(succeededEvent(`pi_wh_latefail_${SFX}`, 4000));
    const late = await postEvent(lateRaw, signWebhook(lateRaw));
    expect(late.status).toBe(500);

    const [done] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(done!.status).toBe("CANCELLED");
    expect(done!.paymentStatus).toBe("FAILED");
    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items.every((i) => i.reservationStatus === "RELEASED")).toBe(true);
    expect(await movementCount(order.id, "SALE")).toBe(0);
  });

  it("blocks old success after refund without changing records", async () => {
    const { order, payment } = await reservedOrder("40.00", "oldrefund");
    await testDb.update(payments).set({ status: "REFUNDED" }).where(eq(payments.id, payment.id));
    await testDb
      .update(orders)
      .set({ paymentStatus: "REFUNDED" })
      .where(eq(orders.id, order.id));

    const raw = JSON.stringify(succeededEvent(`pi_wh_oldrefund_${SFX}`, 4000));
    const res = await postEvent(raw, signWebhook(raw));
    expect(res.status).toBe(500);

    const [pay] = await testDb.select().from(payments).where(eq(payments.id, payment.id));
    expect(pay!.status).toBe("REFUNDED");
    const [kept] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(kept!.paymentStatus).toBe("REFUNDED");
  });
});

import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["a@ex.com"], messageId: "m1" })),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { sendMail } from "@/shared/lib/mail";

import { testDb } from "../_db";
import { orderItems, orderNotifications, orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";

const SFX = `nt-${Date.now()}`;
let userId = "";
let orderId = "";

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `nt-u-${SFX}`, name: "Notify User", email: `notify-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `NT-${SFX}`,
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
  orderId = order.id;
  await testDb.insert(orderItems).values({
    orderId,
    variantId: "00000000-0000-0000-0000-000000000000",
    productName: "Widget",
    sku: "W-1",
    quantity: 1,
    unitPrice: "10.00",
    totalAmount: "10.00",
  });
});

afterAll(async () => {
  await testDb.delete(orderNotifications).where(eq(orderNotifications.orderId, orderId));
  await testDb.delete(orderItems).where(eq(orderItems.orderId, orderId));
  await testDb.delete(orders).where(eq(orders.id, orderId));
  await testDb.delete(user).where(eq(user.id, userId));
});

describe("order notification dispatch", () => {
  it("sends once and marks SENT only after provider acceptance", async () => {
    const first = await dispatchOrderNotification(orderId, "order_placed");
    expect(first).toEqual({ sent: true });
    expect(vi.mocked(sendMail)).toHaveBeenCalledTimes(1);
    const [row] = await testDb
      .select()
      .from(orderNotifications)
      .where(eq(orderNotifications.orderId, orderId));
    expect(row!.status).toBe("SENT");
    expect(row!.sentAt).not.toBeNull();

    // Retry (webhook redelivery, job rerun) never resends.
    const second = await dispatchOrderNotification(orderId, "order_placed");
    expect(second.sent).toBe(false);
    expect(second.reason).toBe("already-handled");
    expect(vi.mocked(sendMail)).toHaveBeenCalledTimes(1);
  });

  it("leaves failed sends QUEUED without failing the caller", async () => {
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SMTP down"));
    const res = await dispatchOrderNotification(orderId, "payment_failed");
    expect(res).toEqual({ sent: false, reason: "provider-error" });
    const [row] = await testDb
      .select()
      .from(orderNotifications)
      .where(
        and(
          eq(orderNotifications.orderId, orderId),
          eq(orderNotifications.type, "payment_failed"),
        ),
      );
    const failed = row!.status === "QUEUED";
    expect(failed).toBe(true);
  });

  it("sends different event types independently", async () => {
    const res = await dispatchOrderNotification(orderId, "order_shipped");
    expect(res.sent).toBe(true);
  });
});

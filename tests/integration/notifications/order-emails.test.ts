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
import {
  categories,
  brands,
  products,
  productVariants,
} from "../_db";
import { orderItems, orderNotifications, orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { dispatchOrderNotification } from "@/modules/notifications/application/order-emails";

const SFX = `nt-${Date.now()}`;
let userId = "";
let orderId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";

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
  // FK-guarded tables need a real variant (integrity net working as intended).
  const [cat] = await testDb.insert(categories).values({ slug: `nt-cat-${SFX}`, name: "NT Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `nt-brand-${SFX}`, name: "NT Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: "NT Product", status: "ACTIVE", basePrice: "10.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [v] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `NT-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = v.id;
  await testDb.insert(orderItems).values({
    orderId,
    variantId,
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
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
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

  it("leases the row SENDING for the duration of the SMTP call (T-3.4)", async () => {
    let release!: (value: never) => void;
    const gate = new Promise((resolve) => {
      release = resolve as typeof release;
    });
    vi.mocked(sendMail).mockImplementationOnce(() => gate as never);

    const pending = dispatchOrderNotification(orderId, "refund_issued");

    // The row must be leased (SENDING) while the provider call is in flight —
    // a concurrent retry worker can no longer claim it for a duplicate send.
    await expect
      .poll(
        async () => {
          const [row] = await testDb
            .select({ status: orderNotifications.status })
            .from(orderNotifications)
            .where(
              and(
                eq(orderNotifications.orderId, orderId),
                eq(orderNotifications.type, "refund_issued"),
              ),
            );
          return row?.status;
        },
        { timeout: 5_000, interval: 50 },
      )
      .toBe("SENDING");

    release({ messageId: "m-lease" } as never);
    const res = await pending;
    expect(res).toEqual({ sent: true });
    const [row] = await testDb
      .select({ status: orderNotifications.status })
      .from(orderNotifications)
      .where(
        and(
          eq(orderNotifications.orderId, orderId),
          eq(orderNotifications.type, "refund_issued"),
        ),
      );
    expect(row!.status).toBe("SENT");
  });

  it("skips sending when another path already owns the row", async () => {
    // Put the row into another path's lease state: the dispatch CAS must
    // refuse and no duplicate mail goes out.
    await testDb
      .insert(orderNotifications)
      .values({ orderId, type: "order_delivered", status: "SENDING", attempts: 1 });
    const callsBefore = vi.mocked(sendMail).mock.calls.length;
    const res = await dispatchOrderNotification(orderId, "order_delivered");
    expect(res).toEqual({ sent: false, reason: "already-handled" });
    expect(vi.mocked(sendMail).mock.calls.length).toBe(callsBefore);
  });
});

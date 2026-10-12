import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["a@ex.com"], messageId: "mid-1" })),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { sendMail } from "@/shared/lib/mail";

import { testDb } from "../_db";
import { orderNotifications, orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  processNotificationRetry,
  handleNotificationRetryRequest,
} from "@/modules/jobs/notification-retry";
import { computeBackoffMs } from "@/modules/notifications/application/backoff";

const SFX = `nr-${Date.now()}`;
let userId = "";
let orderId = "";

async function makeClaim(type: string, patch: Record<string, unknown> = {}) {
  const [row] = await testDb
    .insert(orderNotifications)
    .values({ orderId, type, status: "QUEUED", ...(patch as object) })
    .returning();
  return row!;
}

beforeAll(async () => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  const [u] = await testDb
    .insert(user)
    .values({ id: `nr-u-${SFX}`, name: "Retry User", email: `retry-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `NR-${SFX}`,
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
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.delete(orderNotifications).where(eq(orderNotifications.orderId, orderId));
  await testDb.delete(orders).where(eq(orders.id, orderId));
  await testDb.delete(user).where(eq(user.id, userId));
});

describe("notification retry worker", () => {
  it("computes bounded exponential backoff", () => {
    expect(computeBackoffMs(1)).toBe(60_000);
    expect(computeBackoffMs(2)).toBe(300_000);
    expect(computeBackoffMs(99)).toBe(21_600_000);
  });

  it("sends a due notification and records the provider id", async () => {
    const row = await makeClaim("worker-send");
    const res = await processNotificationRetry(row.id);
    expect(res.outcome).toBe("sent");
    const [done] = await testDb
      .select()
      .from(orderNotifications)
      .where(eq(orderNotifications.id, row.id));
    expect(done!.status).toBe("SENT");
    expect(done!.providerMessageId).toBe("mid-1");
    expect(done!.sentAt).not.toBeNull();
  });

  it("schedules a retry with backoff on temporary failure", async () => {
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SMTP timeout"));
    const row = await makeClaim("worker-temp");
    const res = await processNotificationRetry(row.id, { maxAttempts: 5 });
    expect(res.outcome).toBe("scheduled");
    const [done] = await testDb
      .select()
      .from(orderNotifications)
      .where(eq(orderNotifications.id, row.id));
    expect(done!.status).toBe("QUEUED");
    expect(done!.attempts).toBe(1);
    expect(done!.nextRetryAt).not.toBeNull();
    expect(done!.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    expect(done!.lastError).toBe("SMTP timeout");
  });

  it("fails permanently after maximum attempts", async () => {
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SMTP down"));
    const row = await makeClaim("worker-max", { attempts: 4 });
    const res = await processNotificationRetry(row.id, { maxAttempts: 5 });
    expect(res.outcome).toBe("failed");
    const [done] = await testDb
      .select()
      .from(orderNotifications)
      .where(eq(orderNotifications.id, row.id));
    expect(done!.status).toBe("FAILED");
    expect(done!.nextRetryAt).toBeNull();
  });

  it("lets exactly one of two concurrent workers send", async () => {
    vi.mocked(sendMail).mockClear();
    const row = await makeClaim("worker-race");
    const [a, b] = await Promise.all([
      processNotificationRetry(row.id),
      processNotificationRetry(row.id),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["sent", "skipped"]);
    expect(vi.mocked(sendMail)).toHaveBeenCalledTimes(1);
  });

  it("recovers notifications stranded by crashed workers", async () => {
    const row = await makeClaim("worker-crash", {
      status: "SENDING",
      updatedAt: new Date(Date.now() - 30 * 60_000),
    });
    const res = await processNotificationRetry(row.id, { leaseMs: 10 * 60_000 });
    expect(res.outcome).toBe("sent");
  });

  it("rejects unauthorized job access", async () => {
    const anon = await handleNotificationRetryRequest(new Request("http://x/jobs"));
    expect(anon.status).toBe(401);
    const wrong = await handleNotificationRetryRequest(
      new Request("http://x/jobs", { headers: { authorization: "Bearer wrong" } }),
    );
    expect(wrong.status).toBe(401);
    const ok = await handleNotificationRetryRequest(
      new Request("http://x/jobs", { headers: { authorization: "Bearer test-cron-secret" } }),
    );
    expect(ok.status).toBe(200);
  });
});

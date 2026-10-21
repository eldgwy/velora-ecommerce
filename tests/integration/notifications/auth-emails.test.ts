import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["a@ex.com"], messageId: "m1" })),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { NextRequest } from "next/server";
import { sendMail } from "@/shared/lib/mail";

import { testDb } from "../_db";
import { authEmails } from "@/infrastructure/database/schema/auth-emails";
import { user } from "@/infrastructure/database/schema/auth";
import {
  enqueueAuthEmail,
  dispatchAuthEmail,
} from "@/modules/notifications/application/auth-emails";
import {
  processAuthEmailRetry,
  processAuthEmailRetries,
  handleAuthEmailRetryRequest,
} from "@/modules/jobs/auth-email-retry";

const SFX = `ae-${Date.now()}`;
let userId = "";

const RESET_INPUT = (uid: string) =>
  ({
    userId: uid,
    eventType: "PASSWORD_RESET" as const,
    recipientEmail: `ae-${SFX}@ex.com`,
    subject: "Reset your Velora password",
    bodyHtml: "<p>Hi,</p><p><a href=\"https://velora.test/reset?token=t\">Reset password</a></p>",
    bodyText: "Hi,\n\nReset your password: https://velora.test/reset?token=t",
  }) satisfies Parameters<typeof enqueueAuthEmail>[0];

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `ae-u-${SFX}`, name: "Auth Email", email: `ae-${SFX}@ex.com` })
    .returning();
  userId = u.id;
});

afterAll(async () => {
  // Rows cascade off the user; still explicit for residual rows whose user
  // insert failed.
  await testDb.delete(authEmails).where(like(authEmails.userId, `ae-u-${SFX}%`));
  await testDb.delete(user).where(like(user.id, `ae-u-${SFX}%`));
});

describe("auth email durable queue (real DB)", () => {
  it("enqueues then delivers with SENT recorded only after provider acceptance", { timeout: 20_000 }, async () => {
    const id = await enqueueAuthEmail(RESET_INPUT(userId));
    expect(id).not.toBeNull();
    const [row] = await testDb.select().from(authEmails).where(eq(authEmails.id, id!));
    expect(row!.status).toBe("QUEUED");

    const res = await dispatchAuthEmail(id!);
    expect(res).toEqual({ sent: true });
    const [after] = await testDb.select().from(authEmails).where(eq(authEmails.id, id!));
    expect(after!.status).toBe("SENT");
    expect(after!.sentAt).not.toBeNull();
    expect(after!.providerMessageId).toBe("m1");

    // A second dispatch attempt (double-clicked flow, retry run) must not
    // send again: CAS refuses anything but QUEUED.
    const again = await dispatchAuthEmail(id!);
    expect(again).toEqual({ sent: false, reason: "not-claimed" });
    expect(vi.mocked(sendMail)).toHaveBeenCalledTimes(1);
  });

  it("schedules backoff on failure and delivers on the next retry", { timeout: 20_000 }, async () => {
    const id = await enqueueAuthEmail({ ...RESET_INPUT(userId), recipientEmail: `ae-2-${SFX}@ex.com` });
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SMTP 450 busy"));
    const failed = await dispatchAuthEmail(id!);
    expect(failed).toEqual({ sent: false, reason: "provider-error" });
    const [row] = await testDb.select().from(authEmails).where(eq(authEmails.id, id!));
    expect(row!.status).toBe("QUEUED");
    expect(row!.attempts).toBe(1);
    expect(row!.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row!.lastError).toBe("SMTP 450 busy");

    // Simulate the backoff window elapsing, then run the worker.
    await testDb
      .update(authEmails)
      .set({ nextRetryAt: new Date(Date.now() - 1_000) })
      .where(eq(authEmails.id, id!));

    // Worker run: provider is healthy again → SENT (row replayed verbatim).
    // The due-scan may legitimately pick up rows from other suites sharing
    // this DB, so assert fixture-scoped, not global counts.
    const run = await processAuthEmailRetries({ maxAttempts: 5, leaseMs: 5 * 60_000 });
    const own = run.results.filter((r) => r.authEmailId === id);
    expect(own).toHaveLength(1);
    expect(own[0]!.outcome).toBe("sent");
    const [after] = await testDb.select().from(authEmails).where(eq(authEmails.id, id!));
    expect(after!.status).toBe("SENT");
    // The stored body was replayed by the worker, not re-rendered anywhere.
    expect(after!.recipientEmail).toBe(`ae-2-${SFX}@ex.com`);
  });

  it("parks an exhausted row as FAILED (terminal)", { timeout: 20_000 }, async () => {
    const id = await enqueueAuthEmail({ ...RESET_INPUT(userId), recipientEmail: `ae-3-${SFX}@ex.com` });
    vi.mocked(sendMail).mockRejectedValue(new Error("SMTP down"));
    const outcome = await processAuthEmailRetry(id!, { maxAttempts: 1, leaseMs: 30_000 });
    expect(outcome.outcome).toBe("failed");
    const [row] = await testDb.select().from(authEmails).where(eq(authEmails.id, id!));
    expect(row!.status).toBe("FAILED");
    expect(row!.nextRetryAt).toBeNull();

    vi.mocked(sendMail).mockClear();
    // Terminal rows never come back into the due scan.
    const run = await processAuthEmailRetries({ maxAttempts: 1, leaseMs: 30_000 });
    expect(run.results.find((r) => r.authEmailId === id)).toBeUndefined();
    expect(vi.mocked(sendMail)).toHaveBeenCalledTimes(0);
    // Restore the healthy default for the remaining tests in this file.
    vi.mocked(sendMail).mockImplementation(async () => ({
      accepted: ["a@ex.com"],
      messageId: "m1",
    }) as never);
  });

  it("reclaims rows stranded by a crashed worker (stale SENDING lease)", { timeout: 20_000 }, async () => {
    const id = await enqueueAuthEmail({ ...RESET_INPUT(userId), recipientEmail: `ae-4-${SFX}@ex.com` });
    // Simulate the crash: row stuck SENDING since long before the lease cutoff.
    await testDb
      .update(authEmails)
      .set({ status: "SENDING", attempts: 1, updatedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(authEmails.id, id!));
    const outcome = await processAuthEmailRetry(id!, { maxAttempts: 5, leaseMs: 60_000 });
    expect(outcome.outcome).toBe("sent");
    const [row] = await testDb.select().from(authEmails).where(eq(authEmails.id, id!));
    expect(row!.status).toBe("SENT");
    expect(row!.attempts).toBe(2);
  });

  it("cascades with the account and tolerates a vanished recipient", { timeout: 20_000 }, async () => {
    const [ghost] = await testDb
      .insert(user)
      .values({ id: `ae-u-ghost-${SFX}`, name: "Ghost", email: `ae-ghost-${SFX}@ex.com` })
      .returning();
    const id = await enqueueAuthEmail({ ...RESET_INPUT(ghost.id), recipientEmail: `ae-ghost-${SFX}@ex.com` });
    expect(id).not.toBeNull();
    await testDb.delete(user).where(eq(user.id, ghost.id));
    const left = await testDb.select().from(authEmails).where(eq(authEmails.id, id!));
    expect(left).toHaveLength(0);

    // Enqueue for an account that does not exist: queue path must swallow
    // the FK error and return null, never reject the auth flow.
    const nullish = await enqueueAuthEmail({
      ...RESET_INPUT(`ae-u-missing-${SFX}`),
      recipientEmail: `ae-missing-${SFX}@ex.com`,
    });
    expect(nullish).toBeNull();
  });

  it("fails closed without CRON_SECRET (job endpoint contract)", async () => {
    const original = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const request = new NextRequest("http://localhost/api/internal/jobs/auth-email-retry", {
        method: "POST",
      });
      const response = await handleAuthEmailRetryRequest(request);
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");
    } finally {
      process.env.CRON_SECRET = original;
    }
  });
});

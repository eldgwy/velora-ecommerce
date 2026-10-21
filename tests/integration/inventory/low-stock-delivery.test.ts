import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["ops@velora.test"], messageId: "m1" })),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { sendMail } from "@/shared/lib/mail";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
} from "../_db";
import { lowStockAlerts } from "@/infrastructure/database/schema/low-stock-alerts";
import { lowStockAlertRecipients } from "@/infrastructure/database/schema/low-stock-alert-recipients";
import { lowStockAlertStatusEnum } from "@/infrastructure/database/schema/enums";
import { processLowStockAlerts } from "@/modules/inventory/jobs/deliver-low-stock-alerts";

const SFX = `lsd-${Date.now()}`;

function healthMail() {
  vi.mocked(sendMail).mockImplementation(async ({ to }) => {
    void to;
    return { accepted: [to], messageId: `m-${to}` } as never;
  });
}

/**
 * Make each job run deterministic: stamp every OTHER claimable alert's
 * last_attempt_at with the DB clock so only the under-test fixture stays
 * claimable (§6 — no reliance on shared-DB queue contents, and parallel
 * suites' rows are never claimed by this suite's runs).
 *
 * IMPORTANT: the claim query compares last_attempt_at against DB NOW(), and
 * this container's DB clock runs ~3h ahead of the Node client — client
 * `new Date()` stamps look hours old to the claim. All "is it due yet?"
 * timestamps in this file are therefore written in DB time.
 */
async function deferOthers(keepId: string) {
  await testDb.execute(sql`
    UPDATE ${lowStockAlerts}
    SET last_attempt_at = NOW(), updated_at = NOW()
    WHERE ${lowStockAlerts.id} <> ${keepId}
      AND ${lowStockAlerts.status} IN ('PENDING', 'PROCESSING')
  `);
}

describe("low-stock alert delivery (GP-30, real DB)", { timeout: 20_000 }, () => {
  const fixtureIds: string[] = [];
  const productIds: string[] = [];
  const variantIds: string[] = [];
  const inventoryIds: string[] = [];

  beforeAll(async () => {
    const [cat] = await testDb
      .insert(categories)
      .values({ slug: `lsd-cat-${SFX}`, name: "LSD Cat" })
      .returning();
    const [br] = await testDb
      .insert(brands)
      .values({ slug: `lsd-brand-${SFX}`, name: "LSD Brand" })
      .returning();
    for (let i = 0; i < 6; i += 1) {
      const [prod] = await testDb
        .insert(products)
        .values({
          slug: `p-${Math.random().toString(36).slice(2, 14)}`,
          name: `LSD Product ${i}`,
          status: "ACTIVE",
          basePrice: "10.00",
          categoryId: cat.id,
          brandId: br.id,
        })
        .returning();
      productIds.push(prod.id);
      const [v] = await testDb
        .insert(productVariants)
        .values({ productId: prod.id, sku: `LSD-SKU-${i}-${SFX}`, status: "ACTIVE" })
        .returning();
      variantIds.push(v.id);
      const [inv] = await testDb
        .insert(inventory)
        .values({
          variantId: v.id,
          quantity: 10,
          reservedQuantity: 0,
          lowStockThreshold: 4,
        })
        .returning();
      inventoryIds.push(inv.id);
      const [alert] = await testDb
        .insert(lowStockAlerts)
        .values({
          inventoryId: inv.id,
          variantId: v.id,
          availableStock: 3,
          threshold: 4,
          // Backdated: the delivery claim is FIFO by created_at; our
          // fixtures must outrank PENDING rows any parallel suite leaves in
          // the shared DB (§6 never assert global queue contents — and our
          // batch-1 runs must deterministicly claim OURS first).
          createdAt: new Date(Date.now() - 7_200_000 + i),
        })
        .returning();
      fixtureIds.push(alert.id);
    }
  });

  afterAll(async () => {
    // Ledger rows cascade off the alerts.
    await testDb.delete(lowStockAlerts).where(eq(lowStockAlerts.inventoryId, inventoryIds[0]!));
    await testDb.delete(inventory).where(inArray(inventory.id, inventoryIds));
    await testDb.delete(productVariants).where(inArray(productVariants.id, variantIds));
    await testDb.delete(products).where(inArray(products.id, productIds));
    await testDb
      .delete(brands)
      .where(eq(brands.slug, `lsd-brand-${SFX}`));
    await testDb
      .delete(categories)
      .where(eq(categories.slug, `lsd-cat-${SFX}`));
  });

  it("delivers once per unique recipient and records the ledger", async () => {
    const [alert] = await testDb
      .select()
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.id, fixtureIds[0]!));
    // Seed the ledger with one already-sent recipient: retries must skip it.
    await testDb.insert(lowStockAlertRecipients).values({
      alertId: alert!.id,
      recipientEmail: "DONE@velora.test",
    });
    healthMail();
    await deferOthers(fixtureIds[0]!);

    const run = await processLowStockAlerts({
      batchSize: 1,
      recipientEmails: ["done@velora.test", "ops-a@velora.test", "ops-a@velora.test"],
    });

    expect(run.processed).toBe(1);
    const result = run.results[0]!;
    expect(result.success).toBe(true);
    // Exactly one unique new recipient was sent; the ledger entry suppressed
    // both the already-served inbox AND the env duplicate.
    expect(result.deliveredTo).toEqual(["ops-a@velora.test"]);
    const ledger = await testDb
      .select()
      .from(lowStockAlertRecipients)
      .where(eq(lowStockAlertRecipients.alertId, fixtureIds[0]!));
    expect(ledger.map((r) => r.recipientEmail.toLowerCase()).sort()).toEqual([
      "done@velora.test",
      "ops-a@velora.test",
    ]);
    const [row] = await testDb
      .select()
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.id, fixtureIds[0]!));
    expect(row!.status).toBe("DELIVERED");
    const mailTo = vi
      .mocked(sendMail)
      .mock.calls.map((c) => (c[0] as { to: string }).to.toLowerCase());
    expect(mailTo).toEqual(["ops-a@velora.test"]);
  });

  it("requeues on partial failure and resumes only for missing inboxes", async () => {
    const alertId = fixtureIds[1]!;
    await deferOthers(alertId);
    vi.mocked(sendMail).mockImplementation(async ({ to }) => {
      if (to === "ops-b@velora.test") throw new Error("SMTP 450 ops-b busy");
      return { accepted: [to], messageId: `m-${to}` } as never;
    });

    const first = await processLowStockAlerts({
      batchSize: 1,
      recipientEmails: ["ops-a@velora.test", "ops-b@velora.test"],
      retryDelayMs: 0,
    });
    expect(first.results[0]!.success).toBe(false);
    expect(first.results[0]!.deliveredTo).toEqual(["ops-a@velora.test"]);
    expect(first.results[0]!.pendingRecipients).toEqual(["ops-b@velora.test"]);
    const [rowAfterFirst] = await testDb
      .select()
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.id, alertId));
    expect(rowAfterFirst!.status).toBe("PENDING");

    // Second run: provider healthy. The unique ledger makes re-sending to
    // ops-a impossible — GP-30's duplicate-email window is closed.
    healthMail();
    const callsBeforeRun2 = vi.mocked(sendMail).mock.calls.length;
    const second = await processLowStockAlerts({
      batchSize: 1,
      recipientEmails: ["ops-a@velora.test", "ops-b@velora.test"],
      retryDelayMs: 0,
    });
    expect(second.results[0]!.success).toBe(true);
    const callsDuringRun2 = vi.mocked(sendMail).mock.calls.slice(callsBeforeRun2);
    expect(
      callsDuringRun2.filter((c) => (c[0] as { to: string }).to === "ops-a@velora.test"),
    ).toHaveLength(0);
    expect(callsDuringRun2.map((c) => (c[0] as { to: string }).to)).toEqual([
      "ops-b@velora.test",
    ]);

    // Fresh runs must NOT re-deliver: a later sweep sees the alert as
    // DELIVERED (not due) and touches nothing — after deferring every other
    // row, the sweep claims nothing at all.
    await deferOthers(alertId);
    const again = await processLowStockAlerts({ batchSize: 2, recipientEmails: ["ops-a@velora.test"] });
    expect(again.results.map((r) => r.alertId)).not.toContain(alertId);
  });

  it("reclaims an alert stranded by a crashed worker (stale PROCESSING lease)", async () => {
    const alertId = fixtureIds[2]!;
    await deferOthers(alertId);
    await testDb
      .update(lowStockAlerts)
      .set({
        status: "PROCESSING",
        attempts: 1,
        // DB time — the claim's lease cutoff is DB NOW(), and the DB clock
        // runs ahead of the Node client here.
        lastAttemptAt: sql`NOW() - INTERVAL '11 minutes'`,
      })
      .where(eq(lowStockAlerts.id, alertId));
    healthMail();

    const run = await processLowStockAlerts({
      batchSize: 1,
      recipientEmails: ["ops-a@velora.test"],
      leaseMs: 60_000,
      retryDelayMs: 0,
    });
    expect(run.results[0]!.success).toBe(true);
    await assertStatus(alertId, "DELIVERED");
  });

  it("exhausts the retry budget into a terminal FAILED state", async () => {
    const alertId = fixtureIds[3]!;
    await deferOthers(alertId);
    // attempts=3 pre-set; the claim bumps to 4, failing send pushes the
    // verdict: 4 >= maxRetries(3) → FAILED, not another silent requeue loop.
    await testDb
      .update(lowStockAlerts)
      .set({ status: "PENDING", attempts: 3, lastAttemptAt: null })
      .where(eq(lowStockAlerts.id, alertId));
    vi.mocked(sendMail).mockImplementation(async () => {
      throw new Error("SMTP down for good");
    });

    const run = await processLowStockAlerts({
      batchSize: 1,
      recipientEmails: ["ops-a@velora.test"],
      maxRetries: 3,
      retryDelayMs: 0,
    });
    const own = run.results.find((r) => r.alertId === alertId);
    expect(own, `results: ${JSON.stringify(run.results)} fixtures: ${fixtureIds.join(",")}`).toBeDefined();
    expect(own!.exhausted).toBe(true);
    await assertStatus(alertId, "FAILED");
    healthMail();
  });

  it("defers PENDING rows still inside their retry backoff window", async () => {
    const alertId = fixtureIds[4]!;
    await deferOthers(alertId);
    await testDb
      .update(lowStockAlerts)
      // DB time: the claim's retry cutoff is DB NOW(), so a client "just
      // now" stamp would already look expired under this container's clock
      // skew. NOW() at write time is safely inside the 60s window.
      .set({ status: "PENDING", attempts: 1, lastAttemptAt: sql`NOW()` })
      .where(eq(lowStockAlerts.id, alertId));
    healthMail();

    const run = await processLowStockAlerts({
      batchSize: 2,
      recipientEmails: ["ops-a@velora.test"],
      retryDelayMs: 60_000,
    });
    expect(run.results.map((r) => r.alertId)).not.toContain(alertId);
    await assertStatus(alertId, "PENDING");
  });

  it("skips the run entirely without configured recipients", async () => {
    const run = await processLowStockAlerts({ batchSize: 2, recipientEmails: [] });
    expect(run.processed).toBe(0);
  });

  async function assertStatus(alertId: string, status: (typeof lowStockAlertStatusEnum.enumValues)[number]) {
    const [row] = await testDb
      .select({ status: lowStockAlerts.status })
      .from(lowStockAlerts)
      .where(eq(lowStockAlerts.id, alertId));
    expect(row!.status).toBe(status);
  }
});

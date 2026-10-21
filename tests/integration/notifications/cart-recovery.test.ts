import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
// No SMTP ever leaves the test process; messageId is a static stand-in.
vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn().mockResolvedValue({ messageId: "localhost-test" }),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
  inventory,
} from "../_db";
import { user } from "@/infrastructure/database/schema/auth";
import { cartRecoveryEmails } from "@/infrastructure/database/schema/cart-recovery-emails";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import { sendMail as mockedSendMail } from "@/shared/lib/mail";
import {
  defaultCartRecoveryScanConfig,
  resolveCandidateStage,
  scanAndEnqueueAbandonedCarts,
  type CartRecoveryScanConfig,
  type RecoveryCandidate,
} from "@/modules/notifications/application/cart-recovery-emails";
import { processCartRecoveryRun } from "@/modules/jobs/cart-recovery";

const sendMailMock = vi.mocked(mockedSendMail);

/** Polls until `cond` settles — the enqueue-path first send races tests via
 * a fire-and-forget CAS; both outcomes converge on SENT. */
async function until(cond: () => boolean | Promise<boolean>, maxMs = 3000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("until(): condition did not settle");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const SFX = `cr-${Date.now()}`;
let categoryId = "";
let brandId = "";
const userIds: string[] = [];
const cartIds: string[] = [];
const variantIds: string[] = [];
const productIds: string[] = [];
let userSeq = 0;

async function insertTestUser(disabled = false): Promise<string> {
  userSeq += 1;
  const id = `${SFX}-user-${userSeq}`;
  const [row] = await testDb
    .insert(user)
    .values({
      id,
      name: `Recovery Fixture ${userSeq}`,
      email: `${SFX}-user-${userSeq}@fixture.test`,
      status: disabled ? "NOTACTIVE" : "ACTIVE",
    })
    .returning({ id: user.id });
  userIds.push(row.id);
  return row.id;
}

async function insertFixtureVariant(name: string, stock: number): Promise<string> {
  const [product] = await testDb
    .insert(products)
    .values({
      slug: `${SFX}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      description: null,
      status: "ACTIVE",
      basePrice: "25.00",
      categoryId,
      brandId,
    })
    .returning({ id: products.id });
  productIds.push(product.id);
  const [variant] = await testDb
    .insert(productVariants)
    .values({
      productId: product.id,
      sku: `${SFX}-sku-${name.replace(/[^a-z0-9]/g, "")}`,
      is_active: "ACTIVE",
      price_override: "25.00",
    })
    .returning({ id: productVariants.id });
  variantIds.push(variant.id);
  await testDb.insert(inventory).values({
    variantId: variant.id,
    quantity: stock,
    reserved_quantity: 0,
    low_stock_threshold: 0,
  });
  return variant.id;
}

/**
 * One ACTIVE cart for a fixture user, with `items` real cart rows, whose
 * "left idle" age is written in DB time (D17 — the scanner's freshness
 * comparisons and `now()`-sample are both DB-side, so DB-clock skew is
 * neutralised by construction).
 */
async function insertAbandonedCart(input: {
  userId: string | null;
  guestOnly?: boolean;
  /** DB-time expressions like `now() - interval '6 hours'`. */
  ageSql?: ReturnType<typeof sql>;
  items?: Array<{ variantSku: string; quantity: number }>;
  markStatus?: "ABANDONED" | "CONVERTED";
}): Promise<string> {
  const [cart] = await testDb
    .insert(carts)
    .values({
      userId: input.userId ?? undefined,
      guestId: input.guestOnly ? `guest-${crypto.randomUUID()}` : undefined,
      status: "ACTIVE",
      ...(input.ageSql ? { updatedAt: input.ageSql as never } : {}),
    })
    .returning({ id: carts.id });
  cartIds.push(cart.id);
  if (input.items && input.items.length > 0) {
    const skuRows = await testDb
      .select({ id: productVariants.id, sku: productVariants.sku })
      .from(productVariants)
      .where(sql`${productVariants.sku} LIKE ${SFX + "%"}`);
    const skuMap = new Map(skuRows.map((r) => [r.sku, r.id]));
    for (const item of input.items) {
      await testDb.insert(cartItems).values({
        cartId: cart.id,
        variantId: skuMap.get(`${SFX}-sku-${item.variantSku.replace(/[^a-z0-9]/g, "")}`)!,
        quantity: item.quantity,
      });
    }
    if (input.ageSql) {
      // Scanner freshness = GREATEST(cart.updated_at, cart_items.updated_at):
      // the fixture's items must share the cart's idle age or the scan
      // reads them as brand-new activity.
      await testDb
        .update(cartItems)
        .set({ updatedAt: input.ageSql as never })
        .where(eq(cartItems.cartId, cart.id));
    }
  }
  if (input.markStatus) {
    // Fixture factory for lifecycle variants (e.g. a pre-existing converted
    // cart while a fresh active cart exists for the cap test).
    await testDb.update(carts).set({ status: input.markStatus }).where(eq(carts.id, cart.id));
  }
  return cart.id;
}

/** Wounded-run hardening: sweep the WHOLE cr-% namespace this file family
 * uses (users cascade their carts + recovery rows; catalog fixtures swept
 * by slug/sku namespace). Keyed deletes only — never unscoped (§6). */
async function purgeNamespace() {
  const fixtureUsers = await testDb
    .select({ id: user.id })
    .from(user)
    .where(sql`${user.id} LIKE ${"cr-%"}`);
  if (fixtureUsers.length > 0) {
    await testDb.delete(user).where(inArray(user.id, fixtureUsers.map((u) => u.id)));
  }
  const guestCarts = await testDb
    .select({ id: carts.id })
    .from(carts)
    .where(sql`${carts.guestId} LIKE ${"guest-cr-%"}`);
  if (guestCarts.length > 0) {
    await testDb.delete(cartRecoveryEmails).where(inArray(cartRecoveryEmails.cartId, guestCarts.map((c) => c.id)));
    await testDb.delete(carts).where(inArray(carts.id, guestCarts.map((c) => c.id)));
  }
  const namespaceVariants = await testDb
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(sql`${productVariants.sku} LIKE ${"cr-%"}`);
  if (namespaceVariants.length > 0) {
    await testDb.delete(inventory).where(inArray(inventory.variantId, namespaceVariants.map((v) => v.id)));
    await testDb.delete(productVariants).where(inArray(productVariants.id, namespaceVariants.map((v) => v.id)));
  }
  const namespaceProducts = await testDb
    .select({ id: products.id })
    .from(products)
    .where(sql`${products.slug} LIKE ${"cr-%"}`);
  if (namespaceProducts.length > 0) {
    await testDb.delete(products).where(inArray(products.id, namespaceProducts.map((p) => p.id)));
  }
  await testDb.delete(categories).where(sql`${categories.slug} LIKE ${"cr-%"}`);
  await testDb.delete(brands).where(sql`${brands.slug} LIKE ${"cr-%"}`);
}

beforeAll(async () => {
  await purgeNamespace();
  const [cat] = await testDb
    .insert(categories)
    .values({ slug: `${SFX}-cat`, name: `${SFX} Category`, is_active: true })
    .returning({ id: categories.id });
  categoryId = cat.id;
  const [brand] = await testDb
    .insert(brands)
    .values({ slug: `${SFX}-brand`, name: `${SFX} Brand` })
    .returning({ id: brands.id });
  brandId = brand.id;

  await insertFixtureVariant("Recovery Item One", 10);
  await insertFixtureVariant("Recovery Item Two", 10);
});

afterAll(async () => {
  await purgeNamespace();
});

const defaultConfig = (): CartRecoveryScanConfig => ({
  ...defaultCartRecoveryScanConfig(),
  batchSize: 50,
});

/** DB-time age expressions for cart fixtures (D17). */
const age = {
  idle7h: sql`now() - (interval '7 hours')`,
  idle25h: sql`now() - (interval '25 hours')`,
  fresh: sql`now() - (interval '10 seconds')`,
} as const;

async function recoveryRowsFor(cartId: string) {
  return testDb
    .select()
    .from(cartRecoveryEmails)
    .where(eq(cartRecoveryEmails.cartId, cartId));
}

describe("cart recovery scan (T-5.1)", () => {
  it("enqueues stage 1 for an idle logged-in cart and delivers it", async () => {
    const userId = await insertTestUser();
    const cartId = await insertAbandonedCart({
      userId,
      ageSql: age.idle7h,
      items: [
        { variantSku: "Recovery Item One", quantity: 1 },
        { variantSku: "Recovery Item Two", quantity: 2 },
      ],
    });

    await processCartRecoveryRun();

    const rows = await recoveryRowsFor(cartId);
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe(1);
    // Converges to SENT regardless of whether the enqueue-path dispatch or
    // the worker claim won the first send.
    await until(async () => (await recoveryRowsFor(cartId))[0].status === "SENT");
    expect((await recoveryRowsFor(cartId))[0].sentAt).not.toBeNull();

    // Exactly one send happened — enqueue and worker claims can race, but
    // the CAS lets exactly one win.
    await until(() => sendMailMock.mock.calls.length >= 1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.to).toBe(`${SFX}-user-1@fixture.test`);
    expect(arg.subject).toBe("Your VELORA selection is waiting");
    expect(arg.text).toContain("/cart");
    expect(arg.text).toContain("Recovery Item One");
    expect(arg.text).toContain("Recovery Item Two");
  });

  it("never double-enqueues a stage (unique claim) and respects the cap on rescans", async () => {
    const userId = await insertTestUser();
    const cartId = await insertAbandonedCart({
      userId,
      ageSql: age.idle7h,
      items: [{ variantSku: "Recovery Item One", quantity: 1 }],
    });

    await scanAndEnqueueAbandonedCarts(defaultConfig());
    const afterEnqueue = await recoveryRowsFor(cartId);
    expect(afterEnqueue).toHaveLength(1);

    // The UNIQUE (cart_id, stage) claim + mid-ladder stage rules mean a
    // rescan enqueues nothing: the ladder stops until 24h idle. (The skip
    // counters are aggregate — earlier tests' carts legitimately count too.)
    const afterFirst = await scanAndEnqueueAbandonedCarts(defaultConfig());
    expect(afterFirst.enqueued.find((e) => e.cartId === cartId)).toBeUndefined();
    expect(await recoveryRowsFor(cartId)).toHaveLength(1);
  });

  it("schedules stage 2 only after stage 1 was SENT and 24h elapsed", async () => {
    const userId = await insertTestUser();
    const cartId = await insertAbandonedCart({
      userId,
      ageSql: age.idle25h,
      items: [{ variantSku: "Recovery Item Two", quantity: 1 }],
    });

    await processCartRecoveryRun();
    await until(async () => (await recoveryRowsFor(cartId))[0].status === "SENT");
    expect((await recoveryRowsFor(cartId)).map((r) => r.stage)).toEqual([1]);

    await processCartRecoveryRun();
    const stages = (await recoveryRowsFor(cartId)).map((r) => r.stage).sort();
    expect(stages).toEqual([1, 2]);

    // Pre-inserted QUEUED stage 1 blocks the ladder for another cart.
    const userId2 = await insertTestUser();
    const cartQueued = await insertAbandonedCart({
      userId: userId2,
      ageSql: age.idle25h,
      items: [{ variantSku: "Recovery Item Two", quantity: 1 }],
    });
    await testDb.insert(cartRecoveryEmails).values({
      cartId: cartQueued,
      userId: userId2,
      stage: 1,
      recipientEmail: `${SFX}-queued@fixture.test`,
      subject: "x",
      bodyHtml: "x",
      bodyText: "x",
      status: "QUEUED",
    });
    await processCartRecoveryRun();
    expect((await recoveryRowsFor(cartQueued))).toHaveLength(1);
  });

  it("skips disabled accounts, guest carts, and fresh carts", async () => {
    const disabledId = await insertTestUser(true);
    await insertAbandonedCart({
      userId: disabledId,
      ageSql: age.idle7h,
      items: [{ variantSku: "Recovery Item One", quantity: 1 }],
    });
    const guestCart = await insertAbandonedCart({
      userId: null,
      guestOnly: true,
      ageSql: age.idle7h,
      items: [{ variantSku: "Recovery Item One", quantity: 1 }],
    });
    const freshUserId = await insertTestUser();
    const freshCart = await insertAbandonedCart({
      userId: freshUserId,
      ageSql: age.fresh,
      items: [{ variantSku: "Recovery Item One", quantity: 1 }],
    });

    await processCartRecoveryRun();
    expect((await recoveryRowsFor(guestCart))).toHaveLength(0);
    expect((await recoveryRowsFor(freshCart))).toHaveLength(0);
    const disabledCarts = await testDb
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.userId, disabledId));
    for (const row of disabledCarts) {
      expect(await recoveryRowsFor(row.id)).toHaveLength(0);
    }
  });

  it("applies the per-user frequency cap across abandon cycles", async () => {
    const userId = await insertTestUser();
    const firstCart = await insertAbandonedCart({
      userId,
      ageSql: age.idle7h,
      items: [{ variantSku: "Recovery Item One", quantity: 1 }],
    });
    await processCartRecoveryRun();
    expect(await recoveryRowsFor(firstCart)).toHaveLength(1);

    // New abandon cycle: convert the first cart, open a new active one.
    await testDb.update(carts).set({ status: "CONVERTED" }).where(eq(carts.id, firstCart));
    const secondCart = await insertAbandonedCart({
      userId,
      ageSql: age.idle7h,
      items: [{ variantSku: "Recovery Item Two", quantity: 1 }],
    });

    await processCartRecoveryRun();
    expect(await recoveryRowsFor(secondCart)).toHaveLength(0);
  });
});

describe("cart recovery retry machinery", () => {
  it("reclaims a stale SENDING lease and parks exhausted sends at FAILED", async () => {
    const userId = await insertTestUser();
    const cartId = await insertAbandonedCart({
      userId,
      ageSql: age.idle7h,
      items: [{ variantSku: "Recovery Item One", quantity: 1 }],
    });
    await scanAndEnqueueAbandonedCarts(defaultConfig());
    const [sentRow] = await recoveryRowsFor(cartId);
    expect(sentRow).toBeDefined();
    // The fire-and-forget first send or a worker claim will deliver; either
    // way exactly one CAS winner, one SMTP call.
    await until(async () => (await recoveryRowsFor(cartId))[0].status === "SENT");

    // Let the fire-and-forget enqueue-path send settle before mutating the
    // row (its CAS may win the first send; that is by design).
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Malfunction the transport from now on; a stale lease simulates a
    // crashed worker claiming this row before exhaustion testing.
    sendMailMock.mockRejectedValue(new Error("smtp down"));
    await testDb
      .update(cartRecoveryEmails)
      .set({ status: "SENDING", attempts: 4, sentAt: null, updatedAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(cartRecoveryEmails.id, sentRow.id));

    const run = await processCartRecoveryRun();
    expect(run.due).toBeGreaterThanOrEqual(1);
    expect(run.failed).toBeGreaterThanOrEqual(1);

    const [failed] = await recoveryRowsFor(cartId);
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(5);
    expect(failed.lastError).toContain("smtp down");

    // FAILED terminal rows are never re-due.
    await processCartRecoveryRun();
    const [terminal] = await recoveryRowsFor(cartId);
    expect(terminal.status).toBe("FAILED");
  });

  it("returns 401 when the CRON_SECRET bearer is missing", async () => {
    const { handleCartRecoveryRequest } = await import("@/modules/jobs/cart-recovery");
    const res = await handleCartRecoveryRequest(
      new Request("http://localhost/api/internal/jobs/cart-recovery"),
    );
    expect(res.status).toBe(401);
  });
});

describe("pure stage resolution (resolveCandidateStage)", () => {
  const config = defaultConfig();

  const candidate = (
    idleSeconds: number,
    prior: Array<{ stage: number; status: string }> = [],
    recoveryAgeSeconds: number | null = null,
  ): RecoveryCandidate => ({
    cartId: "c",
    userId: "u",
    email: "e",
    itemCount: 1,
    itemNames: [],
    idleSeconds,
    priorRows: prior,
    recoveryAgeSeconds,
  });

  it("ladders stages and stops at increasing delays", () => {
    // 30h idle, no priors: only stage 1 is claimable (stage-1 SENT gate).
    expect(resolveCandidateStage(candidate(30 * 3600), config)).toBe(1);
    expect(
      resolveCandidateStage(candidate(30 * 3600, [{ stage: 1, status: "SENT" }]), config),
    ).toBe(2);
    expect(
      resolveCandidateStage(candidate(30 * 3600, [{ stage: 1, status: "QUEUED" }]), config),
    ).toBeNull();
    expect(
      resolveCandidateStage(
        candidate(40 * 3600, [{ stage: 1, status: "SENT" }, { stage: 2, status: "SENT" }]),
        config,
      ),
    ).toBeNull();
  });

  it("never re-claims a FAILED stage and blocks its successors", () => {
    expect(
      resolveCandidateStage(candidate(30 * 3600, [{ stage: 1, status: "FAILED" }]), config),
    ).toBeNull();
  });

  it("applies the per-user frequency cap across carts", () => {
    expect(
      resolveCandidateStage(candidate(30 * 3600, [], 1 * 86_400), config),
    ).toBeNull();
    // Outside the window the ladder resumes.
    expect(
      resolveCandidateStage(candidate(30 * 3600, [], 9 * 86_400), config),
    ).toBe(1);
  });

  it("does not re-fire a mid-flight or sent stage", () => {
    expect(
      resolveCandidateStage(candidate(7 * 3600, [{ stage: 1, status: "SENDING" }]), config),
    ).toBeNull();
    expect(
      resolveCandidateStage(candidate(7 * 3600, [{ stage: 1, status: "SENT" }]), config),
    ).toBeNull();
  });
});


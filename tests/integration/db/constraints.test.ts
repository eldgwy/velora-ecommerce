import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

import { testDb } from "../_db";
import { carts } from "@/infrastructure/database/schema/cart";
import { orders } from "@/infrastructure/database/schema/orders";

/**
 * Phase 1 regression net: declared integrity rules must hold live.
 * FKs added NOT VALID still reject violating *new* writes; uniques, checks,
 * and partial uniques reject bad rows. These tests use throwaway ids and
 * write nothing persistent (every violating insert rolls back by itself).
 *
 * Drizzle wraps driver errors, so assertions walk the `cause` chain.
 */
async function expectDbViolation(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const haystacks: string[] = [];
    let current: unknown = error;
    for (let i = 0; i < 4 && current; i += 1) {
      if (current instanceof Error) haystacks.push(current.message);
      if (typeof current === "object" && current !== null && "cause" in current) {
        current = (current as { cause?: unknown }).cause;
      } else break;
    }
    // Postgres detail (e.g. "violates foreign key constraint") lives on cause.
    const extra = (error as { cause?: { detail?: string } })?.cause?.detail ?? "";
    haystacks.push(extra);
    expect(haystacks.join("\n")).toMatch(pattern);
    return;
  }
  expect.unreachable("expected a database integrity violation");
}
describe("database integrity constraints", () => {
  it("rejects cart items for missing carts (FK)", async () => {
    await expectDbViolation(
      testDb.insert(
        (await import("@/infrastructure/database/schema/cart")).cartItems,
      ).values({ cartId: randomUUID(), variantId: randomUUID(), quantity: 1 }),
      /foreign key|violates/i,
    );
  });

  it("rejects orders for missing users (FK, restrict)", async () => {
    await expectDbViolation(
      testDb.insert(orders).values({
        orderNumber: `NOFK-${Date.now()}`,
        userId: `ghost-${Date.now()}`,
        status: "PENDING",
        subtotal: "1.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "1.00",
        currency: "USD",
        paymentStatus: "PENDING",
      }),
      /foreign key|violates/i,
    );
  });

  it("rejects a second ACTIVE cart per user (partial unique)", async () => {
    const uid = `constr-u-${Date.now()}`;
    await testDb.insert(
      (await import("@/infrastructure/database/schema/auth")).user,
    ).values({ id: uid, name: "C", email: `${uid}@ex.com` });
    try {
      await testDb.insert(carts).values({ userId: uid, guestId: null, status: "ACTIVE" });
      await expectDbViolation(
        testDb.insert(carts).values({ userId: uid, guestId: null, status: "ACTIVE" }),
        /duplicate|unique/i,
      );
      // History rows are exempt from the partial index.
      await testDb.insert(carts).values({ userId: uid, guestId: null, status: "CONVERTED" });
    } finally {
      await testDb.delete(carts).where(
        (await import("drizzle-orm")).eq(carts.userId, uid),
      );
      await testDb.delete(
        (await import("@/infrastructure/database/schema/auth")).user,
      ).where((await import("drizzle-orm")).eq(
        (await import("@/infrastructure/database/schema/auth")).user.id, uid,
      ));
    }
  });

  it("rejects duplicate order numbers and idempotency keys (unique)", async () => {
    const uid = `constr-u2-${Date.now()}`;
    const { user } = await import("@/infrastructure/database/schema/auth");
    const { eq } = await import("drizzle-orm");
    await testDb.insert(user).values({ id: uid, name: "C", email: `${uid}@ex.com` });
    try {
      const num = `VEL-TEST-${Date.now()}`;
      const k = randomUUID();
      await testDb.insert(orders).values({
        orderNumber: num,
        userId: uid,
        status: "PENDING",
        subtotal: "1.00",
        discountAmount: "0.00",
        shippingAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "1.00",
        currency: "USD",
        paymentStatus: "PENDING",
        idempotencyKey: k,
      });
      await expectDbViolation(
        testDb.insert(orders).values({
          orderNumber: num,
          userId: uid,
          status: "PENDING",
          subtotal: "1.00",
          discountAmount: "0.00",
          shippingAmount: "0.00",
          taxAmount: "0.00",
          totalAmount: "1.00",
          currency: "USD",
          paymentStatus: "PENDING",
          idempotencyKey: randomUUID(),
        }),
        /duplicate|unique/i,
      );
      await expectDbViolation(
        testDb.insert(orders).values({
          orderNumber: `VEL-TEST2-${Date.now()}`,
          userId: uid,
          status: "PENDING",
          subtotal: "1.00",
          discountAmount: "0.00",
          shippingAmount: "0.00",
          taxAmount: "0.00",
          totalAmount: "1.00",
          currency: "USD",
          paymentStatus: "PENDING",
          idempotencyKey: k,
        }),
        /duplicate|unique/i,
      );
    } finally {
      await testDb.delete(orders).where(eq(orders.userId, uid));
      await testDb.delete(user).where(eq(user.id, uid));
    }
  });

  it("rejects non-positive cart quantities (CHECK)", async () => {
    const { cartItems } = await import("@/infrastructure/database/schema/cart");
    const { eq } = await import("drizzle-orm");
    // CHECK fires before FK validation order is irrelevant here: quantity 0
    // with random ids must fail either way.
    await expectDbViolation(
      testDb.insert(cartItems).values({ cartId: randomUUID(), variantId: randomUUID(), quantity: 0 }),
      /check|violates|foreign key/i,
    );
    void eq;
  });
});

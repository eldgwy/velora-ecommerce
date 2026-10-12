import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

import {
  addCartItemSchema,
  removeCartItemSchema,
  updateCartItemSchema,
} from "@/modules/cart/presentation/schemas/cart.schema";

describe("cart input schemas", () => {
  it("accepts a valid add-item payload", () => {
    const parsed = addCartItemSchema.safeParse({ variantId: randomUUID(), quantity: 2 });
    expect(parsed.success).toBe(true);
  });

  it("rejects zero, negative, fractional, NaN, and oversized quantities", () => {
    const variantId = randomUUID();
    for (const quantity of [0, -1, 1.5, Number.NaN, 1000000]) {
      expect(
        addCartItemSchema.safeParse({ variantId, quantity }).success,
        `quantity ${quantity}`,
      ).toBe(false);
    }
  });

  it("rejects missing or non-uuid variant ids", () => {
    expect(addCartItemSchema.safeParse({ quantity: 1 }).success).toBe(false);
    expect(
      addCartItemSchema.safeParse({ variantId: "not-a-uuid", quantity: 1 }).success,
    ).toBe(false);
  });

  it("strips client-supplied price/total/ownership fields", () => {
    const parsed = addCartItemSchema.safeParse({
      variantId: randomUUID(),
      quantity: 1,
      price: "0.01",
      unitPrice: "0.01",
      subtotal: "0.01",
      userId: "attacker",
      cartId: randomUUID(),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        variantId: expect.any(String),
        quantity: 1,
      });
      expect("price" in parsed.data).toBe(false);
      expect("userId" in parsed.data).toBe(false);
    }
  });

  it("accepts update quantity zero (delete) but rejects negatives", () => {
    expect(
      updateCartItemSchema.safeParse({ itemId: randomUUID(), quantity: 0 }).success,
    ).toBe(true);
    expect(
      updateCartItemSchema.safeParse({ itemId: randomUUID(), quantity: -1 }).success,
    ).toBe(false);
    expect(
      updateCartItemSchema.safeParse({ itemId: randomUUID(), quantity: 2.5 }).success,
    ).toBe(false);
  });

  it("validates remove input", () => {
    expect(removeCartItemSchema.safeParse({ itemId: randomUUID() }).success).toBe(true);
    expect(removeCartItemSchema.safeParse({ itemId: "x" }).success).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

import { wishlistProductSchema } from "@/modules/wishlist/presentation/schemas/wishlist.schema";

describe("wishlist input schema", () => {
  it("accepts a valid product identifier", () => {
    const parsed = wishlistProductSchema.safeParse({ productId: randomUUID() });
    expect(parsed.success).toBe(true);
  });

  it("rejects missing, malformed, and non-uuid identifiers", () => {
    expect(wishlistProductSchema.safeParse({}).success).toBe(false);
    expect(wishlistProductSchema.safeParse({ productId: "not-a-uuid" }).success).toBe(false);
    expect(wishlistProductSchema.safeParse({ productId: 123 }).success).toBe(false);
  });

  it("accepts only the product reference — no ownership or wishlist ids", () => {
    const parsed = wishlistProductSchema.safeParse({
      productId: randomUUID(),
      userId: "attacker",
      wishlistId: randomUUID(),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).toEqual(["productId"]);
    }
  });
});

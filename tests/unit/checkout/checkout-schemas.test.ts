import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

import {
  checkoutInputSchema,
  idempotencyKeySchema,
} from "@/modules/checkout/presentation/schemas/checkout.schema";

const savedAddress = { addressId: randomUUID() };
const newAddress = {
  newAddress: {
    country: "US",
    city: "Cairo",
    state: "Cairo",
    postalCode: "12345",
    addressLine1: "1 Nile St",
  },
};

function validInput() {
  return {
    shippingAddress: savedAddress,
    billingAddress: { sameAsShipping: true },
    shippingMethod: "STANDARD",
    couponCode: "save10",
    contactPhone: "+15551234567",
    paymentMethod: "cod",
    notes: null,
  };
}

describe("checkout input schema", () => {
  it("accepts a complete valid payload and normalizes the coupon", () => {
    const parsed = checkoutInputSchema.safeParse(validInput());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.couponCode).toBe("SAVE10");
  });

  it("accepts new addresses for shipping and billing", () => {
    const parsed = checkoutInputSchema.safeParse({
      ...validInput(),
      shippingAddress: newAddress,
      billingAddress: newAddress,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unsupported shipping methods", () => {
    expect(
      checkoutInputSchema.safeParse({ ...validInput(), shippingMethod: "OVERNIGHT" }).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({ ...validInput(), shippingMethod: "standard" }).success,
    ).toBe(false);
  });

  it("rejects malformed phone numbers", () => {
    expect(
      checkoutInputSchema.safeParse({ ...validInput(), contactPhone: "123" }).success,
    ).toBe(false);
  });

  it("rejects malformed address ids", () => {
    expect(
      checkoutInputSchema.safeParse({
        ...validInput(),
        shippingAddress: { addressId: "nope" },
      }).success,
    ).toBe(false);
  });

  it("rejects client-supplied prices, discounts, shipping, and totals", () => {
    // `.strict()` fails closed on unknown keys: there is no money field to
    // sneak through, and nothing to silently ignore either.
    const parsed = checkoutInputSchema.safeParse({
      ...validInput(),
      subtotal: "0.01",
      total: "0.01",
      shippingAmount: "0.00",
      discountAmount: "999.00",
      unitPrice: "0.01",
      userId: "attacker",
    });
    expect(parsed.success).toBe(false);
  });

  it("validates idempotency keys", () => {
    expect(idempotencyKeySchema.safeParse(randomUUID()).success).toBe(true);
    expect(idempotencyKeySchema.safeParse("not-a-key").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
  });
});

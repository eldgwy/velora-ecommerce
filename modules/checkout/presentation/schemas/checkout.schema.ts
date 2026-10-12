import { z } from "zod";

import { addressSchema } from "@/shared/types/address";

/**
 * Checkout input (FR-08). Only references and method ids cross the boundary —
 * ownership from the session, prices/discounts/shipping/totals from the
 * server. There is intentionally no price, discount, shipping, or total field.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

// Saved-address reference. A foreign or missing id fails closed in the
// command (same response, no ownership oracle).

// One-off address: same field rules as the address book, without book-only
// concerns (label, default flag, third line). Never saved implicitly.
const newAddressSchema = addressSchema
  .pick({
    country: true,
    city: true,
    state: true,
    postalCode: true,
    addressLine1: true,
    addressLine2: true,
  })
  .strict();

const shippingAddressSchema = z.union([
  z.object({ addressId: uuidSchema }).strict(),
  z.object({ newAddress: newAddressSchema }).strict(),
]);

const billingAddressSchema = z.union([
  z.object({ sameAsShipping: z.literal(true) }).strict(),
  z.object({ addressId: uuidSchema }).strict(),
  z.object({ newAddress: newAddressSchema }).strict(),
]);

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export const checkoutInputSchema = z
  .object({
    shippingAddress: shippingAddressSchema,
    billingAddress: billingAddressSchema,
    shippingMethod: z.enum(["STANDARD", "EXPRESS"]),
    couponCode: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((s) => s.toUpperCase())
      .optional()
      .nullable(),
    contactPhone: z
      .string()
      .trim()
      .refine((v) => v === "" || E164_REGEX.test(v), {
        message: "Phone must use E.164 format, e.g. +15551234567.",
      })
      .transform((v) => (v === "" ? null : v))
      .optional()
      .nullable(),
    paymentMethod: z.enum(["card", "cod"]),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export type CheckoutFormValues = z.infer<typeof checkoutInputSchema>;

/** Idempotency key: one uuid per checkout attempt, generated client-side. */
export const idempotencyKeySchema = z
  .string()
  .uuid("Invalid checkout key. Start a new checkout attempt.");

export const orderIdSchema = uuidSchema;

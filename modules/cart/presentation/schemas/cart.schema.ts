import { z } from "zod";

import {
  MAX_QUANTITY_PER_ITEM,
} from "@/modules/cart/domain/rules/cart-rules";

const uuidSchema = z.string().uuid("Invalid identifier.");

const quantitySchema = z
  .number({ error: "Quantity must be a number." })
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(
    MAX_QUANTITY_PER_ITEM,
    `Quantity must not exceed ${MAX_QUANTITY_PER_ITEM}.`,
  );

/**
 * Add-item input (FR-06.02). Only the variant identity and quantity cross
 * the boundary — ownership comes from the session/cookie, the price from the
 * catalog. There is intentionally no price, subtotal, or userId field.
 */
export const addCartItemSchema = z.object({
  variantId: uuidSchema,
  quantity: quantitySchema,
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

/**
 * Update input (FR-06.03). Zero is valid here and deletes the row; negative,
 * fractional, NaN, and oversized values are rejected before any DB access.
 */
export const updateCartItemSchema = z.object({
  itemId: uuidSchema,
  quantity: z
    .number({ error: "Quantity must be a number." })
    .int("Quantity must be a whole number.")
    .min(0, "Quantity must not be negative.")
    .max(
      MAX_QUANTITY_PER_ITEM,
      `Quantity must not exceed ${MAX_QUANTITY_PER_ITEM}.`,
    ),
});

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

export const removeCartItemSchema = z.object({
  itemId: uuidSchema,
});

export type RemoveCartItemInput = z.infer<typeof removeCartItemSchema>;

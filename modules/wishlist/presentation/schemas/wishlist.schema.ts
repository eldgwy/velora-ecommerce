import { z } from "zod";

/** Product-scoped inputs only — no wishlist/item ids cross the boundary,
 *  so there is no identifier to forge into another customer's data. */
export const wishlistProductSchema = z.object({
  productId: z.string().uuid("Invalid product identifier."),
});

export type WishlistProductInput = z.infer<typeof wishlistProductSchema>;

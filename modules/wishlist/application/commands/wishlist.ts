import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { wishlistItems, wishlists } from "@/infrastructure/database/schema";
import { getProductById } from "@/services/catalog-public";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import { ProductNotAvailableError } from "@/modules/wishlist/domain/errors";

export type WishlistRow = typeof wishlists.$inferSelect;
export type WishlistItemRow = typeof wishlistItems.$inferSelect;

/**
 * Find-or-create the customer's single persistent wishlist.
 * The `wishlist_user_id_unique` index arbitrates concurrent creation:
 * losers re-read the winner via `onConflictDoNothing`.
 */
export async function getOrCreateWishlist(userId: string): Promise<WishlistRow> {
  const [existing] = await db
    .select()
    .from(wishlists)
    .where(eq(wishlists.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(wishlists)
    .values({ userId })
    .onConflictDoNothing({ target: wishlists.userId })
    .returning();
  if (created) return created;

  const [winner] = await db
    .select()
    .from(wishlists)
    .where(eq(wishlists.userId, userId));
  if (!winner) throw new Error("Failed to initialize wishlist.");
  return winner;
}

/**
 * Save a product. Eligibility reuses the storefront visibility rules
 * (`getProductById` returns null unless ACTIVE and category-visible), so
 * catalog lifecycle is never bypassed. Duplicate adds are idempotent: the
 * `wishlist_items_wishlist_product_unique` index is the final safeguard and
 * `onConflictDoNothing` makes the write itself race-safe.
 */
export async function addProductToWishlist(
  userId: string,
  productId: string,
): Promise<{ item: WishlistItemRow; wasExisting: boolean }> {
  const product = await getProductById(productId);
  if (!product) throw new ProductNotAvailableError(productId);

  const wishlist = await getOrCreateWishlist(userId);
  const [inserted] = await db
    .insert(wishlistItems)
    .values({ wishlistId: wishlist.id, productId })
    .onConflictDoNothing({
      target: [wishlistItems.wishlistId, wishlistItems.productId],
    })
    .returning();

  if (inserted) return { item: inserted, wasExisting: false };

  const [existing] = await db
    .select()
    .from(wishlistItems)
    .where(
      and(
        eq(wishlistItems.wishlistId, wishlist.id),
        eq(wishlistItems.productId, productId),
      ),
    );
  if (!existing) throw new Error("Failed to save product.");
  return { item: existing, wasExisting: true };
}

/**
 * Remove a product. Ownership is scoped inside the delete itself, so a
 * forged product id can only ever affect the caller's own wishlist.
 * Absent items resolve to `{ removed: false }` — safe to repeat.
 */
export async function removeProductFromWishlist(
  userId: string,
  productId: string,
): Promise<{ removed: boolean }> {
  const [wishlist] = await db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.userId, userId));
  if (!wishlist) return { removed: false };

  const deleted = await db
    .delete(wishlistItems)
    .where(
      and(
        eq(wishlistItems.wishlistId, wishlist.id),
        eq(wishlistItems.productId, productId),
      ),
    )
    .returning({ id: wishlistItems.id });

  return { removed: deleted.length > 0 };
}

/**
 * Move a saved product to the customer's cart. Delegates quantity, stock,
 * and pricing rules to the cart lifecycle — nothing is recalculated here.
 * The wishlist entry is removed only after the cart write succeeds, and the
 * default purchasable variant is resolved through the catalog (first ACTIVE
 * variant). A wishlist never reserves inventory or locks a price.
 */
export async function moveProductToCart(
  userId: string,
  productId: string,
): Promise<{ cartId: string }> {
  const [wishlist] = await db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.userId, userId));
  if (!wishlist) throw new ProductNotAvailableError(productId);

  const [saved] = await db
    .select({ id: wishlistItems.id })
    .from(wishlistItems)
    .where(
      and(
        eq(wishlistItems.wishlistId, wishlist.id),
        eq(wishlistItems.productId, productId),
      ),
    );
  if (!saved) throw new ProductNotAvailableError(productId);

  const product = await getProductById(productId);
  const variant = product?.variants.find((v) => v.status === "ACTIVE") ?? null;
  if (!product || !variant) throw new ProductNotAvailableError(productId);

  const result = await addItemToCart(
    { kind: "user", userId },
    { variantId: variant.id, quantity: 1 },
  );
  await removeProductFromWishlist(userId, productId);
  return { cartId: result.cartId };
}

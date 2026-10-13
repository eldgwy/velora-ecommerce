import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import {
  productImages,
  products,
  wishlistItems,
  wishlists,
} from "@/infrastructure/database/schema";

export interface WishlistListItem {
  itemId: string;
  productId: string;
  productName: string;
  slug: string;
  basePrice: string;
  comparePrice: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVE";
  primaryImageUrl: string | null;
  primaryImageAlt: string | null;
  savedAt: Date;
}

export interface WishlistDetail {
  wishlistId: string | null;
  items: WishlistListItem[];
  itemCount: number;
}

/**
 * The customer's wishlist with live catalog data in a single query —
 * no N+1. Prices and availability always come from the catalog, and items
 * whose products were deleted vanish via the cascade (never shown stale).
 * Products that became DRAFT/ARCHIVE since saving are still listed so the
 * customer can remove them, flagged by `status`.
 */
export async function getWishlistDetail(userId: string): Promise<WishlistDetail> {
  const [wishlist] = await db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.userId, userId));
  if (!wishlist) {
    return { wishlistId: null, items: [], itemCount: 0 };
  }

  const rows = await db
    .select({
      itemId: wishlistItems.id,
      productId: products.id,
      productName: products.name,
      basePrice: products.basePrice,
      comparePrice: products.comparePrice,
      status: products.status,
      primaryImageUrl: productImages.url,
      primaryImageAlt: productImages.alt,
      savedAt: wishlistItems.createdAt,
    })
    .from(wishlistItems)
    .innerJoin(products, eq(products.id, wishlistItems.productId))
    .leftJoin(
      productImages,
      and(
        eq(productImages.productId, products.id),
        eq(productImages.isPrimary, true),
      ),
    )
    .where(eq(wishlistItems.wishlistId, wishlist.id))
    .orderBy(desc(wishlistItems.createdAt));

  const items: WishlistListItem[] = rows.map((row) => ({
    ...row,
    slug: row.productId,
  }));

  return { wishlistId: wishlist.id, items, itemCount: items.length };
}

/**
 * Batched membership check for product lists/cards: one query regardless of
 * list size. Returns the subset of `productIds` the customer has saved.
 */
export async function getSavedProductIds(
  userId: string,
  productIds: string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const [wishlist] = await db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.userId, userId));
  if (!wishlist) return new Set();

  const rows = await db
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(
      and(
        eq(wishlistItems.wishlistId, wishlist.id),
        inArray(wishlistItems.productId, productIds),
      ),
    );
  return new Set(rows.map((row) => row.productId));
}

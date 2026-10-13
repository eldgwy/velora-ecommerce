"use server";

import { revalidatePath } from "next/cache";

import { getCurrentSession } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import { addProductToWishlist, moveProductToCart, removeProductFromWishlist } from "@/modules/wishlist/application/commands/wishlist";
import {
  getSavedProductIds,
  getWishlistDetail,
  type WishlistDetail,
} from "@/modules/wishlist/application/queries/wishlist";
import { ProductNotAvailableError } from "@/modules/wishlist/domain/errors";
import { wishlistProductSchema } from "@/modules/wishlist/presentation/schemas/wishlist.schema";

const WISHLIST_PATH = "/account/wishlist";

/** Action result plus an optional guest sign-in destination. */
export type WishlistActionResult<T = void> = ActionResult<T> & {
  redirect?: string;
};

/** Guests get a sign-in prompt carrying them back, never a persisted wishlist. */
async function requireWishlistUser(): Promise<
  { ok: true; userId: string } | { ok: false; error: string; redirect: string }
> {
  const session = await getCurrentSession();
  if (!session) {
    return {
      ok: false,
      error: "Sign in to save products to your wishlist.",
      redirect: `/login?callbackUrl=${encodeURIComponent(WISHLIST_PATH)}`,
    };
  }
  return { ok: true, userId: session.user.id } as const;
}

function logFailure(action: string, error: unknown, userId?: string): void {
  logger.error(`Wishlist action failed: ${action}`, {
    module: "wishlist",
    action,
    userId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

export async function addToWishlistAction(
  input: unknown,
): Promise<WishlistActionResult<{ saved: boolean }>> {
  const auth = await requireWishlistUser();
  if (!auth.ok) return { ok: false, error: auth.error, redirect: auth.redirect };
  const parsed = wishlistProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const { wasExisting } = await addProductToWishlist(auth.userId, parsed.data.productId);
    revalidatePath(WISHLIST_PATH);
    return { ok: true, data: { saved: !wasExisting } };
  } catch (error) {
    if (error instanceof ProductNotAvailableError) {
      return { ok: false, error: "That product is no longer available." };
    }
    logFailure("addToWishlist", error, auth.userId);
    return { ok: false, error: "We couldn't save that product." };
  }
}

export async function removeFromWishlistAction(
  input: unknown,
): Promise<WishlistActionResult<{ removed: boolean }>> {
  const auth = await requireWishlistUser();
  if (!auth.ok) return { ok: false, error: auth.error, redirect: auth.redirect };
  const parsed = wishlistProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const { removed } = await removeProductFromWishlist(auth.userId, parsed.data.productId);
    revalidatePath(WISHLIST_PATH);
    return { ok: true, data: { removed } };
  } catch (error) {
    logFailure("removeFromWishlist", error, auth.userId);
    return { ok: false, error: "We couldn't update your wishlist." };
  }
}

/** Toggle helper for product cards: one call from either visual state. */
export async function toggleWishlistAction(
  input: unknown,
): Promise<WishlistActionResult<{ saved: boolean }>> {
  const auth = await requireWishlistUser();
  if (!auth.ok) return { ok: false, error: auth.error, redirect: auth.redirect };
  const parsed = wishlistProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const saved = await getSavedProductIds(auth.userId, [parsed.data.productId]);
  if (saved.has(parsed.data.productId)) {
    return removeFromWishlistAction(input).then((res) =>
      res.ok ? { ok: true as const, data: { saved: false } } : res,
    );
  }
  return addToWishlistAction(input);
}

/**
 * Move a saved product to the cart. Delegates quantity, stock, and pricing
 * rules to the cart lifecycle — nothing is recalculated here. The wishlist
 * entry is removed only after the cart write succeeds. A wishlist never
 * reserves inventory or locks a price.
 */
export async function moveToCartAction(
  input: unknown,
): Promise<WishlistActionResult<{ cartId: string }>> {
  const auth = await requireWishlistUser();
  if (!auth.ok) return { ok: false, error: auth.error, redirect: auth.redirect };
  const parsed = wishlistProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const result = await moveProductToCart(auth.userId, parsed.data.productId);
    revalidatePath(WISHLIST_PATH);
    return { ok: true, data: { cartId: result.cartId } };
  } catch (error) {
    if (error instanceof ProductNotAvailableError) {
      return { ok: false, error: "That product is no longer purchasable." };
    }
    logFailure("moveToCart", error, auth.userId);
    return { ok: false, error: "We couldn't move that product to your bag." };
  }
}

/** Batched saved-state for product lists; guests always get an empty set. */
export async function getWishlistStateAction(
  productIds: string[],
): Promise<{ savedIds: string[] }> {
  const session = await getCurrentSession();
  if (!session || !Array.isArray(productIds)) return { savedIds: [] };
  const valid = productIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  ).slice(0, 100);
  const saved = await getSavedProductIds(session.user.id, valid);
  return { savedIds: [...saved] };
}

export async function getWishlistAction(): Promise<
  WishlistActionResult<WishlistDetail>
> {
  const auth = await requireWishlistUser();
  if (!auth.ok) return { ok: false, error: auth.error, redirect: auth.redirect };
  const detail = await getWishlistDetail(auth.userId);
  return { ok: true, data: detail };
}


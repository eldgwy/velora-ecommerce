"use server";

import { cookies } from "next/headers";

import { getCurrentSession } from "@/shared/lib/guards";
import { invalidateCartCache } from "@/shared/lib/cache/tags";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  GUEST_CART_COOKIE_NAME,
  createGuestCartCookie,
  guestCartCookieOptions,
  newGuestId,
  verifyGuestCartCookie,
} from "@/modules/cart/domain/guest-cookie";
import type { CartOwner } from "@/modules/cart/application/cart-context";
import { addItemToCart } from "@/modules/cart/application/commands/add-item";
import {
  removeCartItem,
  updateCartItemQuantity,
} from "@/modules/cart/application/commands/update-item";
import {
  mergeGuestCartIntoUserCart,
  type GuestMergeResult,
} from "@/modules/cart/application/commands/merge-guest-cart";
import {
  getCartDetail,
  type CartDetail,
} from "@/modules/cart/application/queries/get-cart";
import {
  validateCartForCheckout,
} from "@/modules/cart/application/queries/validate-cart";
import type { CartValidationResult, MergeCartResult } from "@/modules/cart/domain/types";
import {
  addCartItemSchema,
  removeCartItemSchema,
  updateCartItemSchema,
} from "@/modules/cart/presentation/schemas/cart.schema";
import {
  CartItemNotFoundError,
  InsufficientStockError,
  InvalidCartItemQuantityError,
  ProductInactiveError,
  UnauthorizedCartAccessError,
  VariantInactiveError,
  VariantNotFoundError,
} from "@/modules/cart/domain/errors";

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

async function resolveOwner(): Promise<{ owner: CartOwner }> {
  const session = await getCurrentSession();
  if (session) {
    return { owner: { kind: "user", userId: session.user.id } };
  }

  const jar = await cookies();
  const raw = jar.get(GUEST_CART_COOKIE_NAME)?.value ?? null;
  const verified = verifyGuestCartCookie(raw);
  if (verified) {
    return { owner: { kind: "guest", guestId: verified.guestId } };
  }

  // No usable cookie: allocate a token. The cookie is written only after a
  // cart row actually exists (mutations), never for bare reads.
  return { owner: { kind: "guest", guestId: newGuestId() } };
}

/**
 * Authenticated resolution with opportunistic guest merge. Login is
 * client-side (Better Auth), so there is no server login hook: the first
 * authenticated cart interaction after login converges guest state into the
 * user cart. The guest cookie is cleared only when fully consumed; leftovers
 * stay mergeable and are reported for user resolution.
 */
async function resolveOwnerWithMerge(): Promise<{
  owner: CartOwner;
  merge: MergeCartResult & { guestCartConsumed: boolean } | null;
}> {
  const session = await getCurrentSession();
  if (!session) {
    const guest = await resolveOwner();
    return { owner: guest.owner, merge: null };
  }

  const jar = await cookies();
  const raw = jar.get(GUEST_CART_COOKIE_NAME)?.value ?? null;
  const verified = verifyGuestCartCookie(raw);
  if (!verified) {
    if (raw !== null) {
      // Tampered or malformed: drop it so it cannot linger.
      jar.delete(GUEST_CART_COOKIE_NAME);
    }
    return { owner: { kind: "user", userId: session.user.id }, merge: null };
  }

  let merge: GuestMergeResult | null = null;
  try {
    merge = await mergeGuestCartIntoUserCart(session.user.id, verified.guestId);
  } catch (error) {
    logger.error("Guest cart merge failed", {
      module: "cart",
      action: "mergeGuestCart",
      userId: session.user.id,
    });
    void error;
    return { owner: { kind: "user", userId: session.user.id }, merge: null };
  }

  if (merge.guestCartConsumed) {
    jar.delete(GUEST_CART_COOKIE_NAME);
  }
  await invalidateCartCache({ userId: session.user.id, guestId: verified.guestId });
  return { owner: { kind: "user", userId: session.user.id }, merge };
}

async function persistGuestCookie(guestId: string): Promise<void> {
  const jar = await cookies();
  const { name: _name, ...options } = guestCartCookieOptions;
  void _name;
  jar.set(GUEST_CART_COOKIE_NAME, createGuestCartCookie(guestId), options);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof VariantNotFoundError) return "That item could not be found.";
  if (error instanceof VariantInactiveError) return "That item is no longer available.";
  if (error instanceof ProductInactiveError) return "That item is no longer available.";
  if (error instanceof InsufficientStockError) return error.message;
  if (error instanceof InvalidCartItemQuantityError) return error.message;
  if (error instanceof UnauthorizedCartAccessError) {
    return "Cart item not found in your cart.";
  }
  if (error instanceof CartItemNotFoundError) return "Cart item not found in your cart.";
  return "We couldn't update your cart. Please try again.";
}

function logFailure(action: string, error: unknown, userId?: string): void {
  // Never log cookies, session tokens, or item internals beyond ids.
  logger.error(`Cart action failed: ${action}`, {
    module: "cart",
    action,
    userId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

// ---------------------------------------------------------------------------
// Actions (thin controllers — business rules live in application/domain)
// ---------------------------------------------------------------------------

export async function addToCart(input: unknown): Promise<ActionResult<{ cartId: string }>> {
  const parsed = addCartItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { owner, merge } = await resolveOwnerWithMerge();
  void merge;
  try {
    const result = await addItemToCart(owner, parsed.data);
    if (owner.kind === "guest") await persistGuestCookie(owner.guestId);
    await invalidateCartCache({
      cartId: result.cartId,
      ...(owner.kind === "user" ? { userId: owner.userId } : { guestId: owner.guestId }),
    });
    return { ok: true, data: { cartId: result.cartId } };
  } catch (error) {
    logFailure("addToCart", error, owner.kind === "user" ? owner.userId : undefined);
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function updateCartItem(input: unknown): Promise<ActionResult<{ cartId: string }>> {
  const parsed = updateCartItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { owner } = await resolveOwnerWithMerge();
  try {
    const result = await updateCartItemQuantity(owner, parsed.data);
    if (owner.kind === "guest") await persistGuestCookie(owner.guestId);
    await invalidateCartCache({
      cartId: result.cartId,
      ...(owner.kind === "user" ? { userId: owner.userId } : { guestId: owner.guestId }),
    });
    return { ok: true, data: { cartId: result.cartId } };
  } catch (error) {
    logFailure("updateCartItem", error, owner.kind === "user" ? owner.userId : undefined);
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function removeCartItemAction(
  input: unknown,
): Promise<ActionResult<{ cartId: string }>> {
  const parsed = removeCartItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { owner } = await resolveOwnerWithMerge();
  try {
    const result = await removeCartItem(owner, parsed.data);
    if (owner.kind === "guest") await persistGuestCookie(owner.guestId);
    await invalidateCartCache({
      cartId: result.cartId,
      ...(owner.kind === "user" ? { userId: owner.userId } : { guestId: owner.guestId }),
    });
    return { ok: true, data: { cartId: result.cartId } };
  } catch (error) {
    logFailure("removeCartItem", error, owner.kind === "user" ? owner.userId : undefined);
    return { ok: false, error: toErrorMessage(error) };
  }
}

/** Read-only cart detail (no merge side effects beyond convergence). */
export async function getCartAction(): Promise<
  ActionResult<{ detail: CartDetail; merge: (MergeCartResult & { guestCartConsumed: boolean }) | null }>
> {
  const session = await getCurrentSession();
  if (session) {
    const { owner, merge } = await resolveOwnerWithMerge();
    const detail = await getCartDetail(owner);
    return { ok: true, data: { detail, merge } };
  }
  const { owner } = await resolveOwner();
  const detail = await getCartDetail(owner);
  return { ok: true, data: { detail, merge: null } };
}

/** Pre-checkout validation (validation-only: no order, payment, or reservation). */
export async function validateCartAction(): Promise<ActionResult<CartValidationResult>> {
  const { owner } = await resolveOwnerWithMerge();
  const result = await validateCartForCheckout(owner);
  return { ok: true, data: result };
}

/**
 * Explicit guest-to-user merge (e.g. post-login landing). Safe to call
 * repeatedly: retries only process leftovers, and a consumed guest cart
 * yields an empty success.
 */
export async function mergeGuestCartAction(): Promise<ActionResult<MergeCartResult>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in to merge carts." };

  const jar = await cookies();
  const verified = verifyGuestCartCookie(jar.get(GUEST_CART_COOKIE_NAME)?.value ?? null);
  if (!verified) return { ok: false, error: "No guest cart to merge." };

  try {
    const result = await mergeGuestCartIntoUserCart(session.user.id, verified.guestId);
    if (result.guestCartConsumed) jar.delete(GUEST_CART_COOKIE_NAME);
    await invalidateCartCache({ userId: session.user.id, guestId: verified.guestId });
    return { ok: true, data: result };
  } catch (error) {
    logFailure("mergeGuestCart", error, session.user.id);
    return { ok: false, error: "We couldn't merge your guest cart. Please try again." };
  }
}

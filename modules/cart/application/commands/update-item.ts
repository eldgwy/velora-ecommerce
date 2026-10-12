import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import {
  CartItemNotFoundError,
  InsufficientStockError,
  InvalidCartItemQuantityError,
  ProductInactiveError,
  UnauthorizedCartAccessError,
  VariantInactiveError,
  VariantNotFoundError,
} from "@/modules/cart/domain/errors";
import {
  MAX_QUANTITY_PER_ITEM,
  isPurchasable,
} from "@/modules/cart/domain/rules/cart-rules";
import {
  lockCartItems,
  resolveCatalogEntry,
  runWithUniqueRetry,
  type CartOwner,
  type CartItemRow,
} from "@/modules/cart/application/cart-context";
import { resolveOwnerCart } from "@/modules/cart/application/commands/cart-init";

export type UpdateItemResult =
  | { status: "updated"; item: CartItemRow; cartId: string }
  | { status: "deleted"; itemId: string; cartId: string };

/**
 * Update a cart-item quantity (FR-06.03).
 *
 * - Quantity must be a non-negative integer; zero deletes the row immediately.
 * - Positive quantities revalidate variant/product ACTIVE status, the
 *   MAX_QUANTITY_PER_ITEM cap, and live availability.
 * - Ownership is verified: the item must belong to the caller's ACTIVE cart.
 *   A client-supplied item id is never proof of ownership.
 * - The price snapshot is refreshed to the latest observed authoritative
 *   list price (consistent with add-item semantics).
 */
export async function updateCartItemQuantity(
  owner: CartOwner,
  input: { itemId: string; quantity: number },
): Promise<UpdateItemResult> {
  const { itemId, quantity } = input;

  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new InvalidCartItemQuantityError(
      "Quantity must be a non-negative integer.",
    );
  }
  if (quantity > MAX_QUANTITY_PER_ITEM) {
    throw new InvalidCartItemQuantityError(
      `Quantity must not exceed ${MAX_QUANTITY_PER_ITEM}.`,
    );
  }

  return runWithUniqueRetry(() =>
    db.transaction(async (tx) => {
      const cart = await resolveOwnerCart(owner);
      await lockCartItems(tx, cart.id);

      const [item] = await tx
        .select()
        .from(cartItems)
        .where(
          and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)),
        );
      if (!item) {
        // Either missing or owned by someone else's cart — same response to
        // avoid leaking which item ids exist (BR-008 ownership isolation).
        throw new UnauthorizedCartAccessError(
          "Cart item not found in your cart.",
        );
      }

      if (quantity === 0) {
        await tx.delete(cartItems).where(eq(cartItems.id, item.id));
        await touchCart(tx, cart.id);
        return { status: "deleted", itemId: item.id, cartId: cart.id } as const;
      }

      const entry = await resolveCatalogEntry(item.variantId);
      if (!entry) throw new VariantNotFoundError(item.variantId);
      if (entry.variantStatus !== "ACTIVE" || !isPurchasable(entry.variantStatus, entry.productStatus)) {
        throw new VariantInactiveError(item.variantId);
      }
      if (entry.productStatus !== "ACTIVE") {
        throw new ProductInactiveError(entry.productId);
      }
      if (quantity > entry.availableStock) {
        throw new InsufficientStockError(
          `Only ${entry.availableStock} unit(s) available for this variant.`,
        );
      }

      const [updated] = await tx
        .update(cartItems)
        .set({
          quantity,
          priceAtAddition: entry.listPrice,
          updatedAt: new Date(),
        })
        .where(eq(cartItems.id, item.id))
        .returning();
      if (!updated) throw new CartItemNotFoundError(itemId);
      await touchCart(tx, cart.id);
      return { status: "updated", item: updated, cartId: cart.id } as const;
    }),
  );
}

/**
 * Remove a cart item (FR-06.03). Ownership-verified; repeated removal of the
 * same id is safe (idempotent success).
 */
export async function removeCartItem(
  owner: CartOwner,
  input: { itemId: string },
): Promise<{ status: "deleted"; itemId: string; cartId: string }> {
  return db.transaction(async (tx) => {
    const cart = await resolveOwnerCart(owner);
    await lockCartItems(tx, cart.id);

    const [item] = await tx
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(
        and(eq(cartItems.id, input.itemId), eq(cartItems.cartId, cart.id)),
      );

    // Missing or foreign item: still success (idempotent), still scoped to
    // the caller's cart so no cross-user information leaks.
    if (item) {
      await tx.delete(cartItems).where(eq(cartItems.id, item.id));
      await touchCart(tx, cart.id);
    }
    return { status: "deleted", itemId: input.itemId, cartId: cart.id } as const;
  });
}

async function touchCart(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  cartId: string,
): Promise<void> {
  await tx
    .update(carts)
    .set({ updatedAt: new Date() })
    .where(eq(carts.id, cartId));
}

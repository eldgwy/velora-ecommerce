import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import type {
  AdjustedCartItem,
  MergedCartItem,
  MergeCartResult,
  UnavailableCartItem,
  ActionRequiredItem,
} from "@/modules/cart/domain/types";
import {
  MAX_DISTINCT_ITEMS,
  MAX_QUANTITY_PER_ITEM,
  isPurchasable,
  mergeQuantities,
} from "@/modules/cart/domain/rules/cart-rules";
import {
  isUniqueViolation,
  lockCartItems,
  resolveCatalogEntry,
  type CartItemRow,
} from "@/modules/cart/application/cart-context";

export interface GuestMergeResult extends MergeCartResult {
  /** True when the guest cart was fully consumed (safe to clear the cookie). */
  guestCartConsumed: boolean;
}

const EMPTY_RESULT: GuestMergeResult = {
  mergedItems: [],
  adjustedItems: [],
  unavailableItems: [],
  invalidVariants: [],
  itemsRequiringAction: [],
  guestCartConsumed: true,
};

/**
 * Guest-to-user merge (FR-06.01).
 *
 * Conflict policy — cap-and-retain: when a merged quantity exceeds available
 * stock (or the per-item cap), the valid portion is preserved in the user
 * cart and the remainder stays in the guest cart for user resolution. Nothing
 * is silently discarded: every outcome lands in the structured result.
 *
 * Safety properties:
 * - Single transaction: user upserts + guest deletes/adjustments commit
 *   together, so failures never partially corrupt either cart.
 * - Idempotent: already-moved rows are gone from the guest cart, so a retry
 *   only processes leftovers. A fully-consumed guest cart is CONVERTED and a
 *   retry returns an empty success.
 * - Concurrent merges serialize on the guest cart row (FOR UPDATE); the loser
 *   re-reads post-commit state and returns empty success.
 * - Never merges a cart row owned by a user (userId IS NULL required) and
 *   never authorizes cross-user access: ownership comes from the verified
 *   session (userId) and the verified cookie (guestId), not client fields.
 * - No inventory is reserved here; quantities are validated against live
 *   availability and checkout revalidates + reserves atomically.
 */
export async function mergeGuestCartIntoUserCart(
  userId: string,
  guestId: string,
): Promise<GuestMergeResult> {
  return db.transaction(async (tx) => {
    const mergedItems: MergedCartItem[] = [];
    const adjustedItems: AdjustedCartItem[] = [];
    const unavailableItems: UnavailableCartItem[] = [];
    const invalidVariants: string[] = [];
    const itemsRequiringAction: ActionRequiredItem[] = [];

    // 1. Resolve (or create) the user's ACTIVE cart inside the transaction.
    let userCartId: string | null = null;
    const [existingUserCart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.userId, userId), eq(carts.status, "ACTIVE")));
    if (existingUserCart) {
      userCartId = existingUserCart.id;
    } else {
      try {
        const [created] = await tx
          .insert(carts)
          .values({ userId, guestId: null, status: "ACTIVE" })
          .returning({ id: carts.id });
        userCartId = created?.id ?? null;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const [winner] = await tx
          .select({ id: carts.id })
          .from(carts)
          .where(and(eq(carts.userId, userId), eq(carts.status, "ACTIVE")));
        userCartId = winner?.id ?? null;
      }
    }
    if (!userCartId) throw new Error("Failed to resolve user cart");

    // 2. Lock the guest cart row (or learn it is already consumed).
    const guestRows = (await tx.execute(sql`
      SELECT id FROM cart
      WHERE guest_id = ${guestId}
        AND user_id IS NULL
        AND status = 'ACTIVE'
      FOR UPDATE
    `)) as Array<{ id: string }>;
    const guestCartId = guestRows[0]?.id ?? null;
    if (!guestCartId) {
      // No ACTIVE guest cart: nothing to merge (first merge already
      // consumed it, or the guest never had one). Idempotent success.
      return { ...EMPTY_RESULT, mergedItems: [], adjustedItems: [] };
    }
    if (guestCartId === userCartId) {
      throw new Error("Guest cart collides with user cart");
    }

    // 3. Serialize item writers (lock in stable id order: no deadlock).
    const [firstLock, secondLock] =
      userCartId < guestCartId
        ? [userCartId, guestCartId]
        : [guestCartId, userCartId];
    await lockCartItems(tx, firstLock);
    await lockCartItems(tx, secondLock);

    const guestItems = await tx
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, guestCartId));

    if (guestItems.length === 0) {
      await markGuestConsumed(tx, guestCartId);
      return { ...EMPTY_RESULT };
    }

    const userItems = await tx
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, userCartId));
    const userByVariant = new Map<string, CartItemRow>(
      userItems.map((item) => [item.variantId, item]),
    );
    let userDistinctCount = userItems.length;

    // 4. Move each guest item with full validation.
    for (const guestItem of guestItems) {
      const entry = await resolveCatalogEntry(guestItem.variantId);

      if (!entry) {
        invalidVariants.push(guestItem.variantId);
        continue; // retained in guest cart for visibility
      }

      const purchasable = isPurchasable(entry.variantStatus, entry.productStatus);
      if (!purchasable) {
        unavailableItems.push({
          variantId: guestItem.variantId,
          requestedQuantity: guestItem.quantity,
          reason: "inactive",
        });
        continue; // retained in guest cart
      }

      const existing = userByVariant.get(guestItem.variantId) ?? null;
      const authQuantity = existing?.quantity ?? 0;
      const requested = mergeQuantities(authQuantity, guestItem.quantity);
      const target = Math.min(requested, entry.availableStock, MAX_QUANTITY_PER_ITEM);

      if (target <= authQuantity) {
        // Nothing mergeable: out of stock, or the user cart already holds
        // the valid portion. Retained for user resolution.
        if (entry.availableStock <= 0 && !existing) {
          unavailableItems.push({
            variantId: guestItem.variantId,
            requestedQuantity: guestItem.quantity,
            reason: "out_of_stock",
          });
        } else {
          itemsRequiringAction.push({
            variantId: guestItem.variantId,
            guestQuantity: guestItem.quantity,
            authQuantity,
            availableStock: entry.availableStock,
            reason: "exceeds_stock",
          });
        }
        continue;
      }

      if (!existing && userDistinctCount >= MAX_DISTINCT_ITEMS) {
        itemsRequiringAction.push({
          variantId: guestItem.variantId,
          guestQuantity: guestItem.quantity,
          authQuantity,
          availableStock: entry.availableStock,
          reason: "conflict",
        });
        continue; // retained; user cart is at the distinct-item cap
      }

      if (!existing) {
        const [inserted] = await tx
          .insert(cartItems)
          .values({
            cartId: userCartId,
            variantId: guestItem.variantId,
            quantity: target,
            priceAtAddition: entry.listPrice,
          })
          .returning();
        if (!inserted) throw new Error("Failed to merge cart item");
        userByVariant.set(guestItem.variantId, inserted);
        userDistinctCount += 1;
      } else {
        const [updated] = await tx
          .update(cartItems)
          .set({
            quantity: target,
            priceAtAddition: entry.listPrice,
            updatedAt: new Date(),
          })
          .where(eq(cartItems.id, existing.id))
          .returning();
        if (!updated) throw new Error("Failed to merge cart item");
        userByVariant.set(guestItem.variantId, updated);
      }

      const remainder = requested - target;
      if (remainder > 0) {
        // Cap-and-retain: valid portion moved, remainder stays for resolution.
        await tx
          .update(cartItems)
          .set({ quantity: remainder, updatedAt: new Date() })
          .where(eq(cartItems.id, guestItem.id));
        adjustedItems.push({
          cartItemId: userByVariant.get(guestItem.variantId)!.id,
          variantId: guestItem.variantId,
          requestedQuantity: requested,
          availableQuantity: entry.availableStock,
          adjustedQuantity: target,
        });
        itemsRequiringAction.push({
          variantId: guestItem.variantId,
          guestQuantity: guestItem.quantity,
          authQuantity,
          availableStock: entry.availableStock,
          reason: "exceeds_stock",
        });
      } else {
        await tx.delete(cartItems).where(eq(cartItems.id, guestItem.id));
        mergedItems.push({
          cartItemId: userByVariant.get(guestItem.variantId)!.id,
          variantId: guestItem.variantId,
          quantity: target,
          wasExisting: existing !== null,
        });
      }
    }

    // 5. Consume the guest cart only when fully drained.
    const [leftover] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(cartItems)
      .where(eq(cartItems.cartId, guestCartId));
    const guestCartConsumed = (leftover?.count ?? 0) === 0;
    if (guestCartConsumed) {
      await markGuestConsumed(tx, guestCartId);
    }

    await tx
      .update(carts)
      .set({ updatedAt: new Date() })
      .where(eq(carts.id, userCartId));

    return {
      mergedItems,
      adjustedItems,
      unavailableItems,
      invalidVariants,
      itemsRequiringAction,
      guestCartConsumed,
    };
  });
}

async function markGuestConsumed(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  guestCartId: string,
): Promise<void> {
  await tx
    .update(carts)
    .set({ status: "CONVERTED", updatedAt: new Date() })
    .where(
      and(
        eq(carts.id, guestCartId),
        isNull(carts.userId),
        eq(carts.status, "ACTIVE"),
      ),
    );
}

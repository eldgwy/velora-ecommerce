import { and, eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import {
  InsufficientStockError,
  InvalidCartItemQuantityError,
  ProductInactiveError,
  VariantInactiveError,
  VariantNotFoundError,
} from "@/modules/cart/domain/errors";
import {
  MAX_DISTINCT_ITEMS,
  MAX_QUANTITY_PER_ITEM,
  isPurchasable,
} from "@/modules/cart/domain/rules/cart-rules";
import {
  isUniqueViolation,
  lockCartItems,
  resolveCatalogEntry,
  runWithUniqueRetry,
  type CartOwner,
  type CartItemRow,
} from "@/modules/cart/application/cart-context";
import { findOrCreateGuestCart, findOrCreateUserCart } from "@/modules/cart/application/commands/cart-init";

export interface AddItemResult {
  item: CartItemRow;
  cartId: string;
  /** True when the variant was already in the cart (quantity combined). */
  wasExisting: boolean;
}

/**
 * Add an item to the cart (FR-06.02).
 *
 * Server-side process: the caller passes only variantId + quantity (already
 * Zod-validated at the presentation boundary). Variant existence, ACTIVE
 * status, live availability, quantity limits, and the authoritative catalog
 * price are all resolved here. Client-supplied prices are not accepted —
 * there is no parameter for them.
 *
 * Concurrency: writers of one cart are serialized with a cart-items lock;
 * the (cartId, variantId) unique index is the final backstop and a lost
 * insert race retries once. Inventory is deliberately NOT reserved here —
 * a cart is not a reservation. Availability is checked against live stock,
 * but stock may change before checkout; final order creation revalidates
 * and reserves atomically through the existing reservation lifecycle.
 */
export async function addItemToCart(
  owner: CartOwner,
  input: { variantId: string; quantity: number },
): Promise<AddItemResult> {
  const { variantId, quantity } = input;

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new InvalidCartItemQuantityError("Quantity must be an integer of at least 1.");
  }
  if (quantity > MAX_QUANTITY_PER_ITEM) {
    throw new InvalidCartItemQuantityError(
      `Quantity must not exceed ${MAX_QUANTITY_PER_ITEM} per item.`,
    );
  }

  const entry = await resolveCatalogEntry(variantId);
  if (!entry) throw new VariantNotFoundError(variantId);
  if (entry.variantStatus !== "ACTIVE") throw new VariantInactiveError(variantId);
  if (entry.productStatus !== "ACTIVE") throw new ProductInactiveError(entry.productId);
  if (!isPurchasable(entry.variantStatus, entry.productStatus)) {
    throw new VariantInactiveError(variantId);
  }

  return runWithUniqueRetry(() =>
    db.transaction(async (tx) => {
      const cart =
        owner.kind === "user"
          ? await tx
              .select()
              .from(carts)
              .where(
                and(eq(carts.userId, owner.userId), eq(carts.status, "ACTIVE")),
              )
              .then((rows) => rows[0] ?? null)
          : await tx
              .select()
              .from(carts)
              .where(
                and(
                  eq(carts.guestId, owner.guestId),
                  eq(carts.status, "ACTIVE"),
                ),
              )
              .then((rows) => rows[0] ?? null);

      // Resolve inside the transaction so creation also benefits from the
      // unique backstop under concurrency (find-or-create helpers use the
      // ambient `db`, which is fine outside; here we stay in-tx).
      const activeCart = cart ?? (await createCartInTx(tx, owner));

      await lockCartItems(tx, activeCart.id);

      const [existing] = await tx
        .select()
        .from(cartItems)
        .where(
          and(
            eq(cartItems.cartId, activeCart.id),
            eq(cartItems.variantId, variantId),
          ),
        );

      const resultingQuantity = (existing?.quantity ?? 0) + quantity;

      if (resultingQuantity > MAX_QUANTITY_PER_ITEM) {
        throw new InvalidCartItemQuantityError(
          `Cart quantity for this item must not exceed ${MAX_QUANTITY_PER_ITEM}.`,
        );
      }
      if (resultingQuantity > entry.availableStock) {
        throw new InsufficientStockError(
          `Only ${entry.availableStock} unit(s) available for this variant.`,
        );
      }

      if (!existing) {
        const [countRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(cartItems)
          .where(eq(cartItems.cartId, activeCart.id));
        const count = countRow?.count ?? 0;
        if (count >= MAX_DISTINCT_ITEMS) {
          throw new InvalidCartItemQuantityError(
            `A cart holds at most ${MAX_DISTINCT_ITEMS} distinct items.`,
          );
        }
      }

      // priceAtAddition = latest observed authoritative list price (see
      // docs/cart-lifecycle.md "Price snapshot semantics"). Checkout always
      // prices from live catalog data, never from this snapshot.
      if (existing) {
        const [updated] = await tx
          .update(cartItems)
          .set({
            quantity: resultingQuantity,
            priceAtAddition: entry.listPrice,
            updatedAt: new Date(),
          })
          .where(eq(cartItems.id, existing.id))
          .returning();
        if (!updated) throw new Error("Failed to update cart item");
        await touchCart(tx, activeCart.id);
        return { item: updated, cartId: activeCart.id, wasExisting: true };
      }

      const [inserted] = await tx
        .insert(cartItems)
        .values({
          cartId: activeCart.id,
          variantId,
          quantity,
          priceAtAddition: entry.listPrice,
        })
        .returning();
      if (!inserted) throw new Error("Failed to add cart item");
      await touchCart(tx, activeCart.id);
      return { item: inserted, cartId: activeCart.id, wasExisting: false };
    }),
  );
}

async function createCartInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  owner: CartOwner,
) {
  try {
    const [created] = await tx
      .insert(carts)
      .values(
        owner.kind === "user"
          ? { userId: owner.userId, guestId: null, status: "ACTIVE" }
          : { userId: null, guestId: owner.guestId, status: "ACTIVE" },
      )
      .returning();
    if (!created) throw new Error("Failed to create cart");
    return created;
  } catch (error) {
    // Lost the creation race inside the transaction: fall back to the
    // winner created by the concurrent transaction.
    if (!isUniqueViolation(error)) throw error;
    const winner =
      owner.kind === "user"
        ? await findOrCreateUserCart(owner.userId)
        : await findOrCreateGuestCart(owner.guestId);
    return winner;
  }
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

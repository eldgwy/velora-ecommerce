import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { carts } from "@/infrastructure/database/schema/cart";
import { newGuestId } from "@/modules/cart/domain/guest-cookie";
import {
  findActiveCartId,
  isUniqueViolation,
  type CartOwner,
  type CartRow,
} from "@/modules/cart/application/cart-context";

/**
 * Cart initialization (FR-06.01).
 *
 * - Authenticated owner: find the ACTIVE cart, else insert one. Concurrent
 *   initializations race on the insert; the partial unique index
 *   `cart_user_active_unique` arbitrates and the loser re-reads the winner
 *   instead of failing — the single-active-cart invariant holds at the DB.
 * - Guest owner: same protocol against `cart_guest_active_unique`.
 */

/** Resolve the ACTIVE cart for a user, creating it when absent. */
export async function findOrCreateUserCart(userId: string): Promise<CartRow> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await findActiveCartId({ kind: "user", userId });
    if (existing) {
      const row = await getCartById(existing);
      if (row) return row;
    }
    try {
      const [created] = await db
        .insert(carts)
        .values({ userId, guestId: null, status: "ACTIVE" })
        .returning();
      if (created) return created;
    } catch (error) {
      // Lost the insert race: another request created the cart first.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  const winner = await findActiveCartId({ kind: "user", userId });
  if (!winner) throw new Error("Failed to initialize user cart");
  const row = await getCartById(winner);
  if (!row) throw new Error("Failed to initialize user cart");
  return row;
}

/** Resolve the ACTIVE cart for a guest token, creating it when absent. */
export async function findOrCreateGuestCart(guestId: string): Promise<CartRow> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await findActiveCartId({ kind: "guest", guestId });
    if (existing) {
      const row = await getCartById(existing);
      if (row) return row;
    }
    try {
      const [created] = await db
        .insert(carts)
        .values({ userId: null, guestId, status: "ACTIVE" })
        .returning();
      if (created) return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  const winner = await findActiveCartId({ kind: "guest", guestId });
  if (!winner) throw new Error("Failed to initialize guest cart");
  const row = await getCartById(winner);
  if (!row) throw new Error("Failed to initialize guest cart");
  return row;
}

/**
 * Resolve the caller's cart, creating it when needed. When an authenticated
 * user still carries a verified guest token, the guest cart is merged first
 * (opportunistic merge — login itself is client-side via Better Auth, so
 * there is no server login hook; every authenticated resolution converges
 * guest state into the user cart). Returns the merge outcome for surfacing.
 */
export async function resolveOwnerCart(owner: CartOwner): Promise<CartRow> {
  if (owner.kind === "user") {
    return findOrCreateUserCart(owner.userId);
  }
  return findOrCreateGuestCart(owner.guestId);
}

/** Allocate a fresh guest token for a first-time guest. */
export function allocateGuestToken(): string {
  return newGuestId();
}

async function getCartById(id: string): Promise<CartRow | null> {
  const [row] = await db.select().from(carts).where(eq(carts.id, id));
  return row ?? null;
}

/** Load a cart row only when it belongs to the owner (ownership check). */
export async function getOwnedCart(
  owner: CartOwner,
  cartId: string,
): Promise<CartRow | null> {
  const [row] = await db.select().from(carts).where(eq(carts.id, cartId));
  if (!row || row.status !== "ACTIVE") return null;
  if (owner.kind === "user") {
    return row.userId === owner.userId ? row : null;
  }
  return row.userId === null && row.guestId === owner.guestId ? row : null;
}

/** True when the row is an ACTIVE guest cart for exactly this token. */
export async function getOwnedGuestCart(
  guestId: string,
): Promise<CartRow | null> {
  const [row] = await db
    .select()
    .from(carts)
    .where(
      and(
        eq(carts.guestId, guestId),
        isNull(carts.userId),
        eq(carts.status, "ACTIVE"),
      ),
    );
  return row ?? null;
}

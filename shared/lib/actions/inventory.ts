"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import {
  adjustStock,
  adjustReservation,
  setStock,
  InvalidQuantityError,
  InsufficientStockError,
  InventoryNotFoundError,
  VariantNotFoundError,
  type InventoryMovementType,
  type PersistedInventory,
} from "@/services/inventory.service";
import { invalidateVariantCache } from "@/shared/lib/cache/tags";

const movementTypeSchema = z.enum([
  "RESTOCK",
  "RELEASE",
  "RESERVATION",
  "DAMAGE",
  "ADJUSTMENT",
  "RETURN",
  "SALE",
]) satisfies z.ZodType<InventoryMovementType>;

const numberFiniteInt = z.coerce.number().finite().int();

const adjustStockSchema = z.object({
  kind: z.literal("stock"),
  variantId: z.string().uuid("Invalid variant ID."),
  delta: numberFiniteInt,
  type: movementTypeSchema,
  reason: z.string().optional(),
  notes: z.string().optional(),
});

const setStockSchema = z.object({
  kind: z.literal("set"),
  variantId: z.string().uuid("Invalid variant ID."),
  quantity: numberFiniteInt.min(0, "Quantity must be non-negative."),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

const reservationSchema = z.object({
  kind: z.literal("reservation"),
  variantId: z.string().uuid("Invalid variant ID."),
  delta: numberFiniteInt,
  type: z.enum(["RESERVATION", "RELEASE"]) satisfies z.ZodType<InventoryMovementType>,
  reason: z.string().optional(),
  notes: z.string().optional(),
});

const adjustInventorySchema = z.discriminatedUnion("kind", [
  adjustStockSchema,
  setStockSchema,
  reservationSchema,
]);

export async function adjustInventory(
  input: unknown,
): Promise<{ ok: true; inventory: PersistedInventory } | { ok: false; error: string }> {
  const session = await requireAdmin();

  const parsed = adjustInventorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const actorId = session.user.id;

  try {
    const result =
      data.kind === "set"
        ? await setStock(
            data.variantId,
            data.quantity,
            { reason: data.reason, notes: data.notes },
            actorId,
          )
        : data.kind === "stock"
          ? await adjustStock(
              data.variantId,
              data.delta,
              data.type,
              { reason: data.reason, notes: data.notes },
              actorId,
            )
          : await adjustReservation(
              data.variantId,
              data.delta,
              data.type,
              { reason: data.reason, notes: data.notes },
              actorId,
            );

    // Invalidate variant + product detail, listing, and search caches that
    // expose stock / in-stock filtering.
    await invalidateVariantCache(data.variantId, result.productId);

    return { ok: true, inventory: result };
  } catch (err) {
    console.error("[inventory] adjustInventory failed:", err);
    if (err instanceof InvalidQuantityError) {
      return { ok: false, error: "Invalid quantity." };
    }
    if (err instanceof InsufficientStockError) {
      return { ok: false, error: "This change would violate stock availability rules." };
    }
    if (err instanceof InventoryNotFoundError || err instanceof VariantNotFoundError) {
      return { ok: false, error: "Variant or inventory not found." };
    }
    return { ok: false, error: "We couldn't update inventory. Please try again." };
  }
}

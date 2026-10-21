import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import {
  carts,
  cartItems,
} from "@/infrastructure/database/schema/cart";
import {
  products,
  productImages,
  productVariants,
} from "@/infrastructure/database/schema/catalog";
import {
  inventory,
} from "@/infrastructure/database/schema/inventory";
import {
  promotions,
  promotionProducts,
} from "@/infrastructure/database/schema/discounts";
import { getInventoryByVariant } from "@/services/inventory.service";
import { resolveVariantPrice } from "@/services/product-variant.service";
import {
  applyPromotionToUnitPrice,
  toCents,
} from "@/modules/cart/domain/rules/cart-rules";
import { selectBestPromotion } from "@/modules/promotions/domain/promotion-rules";

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

/**
 * A cart is owned either by an authenticated user or by an opaque guest
 * token. Callers must build this from the verified Better Auth session or
 * the verified guest cookie — never from client-supplied ownership fields.
 */
export type CartOwner =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestId: string };

export type CartRow = typeof carts.$inferSelect;
export type CartItemRow = typeof cartItems.$inferSelect;

/** Transaction client handed to `db.transaction` callbacks. */
export type CartTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

/**
 * Postgres unique-violation code (partial unique index backstop). Drizzle
 * wraps driver errors (DrizzleQueryError with the Postgres error as `cause`),
 * so the code is resolved through the cause chain; the message match is a
 * final fallback for drivers that do not surface `.code`.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.code === "23505") return true;
      if (typeof record.message === "string" && record.message.includes("duplicate key value")) {
        return true;
      }
      current = "cause" in record ? record.cause : null;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Run `fn` (a cart transaction body) retrying once when a concurrent writer
 * wins a uniqueness race. The database constraint is the arbiter; the retry
 * re-reads fresh state instead of failing the user request.
 */
export async function runWithUniqueRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error) || attempt === attempts - 1) throw error;
    }
  }
  throw lastError;
}

/**
 * Serialize writers of a single cart: lock its item rows for the duration of
 * the transaction so concurrent add/update/merge requests read-modify-write
 * in sequence instead of racing. The (cartId, variantId) unique index remains
 * the final backstop for inserts.
 */
export async function lockCartItems(
  tx: CartTx,
  cartId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT id FROM cart_items WHERE cart_id = ${cartId} FOR UPDATE
  `);
}

// ---------------------------------------------------------------------------
// Authoritative catalog resolution (server-side, never client-supplied)
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  variantId: string;
  variantStatus: string;
  sku: string | null;
  productId: string;
  productName: string;
  productStatus: string;
  imageUrl: string | null;
  /** Authoritative list price: variant override, else product base price. */
  listPrice: string;
  availableStock: number;
  promotion: {
    id: string;
    name: string;
    type: "PERCENTAGE" | "FIXED";
    value: string;
  } | null;
  /** Unit price after the best active promotion (BR-009 precedence). */
  effectivePrice: string;
  /** Total promotion saving per unit, in cents. */
  discountPerUnitCents: number;
  /** Authoritative per-unit weight in grams, or null when unknown. */
  weightGrams: number | null;
}

/**
 * Load the authoritative state for one variant: existence, ACTIVE status of
 * variant + product, live inventory availability, current catalog price, and
 * the best currently-active promotion. Returns null when the variant row is
 * gone (deleted). Everything else is reported with explicit status flags so
 * callers can build structured conflicts instead of throwing.
 */
export async function resolveCatalogEntry(
  variantId: string,
): Promise<CatalogEntry | null> {
  const [variant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  if (!variant) return null;

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, variant.productId));
  if (!product) return null;

  const [primaryImage] = await db
    .select({ url: productImages.url })
    .from(productImages)
    .where(
      and(eq(productImages.productId, product.id), eq(productImages.isPrimary, true)),
    );

  const inv = await getInventoryByVariant(variantId);
  const availableStock = inv ? inv.available : 0;

  const listPrice = resolveVariantPrice(
    { priceOverride: variant.priceOverride },
    product.basePrice,
  );
  const listCents = toCents(listPrice);

  const promotion = await getBestActivePromotion(product.id, listCents);
  const effectiveCents = promotion
    ? applyPromotionToUnitPrice(listCents, {
        type: promotion.type,
        value: promotion.value,
      })
    : listCents;

  return {
    variantId,
    variantStatus: variant.status,
    sku: variant.sku,
    productId: product.id,
    productName: product.name,
    productStatus: product.status,
    imageUrl: primaryImage?.url ?? null,
    listPrice,
    availableStock,
    promotion,
    effectivePrice: (effectiveCents / 100).toFixed(2),
    discountPerUnitCents: listCents - effectiveCents,
    weightGrams: variant.weightGrams ?? null,
  };
}

/**
 * Batched twin of `resolveCatalogEntry` (T-4.1/GP-10): resolves a set of
 * variants in a FIXED number of queries (variants, products, primary images,
 * inventory, promotion candidates) regardless of N, instead of the per-item
 * ~5-query loop the single resolver costs. Semantics mirror it exactly:
 * - absent variant OR absent product row → the variant id is missing from
 *   the map (callers branch on `undefined` exactly as they branched on
 *   `null` before);
 * - inventory availability = quantity - reserved_quantity; a missing
 *   inventory row reports 0;
 * - promotion candidates are windowed against ONE `now` sample for the
 *   whole set and ordered by promotion id into the deterministic
 *   `selectBestPromotion` (lowest effective price, id tie-break).
 */
export async function resolveCatalogEntries(
  variantIds: string[],
): Promise<Map<string, CatalogEntry>> {
  const resolved = new Map<string, CatalogEntry>();
  const uniqueIds = Array.from(new Set(variantIds));
  if (uniqueIds.length === 0) return resolved;

  const now = new Date();
  const nowMs = now.getTime();

  const [variantRows, inventoryRows] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.id, uniqueIds)),
    db
      .select({
        variantId: inventory.variantId,
        quantity: inventory.quantity,
        reservedQuantity: inventory.reservedQuantity,
      })
      .from(inventory)
      .where(inArray(inventory.variantId, uniqueIds)),
  ]);

  const productIds = Array.from(new Set(variantRows.map((v) => v.productId)));

  const [productRows, imageRows, candidateGroups] = await Promise.all([
    productIds.length > 0
      ? db.select().from(products).where(inArray(products.id, productIds))
      : Promise.resolve<(typeof products.$inferSelect)[]>([]),
    productIds.length > 0
      ? db
          .select({ productId: productImages.productId, url: productImages.url })
          .from(productImages)
          .where(
            and(
              inArray(productImages.productId, productIds),
              eq(productImages.isPrimary, true),
            ),
          )
      : Promise.resolve<{ productId: string; url: string }[]>([]),
    fetchCartPromotionCandidates(productIds, now),
  ]);

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const imageByProductId = new Map(imageRows.map((i) => [i.productId, i.url]));
  const availabilityByVariantId = new Map(
    inventoryRows.map((i) => [i.variantId, i.quantity - i.reservedQuantity]),
  );

  for (const variant of variantRows) {
    const product = productById.get(variant.productId);
    if (!product) continue; // product vanished → same null contract as the single resolver

    const listPrice = resolveVariantPrice(
      { priceOverride: variant.priceOverride },
      product.basePrice,
    );
    const listCents = toCents(listPrice);

    const candidates = (candidateGroups.get(variant.productId) ?? []).filter(
      (c) => c.endsAt === null || c.endsAt.getTime() >= nowMs,
    );
    const winner = selectBestPromotion(listCents, candidates);
    const promotion = winner
      ? { id: winner.id, name: winner.name, type: winner.type, value: winner.value }
      : null;
    const effectiveCents = promotion
      ? applyPromotionToUnitPrice(listCents, {
          type: promotion.type,
          value: promotion.value,
        })
      : listCents;

    resolved.set(variant.id, {
      variantId: variant.id,
      variantStatus: variant.status,
      sku: variant.sku,
      productId: product.id,
      productName: product.name,
      productStatus: product.status,
      imageUrl: imageByProductId.get(variant.productId) ?? null,
      listPrice,
      availableStock: availabilityByVariantId.get(variant.id) ?? 0,
      promotion,
      effectivePrice: (effectiveCents / 100).toFixed(2),
      discountPerUnitCents: listCents - effectiveCents,
      weightGrams: variant.weightGrams ?? null,
    });
  }

  return resolved;
}

/**
 * One batched promotion-candidates query for many products — same window
 * (`isActive`, started, ordered by promotion id; `endsAt` filtering stays
 * caller-side exactly like `getBestActivePromotion`/fetchCandidates).
 */
async function fetchCartPromotionCandidates(
  productIds: string[],
  now: Date,
): Promise<Map<string, Array<{ id: string; name: string; type: "PERCENTAGE" | "FIXED"; value: string; endsAt: Date | null }>>> {
  const groups = new Map<
    string,
    Array<{ id: string; name: string; type: "PERCENTAGE" | "FIXED"; value: string; endsAt: Date | null }>
  >();
  if (productIds.length === 0) return groups;
  const rows = await db
    .select({
      productId: promotionProducts.productId,
      id: promotions.id,
      name: promotions.name,
      type: promotions.type,
      value: promotions.value,
      endsAt: promotions.endsAt,
    })
    .from(promotionProducts)
    .innerJoin(promotions, eq(promotionProducts.promotionId, promotions.id))
    .where(
      and(
        inArray(promotionProducts.productId, productIds),
        eq(promotions.isActive, true),
        lte(promotions.startsAt, now),
      ),
    )
    .orderBy(promotions.id);
  for (const row of rows) {
    const list = groups.get(row.productId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      type: row.type,
      value: row.value,
      endsAt: row.endsAt,
    });
    groups.set(row.productId, list);
  }
  return groups;
}

/**
 * Best currently-active promotion mapped to the product, via the centralized
 * deterministic selection (lowest effective price, id tie-break). Returns
 * null when none applies (inactive, not started, or ended) or when no
 * candidate yields a positive saving. `endsAt = NULL` is open-ended.
 * Rows arrive ordered by id so every caller sees the same candidate order.
 */
async function getBestActivePromotion(
  productId: string,
  listPriceCents: number,
): Promise<CatalogEntry["promotion"]> {
  const now = new Date();
  const rows = await db
    .select({
      id: promotions.id,
      name: promotions.name,
      type: promotions.type,
      value: promotions.value,
      endsAt: promotions.endsAt,
    })
    .from(promotionProducts)
    .innerJoin(
      promotions,
      eq(promotionProducts.promotionId, promotions.id),
    )
    .where(
      and(
        eq(promotionProducts.productId, productId),
        eq(promotions.isActive, true),
        lte(promotions.startsAt, now),
      ),
    )
    .orderBy(promotions.id);

  const nowMs = now.getTime();
  const eligible = rows.filter(
    (row) => row.endsAt === null || row.endsAt.getTime() >= nowMs,
  );
  const winner = selectBestPromotion(listPriceCents, eligible);
  if (!winner) return null;
  return { id: winner.id, name: winner.name, type: winner.type, value: winner.value };
}

/** Find an ACTIVE cart id for the owner, or null. */
export async function findActiveCartId(
  owner: CartOwner,
  tx: CartTx | typeof db = db,
): Promise<string | null> {
  const [row] =
    owner.kind === "user"
      ? await tx
          .select({ id: carts.id })
          .from(carts)
          .where(
            and(eq(carts.userId, owner.userId), eq(carts.status, "ACTIVE")),
          )
      : await tx
          .select({ id: carts.id })
          .from(carts)
          .where(
            and(
              eq(carts.guestId, owner.guestId),
              isNull(carts.userId),
              eq(carts.status, "ACTIVE"),
            ),
          );
  return row?.id ?? null;
}

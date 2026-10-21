import { eq, inArray } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { cartItems } from "@/infrastructure/database/schema/cart";
import {
  promotions,
  promotionProducts,
} from "@/infrastructure/database/schema/discounts";
import type {
  CartError,
  CartItemWarning,
  CartValidationResult,
  CartWarning,
  ValidatedCartItem,
} from "@/modules/cart/domain/types";
import {
  fromCents,
  subtotalCents,
  toCents,
} from "@/modules/cart/domain/rules/cart-rules";
import {
  findActiveCartId,
  resolveCatalogEntries,
  type CartOwner,
} from "@/modules/cart/application/cart-context";

/**
 * Pre-checkout cart validation (FR-06.04). Strictly validation-only:
 * - Reads authoritative server-side state (variant/product status, live
 *   catalog price, live availability, active promotions).
 * - Recomputes subtotal / discounts / payable total from trusted data.
 *   There is no totals parameter — client-supplied totals cannot enter.
 * - Creates no order, initiates no payment, reserves no stock. Prices,
 *   promotions, and stock may change after validation; final order creation
 *   must revalidate and reserve through the atomic reservation lifecycle.
 */
export async function validateCartForCheckout(
  owner: CartOwner,
): Promise<CartValidationResult> {
  const items: ValidatedCartItem[] = [];
  const warnings: CartWarning[] = [];
  const errors: CartError[] = [];

  const cartId = await findActiveCartId(owner);
  if (!cartId) {
    return {
      valid: false,
      items,
      subtotal: "0.00",
      discountTotal: "0.00",
      payableTotal: "0.00",
      warnings,
      errors: [{ type: "empty_cart", message: "Your cart is empty." }],
    };
  }

  const rows = await db
    .select()
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));

  if (rows.length === 0) {
    return {
      valid: false,
      items,
      subtotal: "0.00",
      discountTotal: "0.00",
      payableTotal: "0.00",
      warnings,
      errors: [{ type: "empty_cart", message: "Your cart is empty." }],
    };
  }

  // T-4.1/GP-10: one batched catalog resolution for the whole cart (was
  // ~5 queries per item), one sample of `now` for all promotion windows.
  const entries = await resolveCatalogEntries(rows.map((row) => row.variantId));
  const nowMs = new Date().getTime();
  const expiredPromotionIds = await findExpiredPromotionProductIds(
    Array.from(
      new Set(
        rows
          .map((row) => entries.get(row.variantId)?.productId)
          .filter((id) => id !== undefined),
      ),
    ),
    nowMs,
  );

  for (const row of rows) {
    const entry = entries.get(row.variantId);
    const itemWarnings: CartItemWarning[] = [];

    if (!entry) {
      errors.push({
        type: "variant_unavailable",
        message: "An item in your cart is no longer available.",
        itemId: row.id,
      });
      items.push(missingItem(row.id, row.variantId, row.quantity, row.priceAtAddition));
      continue;
    }

    if (entry.variantStatus !== "ACTIVE") {
      itemWarnings.push({
        type: "variant_inactive",
        message: `${entry.productName} is no longer available for purchase.`,
        severity: "error",
      });
      errors.push({
        type: "variant_inactive",
        message: `${entry.productName} is no longer available.`,
        itemId: row.id,
      });
    }
    if (entry.productStatus !== "ACTIVE") {
      itemWarnings.push({
        type: "product_inactive",
        message: `${entry.productName} is no longer available for purchase.`,
        severity: "error",
      });
      errors.push({
        type: "product_inactive",
        message: `${entry.productName} is no longer available.`,
        itemId: row.id,
      });
    }

    const priceChanged =
      row.priceAtAddition !== null &&
      toCents(row.priceAtAddition) !== toCents(entry.listPrice);
    if (priceChanged) {
      itemWarnings.push({
        type: "price_changed",
        message: `The price of ${entry.productName} changed since you added it.`,
        severity: "info",
        originalValue: row.priceAtAddition ?? undefined,
        newValue: entry.listPrice,
      });
    }

    if (row.quantity > entry.availableStock) {
      itemWarnings.push({
        type: "out_of_stock",
        message:
          entry.availableStock <= 0
            ? `${entry.productName} is out of stock.`
            : `Only ${entry.availableStock} unit(s) of ${entry.productName} are available.`,
        severity: "error",
        originalValue: row.quantity,
        newValue: entry.availableStock,
      });
      errors.push({
        type: "insufficient_stock",
        message:
          entry.availableStock <= 0
            ? `${entry.productName} is out of stock.`
            : `Only ${entry.availableStock} unit(s) of ${entry.productName} are available.`,
        itemId: row.id,
      });
    } else if (entry.promotion === null && expiredPromotionIds.has(entry.productId)) {
      // A promotion mapping exists for this product but none is currently
      // active: surface the expired promotion instead of silently dropping
      // the discount from the totals.
      itemWarnings.push({
        type: "promotion_expired",
        message: `A promotion for ${entry.productName} is no longer active.`,
        severity: "info",
      });
    }

    const purchasable =
      entry.variantStatus === "ACTIVE" && entry.productStatus === "ACTIVE";
    items.push({
      id: row.id,
      variantId: row.variantId,
      quantity: row.quantity,
      priceAtAddition: row.priceAtAddition,
      currentPrice: entry.listPrice,
      priceChanged,
      availableStock: entry.availableStock,
      inStock: purchasable && row.quantity <= entry.availableStock,
      maxAvailable: entry.availableStock,
      productName: entry.productName,
      variantName: entry.sku,
      sku: entry.sku ?? "",
      warnings: itemWarnings,
    });
  }

  // Totals from trusted server-side data only. Payable here is pre-shipping /
  // pre-tax (BR-002 shipping + tax are computed by checkout, not the cart).
  const billable = items.filter((item) => item.inStock);
  const subtotal = fromCents(
    subtotalCents(
      billable.map((item) => ({ unitPrice: item.currentPrice, quantity: item.quantity })),
    ),
  );
  let discountCents = 0;
  for (const item of billable) {
    const entry = entries.get(item.variantId);
    if (entry) discountCents += entry.discountPerUnitCents * item.quantity;
  }
  const discountTotal = fromCents(discountCents);
  const payableTotal = fromCents(toCents(subtotal) - discountCents);

  if (errors.length > 0) {
    warnings.push({
      type: "cart_action_required",
      message: "Some items in your cart need attention before checkout.",
      severity: "error",
    });
  }

  return {
    valid: errors.length === 0,
    items,
    subtotal,
    discountTotal,
    payableTotal,
    warnings,
    errors,
  };
}

function missingItem(
  id: string,
  variantId: string,
  quantity: number,
  priceAtAddition: string | null,
): ValidatedCartItem {
  return {
    id,
    variantId,
    quantity,
    priceAtAddition,
    currentPrice: "0.00",
    priceChanged: false,
    availableStock: 0,
    inStock: false,
    maxAvailable: 0,
    productName: "Unavailable item",
    variantName: null,
    sku: "",
    warnings: [
      {
        type: "variant_inactive",
        message: "This item is no longer available.",
        severity: "error",
      },
    ],
  };
}

/**
 * Products among the given ones that have promotion mappings while none of
 * them is currently live — batched twin of the old per-product
 * `hasExpiredPromotion` (which fired up to 1 + N-mapping queries per item).
 * Live rule preserved: isActive && started && not ended; open-ended
 * (NULL endsAt) stays live. A mapping whose promotion row is missing cannot
 * be live (the old loop skipped such rows), so a product whose only mapping
 * is broken counts as expired.
 */
async function findExpiredPromotionProductIds(
  productIds: string[],
  nowMs: number,
): Promise<Set<string>> {
  const expired = new Set<string>();
  if (productIds.length === 0) return expired;
  const mappingRows = await db
    .select({
      productId: promotionProducts.productId,
      isActive: promotions.isActive,
      startsAt: promotions.startsAt,
      endsAt: promotions.endsAt,
    })
    .from(promotionProducts)
    .leftJoin(promotions, eq(promotionProducts.promotionId, promotions.id))
    .where(inArray(promotionProducts.productId, productIds));

  const mapped = new Set<string>();
  const anyLive = new Set<string>();
  for (const row of mappingRows) {
    mapped.add(row.productId);
    const isLive =
      row.isActive === true &&
      row.startsAt !== null &&
      row.startsAt.getTime() <= nowMs &&
      (row.endsAt === null || row.endsAt.getTime() >= nowMs);
    if (isLive) anyLive.add(row.productId);
  }
  for (const productId of mapped) {
    if (!anyLive.has(productId)) expired.add(productId);
  }
  return expired;
}

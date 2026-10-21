import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { cartItems } from "@/infrastructure/database/schema/cart";
import { fromCents, subtotalCents } from "@/modules/cart/domain/rules/cart-rules";
import {
  findActiveCartId,
  resolveCatalogEntries,
  type CartOwner,
} from "@/modules/cart/application/cart-context";

export interface CartDetailItem {
  id: string;
  variantId: string;
  quantity: number;
  priceAtAddition: string | null;
  productName: string;
  sku: string | null;
  imageUrl: string | null;
  /** Live authoritative list price (never the snapshot). */
  currentPrice: string;
  /** Unit price after the best active promotion. */
  effectivePrice: string;
  lineTotal: string;
  availableStock: number;
  purchasable: boolean;
  promotion: {
    id: string;
    name: string;
    type: "PERCENTAGE" | "FIXED";
    value: string;
  } | null;
}

export interface CartDetail {
  cartId: string | null;
  items: CartDetailItem[];
  /** Sum of effectivePrice * quantity, server-calculated. */
  subtotal: string;
  /** Total promotion savings included in the subtotal. */
  discountTotal: string;
  itemCount: number;
}

/**
 * Read-only cart detail for the UI. Never creates a cart (window-shoppers
 * get an empty detail, not a database row). Prices shown are live catalog
 * prices; the snapshot is exposed only for change detection.
 */
export async function getCartDetail(owner: CartOwner): Promise<CartDetail> {
  const cartId = await findActiveCartId(owner);
  if (!cartId) {
    return { cartId: null, items: [], subtotal: "0.00", discountTotal: "0.00", itemCount: 0 };
  }

  const rows = await db
    .select()
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));

  // T-4.1/GP-10: resolve the whole cart in one fixed batch instead of one
  // ~5-query resolution per item.
  const entries = await resolveCatalogEntries(rows.map((row) => row.variantId));

  const items: CartDetailItem[] = [];
  for (const row of rows) {
    const entry = entries.get(row.variantId);
    if (!entry) continue; // variant deleted mid-read; validation surfaces it
    const purchasable =
      entry.variantStatus === "ACTIVE" && entry.productStatus === "ACTIVE";
    items.push({
      id: row.id,
      variantId: row.variantId,
      quantity: row.quantity,
      priceAtAddition: row.priceAtAddition,
      productName: entry.productName,
      sku: entry.sku,
      imageUrl: entry.imageUrl,
      currentPrice: entry.listPrice,
      effectivePrice: entry.effectivePrice,
      lineTotal: fromCents(
        subtotalCents([{ unitPrice: entry.effectivePrice, quantity: row.quantity }]),
      ),
      availableStock: entry.availableStock,
      purchasable,
      promotion: entry.promotion,
    });
  }

  const subtotal = fromCents(
    subtotalCents(
      items.map((item) => ({ unitPrice: item.effectivePrice, quantity: item.quantity })),
    ),
  );
  const listSubtotal = fromCents(
    subtotalCents(
      items.map((item) => ({ unitPrice: item.currentPrice, quantity: item.quantity })),
    ),
  );
  const discountTotal = (Number(listSubtotal) - Number(subtotal)).toFixed(2);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return { cartId, items, subtotal, discountTotal, itemCount };
}

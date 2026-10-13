import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import { addresses } from "@/infrastructure/database/schema/customers";
import {
  findActiveCartId,
  resolveCatalogEntry,
} from "@/modules/cart/application/cart-context";
import { ensureCustomerProfile } from "@/services/customer.service";
import {
  calculateCheckoutTotals,
  type TotalsBreakdown,
} from "@/modules/checkout/domain/calculation";
import { CHECKOUT_CURRENCY } from "@/modules/checkout/domain/pricing";
import { toMinorUnits } from "@/modules/checkout/domain/money";
import {
  calculateShipmentWeightGrams,
  quoteShipping,
} from "@/modules/checkout/domain/shipping";
import { resolveTaxRule } from "@/modules/checkout/domain/tax";
import { validateCouponForCheckout } from "@/modules/checkout/application/coupon";
import type {
  CheckoutInput,
  CheckoutUser,
} from "@/modules/checkout/application/commands/create-order";
import {
  AddressOwnershipError,
  CartConflictError,
  CartConsumedError,
  EmptyCartError,
} from "@/modules/checkout/domain/errors";

export interface CheckoutPreview extends TotalsBreakdown {
  /** True when every cart line is purchasable right now. */
  cartValid: boolean;
  /** Human-readable blockers (same content as pre-checkout validation). */
  blockers: Array<{ variantId: string; reason: string }>;
  couponCode: string | null;
  couponValid: boolean;
  couponMessage: string | null;
  taxConfigured: boolean;
  weightKnown: boolean;
}

/**
 * Server-authoritative financial preview (FR-08.01 step 7). Recalculates the
 * full breakdown from live catalog, promotion, coupon, shipping, and tax
 * data — the same code path as order placement minus persistence.
 *
 * Side-effect free: no order, no payment, no reservation, and coupon usage
 * is validated but never consumed. The UI shows this breakdown on the
 * review step and echoes `totalCents` back as `expectedTotalCents`; any
 * drift at placement aborts with `TotalChangedError` for explicit
 * reconfirmation instead of silently charging a new amount.
 */
export async function previewCheckout(
  user: CheckoutUser,
  input: CheckoutInput,
): Promise<CheckoutPreview> {
  const profile = await ensureCustomerProfile({ id: user.id, name: user.name });

  const cartId = await findActiveCartId({ kind: "user", userId: user.id });
  if (!cartId) throw new CartConsumedError();

  const [cart] = await db
    .select({ id: carts.id, status: carts.status })
    .from(carts)
    .where(and(eq(carts.id, cartId), eq(carts.status, "ACTIVE")));
  if (!cart) throw new CartConsumedError();
  const rows = await db
    .select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  if (rows.length === 0) throw new EmptyCartError();

  const blockers: CheckoutPreview["blockers"] = [];
  const lines: Array<{
    variantId: string;
    quantity: number;
    unitPriceCents: number;
    discountPerUnitCents: number;
    promotionId: string | null;
    weightGrams: number | null;
  }> = [];

  for (const row of rows) {
    const entry = await resolveCatalogEntry(row.variantId);
    if (!entry) {
      blockers.push({ variantId: row.variantId, reason: "unavailable" });
      continue;
    }
    const purchasable =
      entry.variantStatus === "ACTIVE" && entry.productStatus === "ACTIVE";
    if (!purchasable) {
      blockers.push({ variantId: row.variantId, reason: "inactive" });
      continue;
    }
    if (row.quantity > entry.availableStock) {
      blockers.push({ variantId: row.variantId, reason: "insufficient_stock" });
      continue;
    }
    lines.push({
      variantId: row.variantId,
      quantity: row.quantity,
      unitPriceCents: toMinorUnits(entry.effectivePrice, CHECKOUT_CURRENCY),
      discountPerUnitCents: entry.discountPerUnitCents,
      promotionId: entry.promotion?.id ?? null,
      weightGrams: entry.weightGrams,
    });
  }

  if (blockers.length > 0) {
    throw new CartConflictError(
      "Your cart changed and needs attention before checkout.",
    );
  }

  // Destination drives tax + shipping. Saved ids are verified against the
  // profile (same ownership rule as placement); inline input arrives
  // Zod-validated from the presentation boundary.
  async function shippingCountry(
    selection: CheckoutInput["shippingAddress"],
  ): Promise<string> {
    if ("addressId" in selection) {
      const [found] = await db
        .select({ country: addresses.country, customerId: addresses.customerId })
        .from(addresses)
        .where(eq(addresses.id, selection.addressId));
      if (!found || found.customerId !== profile.id) {
        throw new AddressOwnershipError();
      }
      return found.country;
    }
    return selection.newAddress.country;
  }
  const country = await shippingCountry(input.shippingAddress);

  const subtotalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

  // Coupon validated (locked read inside a short tx), never consumed here.
  let couponDiscountCents = 0;
  let couponCode: string | null = null;
  let couponValid = true;
  let couponMessage: string | null = null;
  const rawCode = input.couponCode?.trim().toUpperCase() || null;
  if (rawCode) {
    couponCode = rawCode;
    try {
      const validated = await db.transaction((tx) =>
        validateCouponForCheckout(tx, rawCode, subtotalCents),
      );
      couponDiscountCents = validated.discountCents;
    } catch (error) {
      couponValid = false;
      couponMessage =
        error instanceof Error ? error.message : "That coupon does not apply.";
    }
  }

  const taxRule = resolveTaxRule(country);
  const weightGrams = calculateShipmentWeightGrams(
    lines.map((l) => ({ weightGrams: l.weightGrams, quantity: l.quantity })),
  );
  const quote = quoteShipping({
    method: input.shippingMethod,
    country,
    subtotalAfterDiscountsCents: subtotalCents - couponDiscountCents,
    weightGrams,
    taxesShipping: taxRule.taxesShipping,
  });

  const breakdown = calculateCheckoutTotals({
    currency: CHECKOUT_CURRENCY,
    lines,
    couponDiscountCents,
    shippingMethod: input.shippingMethod,
    shippingCents: quote.feeCents,
    taxableShippingCents: quote.taxableCents,
    taxJurisdiction: taxRule.jurisdiction,
    taxRateBps: taxRule.rateBps,
  });

  return {
    ...breakdown,
    cartValid: true,
    blockers: [],
    couponCode,
    couponValid,
    couponMessage,
    taxConfigured: taxRule.configured,
    weightKnown: weightGrams !== null,
  };
}

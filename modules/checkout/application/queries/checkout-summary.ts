import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { addresses } from "@/infrastructure/database/schema/customers";
import { getCartDetail, type CartDetail } from "@/modules/cart/application/queries/get-cart";
import { validateCartForCheckout } from "@/modules/cart/application/queries/validate-cart";
import type { CartValidationResult } from "@/modules/cart/domain/types";
import type { CartOwner } from "@/modules/cart/application/cart-context";
import { getCustomerProfile } from "@/services/customer.service";
import { SHIPPING_METHODS, type ShippingMethodId } from "@/modules/checkout/domain/shipping";

export interface CheckoutAddressOption {
  id: string;
  label: string;
  country: string;
  city: string;
  state: string;
  postalCode: string;
  addressLine1: string | null;
  addressLine2: string | null;
  isDefault: boolean;
}

export interface CheckoutSummary {
  detail: CartDetail;
  validation: CartValidationResult;
  addresses: CheckoutAddressOption[];
  contactPhone: string | null;
  customerName: string;
  shippingMethods: Array<{
    id: ShippingMethodId;
    label: string;
    etaDays: string;
  }>;
}

/**
 * Read-only checkout screen data: live cart detail, pre-checkout validation,
 * saved addresses (default first), and profile contact. No order, payment,
 * or reservation side effects.
 */
export async function getCheckoutSummary(
  userId: string,
  userName: string,
): Promise<CheckoutSummary> {
  const owner: CartOwner = { kind: "user", userId };
  const [detail, validation] = await Promise.all([
    getCartDetail(owner),
    validateCartForCheckout(owner),
  ]);

  const profile = await getCustomerProfile(userId);
  let saved: CheckoutAddressOption[] = [];
  if (profile) {
    const rows = await db
      .select()
      .from(addresses)
      .where(eq(addresses.customerId, profile.id));
    saved = rows
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      .map((a) => ({
        id: a.id,
        label: a.label,
        country: a.country,
        city: a.city,
        state: a.state,
        postalCode: a.postalCode,
        addressLine1: a.addressLine1,
        addressLine2: a.addressLine2,
        isDefault: a.isDefault,
      }));
  }

  return {
    detail,
    validation,
    addresses: saved,
    contactPhone: profile?.phone ?? null,
    customerName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : userName,
    shippingMethods: (Object.keys(SHIPPING_METHODS) as ShippingMethodId[]).map((id) => ({
      id,
      label: SHIPPING_METHODS[id].label,
      etaDays: SHIPPING_METHODS[id].etaDays,
    })),
  };
}

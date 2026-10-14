import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { carts, cartItems } from "@/infrastructure/database/schema/cart";
import {
  orderAddresses,
  orderItems,
  orders,
  orderStatusHistories,
  payments,
} from "@/infrastructure/database/schema/orders";
import { couponUsages } from "@/infrastructure/database/schema/discounts";
import { addresses, customerProfiles } from "@/infrastructure/database/schema/customers";
import {
  findActiveCartId,
  resolveCatalogEntry,
} from "@/modules/cart/application/cart-context";
import {
  MAX_QUANTITY_PER_ITEM,
  isPurchasable,
} from "@/modules/cart/domain/rules/cart-rules";
import { ensureCustomerProfile } from "@/services/customer.service";
import { reserveOrderInventory } from "@/modules/orders/application/commands/reserve-order-inventory";
import { cancelOrder } from "@/modules/orders/application/commands/order-lifecycle";
import {
  InsufficientStockForOrderError,
  OrderAlreadyReservedError,
} from "@/modules/orders/domain/errors/order-errors";
import {
  AddressOwnershipError,
  CartConflictError,
  CartConsumedError,
  EmptyCartError,
  IdempotencyConflictError,
  StockConflictError,
  TotalChangedError,
} from "@/modules/checkout/domain/errors";
import {
  CHECKOUT_CURRENCY,
  generateOrderNumber,
  hashCheckoutInput,
} from "@/modules/checkout/domain/pricing";
import {
  PRICING_POLICY_VERSION,
  calculateCheckoutTotals,
  type TotalsBreakdown,
} from "@/modules/checkout/domain/calculation";
import {
  fromMinorUnits,
  toMinorUnits,
} from "@/modules/checkout/domain/money";
import { resolveTaxRule } from "@/modules/checkout/domain/tax";
import {
  calculateShipmentWeightGrams,
  quoteShipping,
  type ShippingMethodId,
} from "@/modules/checkout/domain/shipping";
import {
  consumeCouponUsage,
  releaseCouponUsage,
  validateCouponForCheckout,
  type ValidatedCoupon,
} from "@/modules/checkout/application/coupon";
import {
  initializeOrderPayment,
  type PaymentInitResult,
} from "@/modules/checkout/application/payment-init";

// ---------------------------------------------------------------------------
// Input (validated by Zod at the presentation boundary; see
// modules/checkout/presentation/schemas/checkout.schema.ts)
// ---------------------------------------------------------------------------

export interface NewAddressInput {
  country: string;
  city: string;
  state: string;
  postalCode: string;
  addressLine1?: string | undefined;
  addressLine2?: string | undefined;
}

export type AddressSelection =
  | { addressId: string }
  | { newAddress: NewAddressInput };

export type BillingSelection =
  | { addressId: string }
  | { newAddress: NewAddressInput }
  | { sameAsShipping: true };

export interface CheckoutInput {
  shippingAddress: AddressSelection;
  billingAddress: BillingSelection;
  shippingMethod: ShippingMethodId;
  couponCode?: string | null;
  contactPhone?: string | null;
  paymentMethod: "card" | "cod";
  notes?: string | null;
}

export interface CheckoutUser {
  id: string;
  name: string;
  email: string;
}

export interface CheckoutLine {
  variantId: string;
  quantity: number;
  productName: string;
  sku: string;
  unitPrice: string;
  discountPerUnit: string;
  lineSubtotal: string;
  promotionId: string | null;
}

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  lines: CheckoutLine[];
  subtotal: string;
  promotionDiscount: string;
  couponDiscount: string;
  shipping: string;
  shippingMethod: ShippingMethodId;
  tax: string;
  taxJurisdiction: string;
  taxRateBps: number;
  taxableBase: string;
  total: string;
  currency: string;
  pricingPolicyVersion: string;
  payment: PaymentInitResult;
  reservationExpiresAt: string | null;
  /** True when this response replays an earlier identical attempt. */
  replayed: boolean;
}

interface AddressSnapshot {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string;
  city: string;
  state: string;
  postalCode: string;
  addressLine1: string | null;
  addressLine2: string | null;
}

function reservationTtlMinutes(): number {
  const raw = Number(process.env.RESERVATION_EXPIRY_MINUTES ?? 30);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

function isUniqueViolationDeep(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.code === "23505") return true;
      if (
        typeof record.message === "string" &&
        record.message.includes("duplicate key value")
      ) {
        return true;
      }
      current = "cause" in record ? record.cause : null;
      continue;
    }
    return false;
  }
  return false;
}

function violatedConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.constraint === "string") return record.constraint;
      const message = typeof record.message === "string" ? record.message : "";
      const match = message.match(/constraint "([^"]+)"/);
      if (match) return match[1];
      current = "cause" in record ? record.cause : null;
      continue;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Address resolution (ownership enforced)
// ---------------------------------------------------------------------------

async function resolveAddressSnapshot(
  profileId: string,
  firstName: string,
  lastName: string,
  fallbackPhone: string | null,
  selection: AddressSelection,
): Promise<AddressSnapshot> {
  if ("addressId" in selection) {
    const [row] = await db
      .select()
      .from(addresses)
      .where(eq(addresses.id, selection.addressId));
    if (!row || row.customerId !== profileId) {
      // Same response whether missing or foreign: no ownership oracle (BR-008).
      throw new AddressOwnershipError();
    }
    return {
      firstName,
      lastName,
      phone: fallbackPhone,
      country: row.country,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
    };
  }
  const a = selection.newAddress;
  return {
    firstName,
    lastName,
    phone: fallbackPhone,
    country: a.country,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    addressLine1: a.addressLine1 ?? null,
    addressLine2: a.addressLine2 ?? null,
  };
}

// ---------------------------------------------------------------------------
// Canonical input (idempotency binding)
// ---------------------------------------------------------------------------

interface CanonicalCheckout {
  items: Array<{ variantId: string; quantity: number }>;
  shippingAddress: AddressSnapshot;
  billingAddress: AddressSnapshot;
  shippingMethod: ShippingMethodId;
  couponCode: string | null;
  contactPhone: string | null;
  paymentMethod: "card" | "cod";
  notes: string | null;
  /** Engine version that will price this intent; replays across an engine
   *  upgrade mismatch instead of returning foreign totals. */
  pricingPolicyVersion: string;
}

function canonicalize(
  items: Array<{ variantId: string; quantity: number }>,
  shipping: AddressSnapshot,
  billing: AddressSnapshot,
  input: CheckoutInput,
): CanonicalCheckout {
  return {
    items: [...items].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    shippingAddress: shipping,
    billingAddress: billing,
    shippingMethod: input.shippingMethod,
    couponCode: input.couponCode?.trim().toUpperCase() || null,
    contactPhone: input.contactPhone?.trim() || null,
    paymentMethod: input.paymentMethod,
    notes: input.notes?.trim() || null,
    pricingPolicyVersion: PRICING_POLICY_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Secure checkout: revalidate → create order → reserve → init payment.
 *
 * Transaction design (explicit, because `reserveOrderInventory` owns its own
 * transaction and cannot nest):
 * - Tx1 creates the order graph (order, items PENDING, addresses, history,
 *   PENDING payment, coupon usage) and CONVERTs the cart. Inside Tx1 the cart
 *   is re-read and compared to the just-validated snapshot, closing the
 *   validation→creation gap for cart edits.
 * - `reserveOrderInventory(orderId)` runs in its own transaction (existing
 *   lifecycle, reused — never duplicated).
 * - On reservation failure, compensation reuses `cancelOrder` (releases,
 *   cancels, histories) plus a small tx that reactivates the cart and rolls
 *   back coupon usage. The customer keeps a usable cart and retries with a
 *   FRESH idempotency key; the failed order stays CANCELLED for audit.
 * - Payment initialization runs outside every inventory-locking transaction.
 */
export async function placeOrder(
  user: CheckoutUser,
  input: CheckoutInput,
  idempotencyKey: string,
  opts?: { expectedTotalCents?: number },
): Promise<CheckoutResult> {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(idempotencyKey)) {
    throw new IdempotencyConflictError();
  }

  const profile = await ensureCustomerProfile({ id: user.id, name: user.name });
  const [profileRow] = await db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, user.id));
  const firstName = profileRow?.firstName ?? user.name;
  const lastName = profileRow?.lastName ?? "";
  const phone = input.contactPhone?.trim() || profileRow?.phone || null;

  // 1. Idempotency replay: same key seen before?
  const prior = await findOrderByIdempotency(user.id, idempotencyKey);
  const cartId = await findActiveCartId({ kind: "user", userId: user.id });

  if (prior) {
    const canonical = await buildCanonical(
      profile.id, firstName, lastName, phone, input,
      cartId ? await readCartItems(cartId) : null,
      prior.orderId,
    );
    if (hashCheckoutInput(canonical) !== prior.checkoutHash) {
      throw new IdempotencyConflictError();
    }
    return replayResult(prior.orderId);
  }

  if (!cartId) throw new CartConsumedError();
  const cartLines = await readCartItems(cartId);
  if (cartLines.length === 0) throw new EmptyCartError();

  // 2. Final cart revalidation against authoritative data.
  const validation = await revalidateLines(cartLines);
  const blockers = validation.items.filter((i) => !i.inStock);
  if (blockers.length > 0 || !validation.valid) {
    throw new CartConflictError(
      "Your cart changed and needs attention before checkout.",
      validation,
    );
  }

  // 3. Addresses, totals inputs.
  const shipping = await resolveAddressSnapshot(
    profile.id, firstName, lastName, phone, input.shippingAddress,
  );
  const billing =
    "sameAsShipping" in input.billingAddress
      ? shipping
      : await resolveAddressSnapshot(
          profile.id, firstName, lastName, phone, input.billingAddress,
        );

  const canonical = canonicalize(
    cartLines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    shipping, billing, input,
  );
  const checkoutHash = hashCheckoutInput(canonical);

  // 4. Tx1: create the order graph + convert the cart.
  let created: Tx1Result;
  try {
    created = await createOrderTx(
      user, input, { cartId, lines: validation.billable, shipping, billing, phone, canonical, checkoutHash, idempotencyKey, expectedTotalCents: opts?.expectedTotalCents },
    );
  } catch (error) {
    if (error instanceof ReplaySignal) {
      return replayPriorOrder(user.id, error.orderId, input);
    }
    throw error;
  }

  // 5. Reserve (existing lifecycle, own transaction). Tolerate a concurrent
  // twin having reserved first (timeout-retry racing the original attempt).
  if (await needsReservation(created.orderId)) {
    try {
      await reserveOrderInventory(created.orderId, { actorId: user.id });
    } catch (error) {
      if (error instanceof OrderAlreadyReservedError) {
        // Reserved by the racing twin — proceed to payment init.
      } else {
        await compensateReservationFailure(
          created.orderId, created.cartId, created.couponId,
          "Reservation failed: insufficient stock",
        );
        if (error instanceof InsufficientStockForOrderError) {
          throw new StockConflictError(
            "Some items in your cart just sold out. Review your cart and try again with a new checkout.",
          );
        }
        throw error;
      }
    }
  }

  // 6. Payment initialization (outside inventory locks). The provider
  // amount is the persisted authoritative total, never a client figure.
  const payment = await initializeOrderPayment(
    user.id, created.orderId, input.paymentMethod, created.breakdown.totalCents, CHECKOUT_CURRENCY,
  );

  await invalidateCheckoutCaches(user.id, created.cartId, validation.billable);

  const b = created.breakdown;
  return {
    orderId: created.orderId,
    orderNumber: created.orderNumber,
    lines: created.lines,
    subtotal: fromMinorUnits(b.subtotalCents, CHECKOUT_CURRENCY),
    promotionDiscount: fromMinorUnits(b.promotionDiscountCents, CHECKOUT_CURRENCY),
    couponDiscount: fromMinorUnits(b.couponDiscountCents, CHECKOUT_CURRENCY),
    shipping: fromMinorUnits(b.shippingCents, CHECKOUT_CURRENCY),
    shippingMethod: b.shippingMethod,
    tax: fromMinorUnits(b.taxCents, CHECKOUT_CURRENCY),
    taxJurisdiction: b.taxJurisdiction,
    taxRateBps: b.taxRateBps,
    taxableBase: fromMinorUnits(b.taxableBaseCents, CHECKOUT_CURRENCY),
    total: fromMinorUnits(b.totalCents, CHECKOUT_CURRENCY),
    currency: CHECKOUT_CURRENCY,
    pricingPolicyVersion: b.pricingPolicyVersion,
    payment,
    reservationExpiresAt: created.expiresAt?.toISOString() ?? null,
    replayed: false,
  };
}

// ---------------------------------------------------------------------------
// Revalidation
// ---------------------------------------------------------------------------

interface BillableLine {
  variantId: string;
  quantity: number;
  productId: string;
  productName: string;
  sku: string;
  unitPriceCents: number;
  discountPerUnitCents: number;
  promotionId: string | null;
  weightGrams: number | null;
}

interface Revalidation {
  valid: boolean;
  billable: BillableLine[];
  items: Array<{ variantId: string; inStock: boolean }>;
  subtotalCents: number;
  promotionDiscountCents: number;
}

async function revalidateLines(
  cartLines: Array<{ variantId: string; quantity: number }>,
): Promise<Revalidation> {
  const billable: BillableLine[] = [];
  const items: Array<{ variantId: string; inStock: boolean }> = [];
  let valid = true;

  for (const line of cartLines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY_PER_ITEM) {
      valid = false;
      items.push({ variantId: line.variantId, inStock: false });
      continue;
    }
    const entry = await resolveCatalogEntry(line.variantId);
    if (
      !entry ||
      !isPurchasable(entry.variantStatus, entry.productStatus) ||
      line.quantity > entry.availableStock
    ) {
      valid = false;
      items.push({ variantId: line.variantId, inStock: false });
      continue;
    }
    const unitPriceCents = toMinorUnits(entry.effectivePrice, CHECKOUT_CURRENCY);
    billable.push({
      variantId: line.variantId,
      quantity: line.quantity,
      productId: entry.productId,
      productName: entry.productName,
      sku: entry.sku ?? "",
      unitPriceCents,
      discountPerUnitCents: entry.discountPerUnitCents,
      promotionId: entry.promotion?.id ?? null,
      weightGrams: entry.weightGrams,
    });
    items.push({ variantId: line.variantId, inStock: true });
  }

  const subtotalCentsValue = billable.reduce(
    (s, l) => s + l.unitPriceCents * l.quantity, 0,
  );
  const promotionDiscountCents = billable.reduce(
    (s, l) => s + l.discountPerUnitCents * l.quantity, 0,
  );
  return { valid, billable, items, subtotalCents: subtotalCentsValue, promotionDiscountCents };
}

async function readCartItems(
  cartId: string,
): Promise<Array<{ variantId: string; quantity: number }>> {
  const rows = await db
    .select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return rows;
}

// ---------------------------------------------------------------------------
// Tx1: order graph creation
// ---------------------------------------------------------------------------

interface Tx1Result {
  orderId: string;
  orderNumber: string;
  cartId: string;
  couponId: string | null;
  lines: CheckoutLine[];
  breakdown: TotalsBreakdown;
  expiresAt: Date | null;
}

async function createOrderTx(
  user: CheckoutUser,
  input: CheckoutInput,
  ctx: {
    cartId: string;
    lines: BillableLine[];
    shipping: AddressSnapshot;
    billing: AddressSnapshot;
    phone: string | null;
    canonical: CanonicalCheckout;
    checkoutHash: string;
    idempotencyKey: string;
    expectedTotalCents?: number;
  },
): Promise<Tx1Result> {
  let orderNumber = generateOrderNumber();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        // Re-read the cart inside Tx1 and compare with the validated set:
        // closes the validation→creation gap for concurrent cart edits.
        const [cart] = await tx
          .select({ id: carts.id, status: carts.status })
          .from(carts)
          .where(and(eq(carts.id, ctx.cartId), eq(carts.status, "ACTIVE")))
          .for("update");
        if (!cart) throw new CartConsumedError();
        const current = await tx
          .select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
          .from(cartItems)
          .where(eq(cartItems.cartId, ctx.cartId));
        const same =
          current.length === ctx.lines.length &&
          ctx.lines.every((l) =>
            current.some((c) => c.variantId === l.variantId && c.quantity === l.quantity),
          );
        if (!same) {
          throw new CartConflictError("Your cart changed. Review it and try again.");
        }

        // Coupon (locked row, FR-12).
        let coupon: ValidatedCoupon | null = null;
        if (ctx.canonical.couponCode) {
          coupon = await validateCouponForCheckout(
            tx, ctx.canonical.couponCode, ctxSubtotal(ctx),
          );
        }

        // Authoritative totals via the decimal engine: destination + weight
        // resolved shipping, jurisdiction-resolved tax. All server-side.
        const taxRule = resolveTaxRule(ctx.shipping.country);
        const weightGrams = calculateShipmentWeightGrams(
          ctx.lines.map((l) => ({ weightGrams: l.weightGrams, quantity: l.quantity })),
        );
        const quote = quoteShipping({
          method: input.shippingMethod,
          country: ctx.shipping.country,
          subtotalAfterDiscountsCents: ctxSubtotal(ctx) - (coupon?.discountCents ?? 0),
          weightGrams,
          taxesShipping: taxRule.taxesShipping,
        });
        const breakdown = calculateCheckoutTotals({
          currency: CHECKOUT_CURRENCY,
          lines: ctx.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            discountPerUnitCents: l.discountPerUnitCents,
          })),
          couponDiscountCents: coupon?.discountCents ?? 0,
          shippingMethod: input.shippingMethod,
          shippingCents: quote.feeCents,
          taxableShippingCents: quote.taxableCents,
          taxJurisdiction: taxRule.jurisdiction,
          taxRateBps: taxRule.rateBps,
        });

        // Preview confirmation: the client echoes the previewed total (minor
        // units, integer — never trusted for charging). Any drift since the
        // preview aborts BEFORE anything is persisted.
        if (
          ctx.expectedTotalCents !== undefined &&
          ctx.expectedTotalCents !== breakdown.totalCents
        ) {
          throw new TotalChangedError();
        }

        const expiresAt =
          input.paymentMethod === "cod"
            ? null
            : new Date(Date.now() + reservationTtlMinutes() * 60_000);

        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber,
            userId: user.id,
            status: "PENDING",
            subtotal: fromMinorUnits(breakdown.subtotalCents, CHECKOUT_CURRENCY),
            discountAmount: fromMinorUnits(breakdown.totalDiscountCents, CHECKOUT_CURRENCY),
            shippingAmount: fromMinorUnits(breakdown.shippingCents, CHECKOUT_CURRENCY),
            taxAmount: fromMinorUnits(breakdown.taxCents, CHECKOUT_CURRENCY),
            totalAmount: fromMinorUnits(breakdown.totalCents, CHECKOUT_CURRENCY),
            currency: CHECKOUT_CURRENCY,
            paymentStatus: "PENDING",
            checkoutExpiresAt: expiresAt,
            notes: ctx.canonical.notes,
            idempotencyKey: ctx.idempotencyKey,
            checkoutHash: ctx.checkoutHash,
            shippingMethod: breakdown.shippingMethod,
            taxJurisdiction: breakdown.taxJurisdiction,
            taxRateBps: breakdown.taxRateBps,
            taxableBase: fromMinorUnits(breakdown.taxableBaseCents, CHECKOUT_CURRENCY),
            pricingPolicyVersion: breakdown.pricingPolicyVersion,
          })
          .returning({ id: orders.id, orderNumber: orders.orderNumber });
        if (!order) throw new Error("Order insert failed");

        for (const line of ctx.lines) {
          await tx.insert(orderItems).values({
            orderId: order.id,
            variantId: line.variantId,
            productName: line.productName,
            variantName: null,
            sku: line.sku,
            quantity: line.quantity,
            unitPrice: fromMinorUnits(line.unitPriceCents, CHECKOUT_CURRENCY),
            discountAmount: fromMinorUnits(line.discountPerUnitCents * line.quantity, CHECKOUT_CURRENCY),
            totalAmount: fromMinorUnits(
              line.unitPriceCents * line.quantity,
              CHECKOUT_CURRENCY,
            ),
            promotionId: line.promotionId,
          });
        }

        await tx.insert(orderAddresses).values([
          toOrderAddress(order.id, "SHIPPING", ctx.shipping),
          toOrderAddress(order.id, "BILLING", ctx.billing),
        ]);

        await tx.insert(orderStatusHistories).values({
          orderId: order.id,
          status: "PENDING",
          previousStatus: null,
          eventType: "order_placed",
          actorType: "customer",
          actorId: user.id,
          correlationId: ctx.idempotencyKey,
          note: "Order created",
        });

        await tx.insert(payments).values({
          orderId: order.id,
          provider: input.paymentMethod === "cod" ? "cod" : "stripe",
          providerPaymentId: null,
          amount: fromMinorUnits(breakdown.totalCents, CHECKOUT_CURRENCY),
          currency: CHECKOUT_CURRENCY,
          status: "PENDING",
          paymentMethod: input.paymentMethod === "cod" ? "CASH_ON_DELIVERY" : "CARD",
        });

        if (coupon) {
          await consumeCouponUsage(tx, coupon.id, user.id, order.id, breakdown.couponDiscountCents);
        }

        await tx
          .update(carts)
          .set({ status: "CONVERTED", updatedAt: new Date() })
          .where(eq(carts.id, ctx.cartId));

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          cartId: ctx.cartId,
          couponId: coupon?.id ?? null,
          lines: ctx.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            productName: l.productName,
            sku: l.sku,
            unitPrice: fromMinorUnits(l.unitPriceCents, CHECKOUT_CURRENCY),
            discountPerUnit: fromMinorUnits(l.discountPerUnitCents, CHECKOUT_CURRENCY),
            lineSubtotal: fromMinorUnits(l.unitPriceCents * l.quantity, CHECKOUT_CURRENCY),
            promotionId: l.promotionId,
          })),
          breakdown,
          expiresAt,
        };
      });
    } catch (error) {
      if (!isUniqueViolationDeep(error)) throw error;
      const constraint = violatedConstraint(error);
      if (constraint === "orders_user_idempotency_unique") {
        // Lost the insert race with the same key: the winner owns this
        // attempt. Signal the caller to replay it (or 409 on input change).
        const winner = await findOrderByIdempotency(user.id, ctx.idempotencyKey);
        if (winner && winner.checkoutHash === ctx.checkoutHash) {
          throw new ReplaySignal(winner.orderId);
        }
        throw new IdempotencyConflictError();
      }
      if (constraint === "orders_order_number_unique") {
        orderNumber = generateOrderNumber();
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate an order number");
}

function ctxSubtotal(ctx: { lines: BillableLine[] }): number {
  return ctx.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
}

function toOrderAddress(
  orderId: string,
  type: "SHIPPING" | "BILLING",
  snap: AddressSnapshot,
) {
  return {
    orderId,
    type,
    firstName: snap.firstName,
    lastName: snap.lastName,
    phone: snap.phone,
    country: snap.country,
    city: snap.city,
    state: snap.state,
    postalCode: snap.postalCode,
    addressLine1: snap.addressLine1,
    addressLine2: snap.addressLine2,
  };
}

// ---------------------------------------------------------------------------
// Compensation (reservation failure)
// ---------------------------------------------------------------------------

async function compensateReservationFailure(
  orderId: string,
  cartId: string,
  couponId: string | null,
  reason: string,
): Promise<void> {
  // Reuse the existing lifecycle: releases any reservation, cancels, histories.
  // Items were never reserved on shortage (all-or-nothing check), and the call
  // is a no-op for PENDING items — safe either way.
  try {
    await cancelOrder(orderId, { actorId: "checkout", reason, actorType: "system", eventType: "cancelled" });
  } catch {
    // Best-effort: the order row stays consistent (PENDING, unreserved) and
    // the expiry job will still pick it up via checkoutExpiresAt.
  }
  await db.transaction(async (tx) => {
    await tx
      .update(carts)
      .set({ status: "ACTIVE", updatedAt: new Date() })
      .where(eq(carts.id, cartId));
    if (couponId) {
      await releaseCouponUsage(tx, couponId, orderId);
    }
  });
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

async function findOrderByIdempotency(
  userId: string,
  key: string,
): Promise<{ orderId: string; checkoutHash: string | null } | null> {
  const [row] = await db
    .select({ id: orders.id, checkoutHash: orders.checkoutHash })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, key)));
  return row ? { orderId: row.id, checkoutHash: row.checkoutHash } : null;
}

async function buildCanonical(
  profileId: string,
  firstName: string,
  lastName: string,
  phone: string | null,
  input: CheckoutInput,
  cartLines: Array<{ variantId: string; quantity: number }> | null,
  fallbackOrderId: string,
): Promise<CanonicalCheckout> {
  const shipping = await resolveAddressSnapshot(
    profileId, firstName, lastName, phone, input.shippingAddress,
  );
  const billing =
    "sameAsShipping" in input.billingAddress
      ? shipping
      : await resolveAddressSnapshot(
          profileId, firstName, lastName, phone, input.billingAddress,
        );
  const items =
    cartLines ??
    (await db
      .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, fallbackOrderId)));
  return canonicalize(items, shipping, billing, input);
}

async function replayResult(orderId: string): Promise<CheckoutResult> {
  const base = await loadOrderResult(orderId);
  return { ...base, replayed: true };
}

/**
 * Replay a prior order for the same idempotency key. A CANCELLED winner
 * means the original attempt failed (e.g. stock conflict + compensation):
 * the key is spent and the caller must start a new attempt with a fresh key.
 * Otherwise ensure reservation (a racing twin may have created-but-not-
 * reserved) and (re)initialize payment idempotently.
 */
async function replayPriorOrder(
  userId: string,
  orderId: string,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const [order] = await db
    .select({ status: orders.status, totalAmount: orders.totalAmount })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) throw new IdempotencyConflictError();
  if (order.status === "CANCELLED") {
    throw new CartConflictError(
      "Your previous checkout attempt could not be completed. Review your cart and start a new checkout.",
    );
  }
  if (await needsReservation(orderId)) {
    try {
      await reserveOrderInventory(orderId, { actorId: userId });
    } catch (error) {
      if (error instanceof OrderAlreadyReservedError) {
        // Reserved concurrently — proceed.
      } else {
        throw error;
      }
    }
  }
  const payment = await initializeOrderPayment(
    userId, orderId, input.paymentMethod,
    toMinorUnits(order.totalAmount, CHECKOUT_CURRENCY),
    CHECKOUT_CURRENCY,
  );
  const base = await loadOrderResult(orderId);
  return { ...base, payment, replayed: true };
}

/** True when any line still awaits reservation. */
async function needsReservation(orderId: string): Promise<boolean> {
  const rows = await db
    .select({ reservationStatus: orderItems.reservationStatus })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return rows.some((r) => r.reservationStatus === "PENDING");
}

/** Internal control-flow signal: the idempotency winner owns this attempt. */
class ReplaySignal {
  constructor(public readonly orderId: string) {}
}

async function loadOrderResult(orderId: string): Promise<Omit<CheckoutResult, "replayed" | "payment"> & { payment: PaymentInitResult }> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error("Order not found after creation");
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const [paymentRow] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId));
  // Split the combined discount back into promotion + coupon portions via the
  // coupon usage record (order.discountAmount holds their sum).
  const [usage] = await db
    .select({ discountAmount: couponUsages.discountAmount })
    .from(couponUsages)
    .where(eq(couponUsages.orderId, orderId));
  const couponCents = usage?.discountAmount ? toMinorUnits(usage.discountAmount, CHECKOUT_CURRENCY) : 0;
  const totalDiscountCents = toMinorUnits(order.discountAmount, CHECKOUT_CURRENCY);
  const promotionCents = Math.max(0, totalDiscountCents - couponCents);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    lines: lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      productName: l.productName ?? "",
      sku: l.sku,
      unitPrice: l.unitPrice ?? "0.00",
      discountPerUnit: "0.00",
      lineSubtotal: l.totalAmount ?? "0.00",
      promotionId: l.promotionId,
    })),
    subtotal: order.subtotal,
    promotionDiscount: fromMinorUnits(promotionCents, CHECKOUT_CURRENCY),
    couponDiscount: fromMinorUnits(couponCents, CHECKOUT_CURRENCY),
    shipping: order.shippingAmount,
    shippingMethod: (order.shippingMethod ?? "STANDARD") as ShippingMethodId,
    tax: order.taxAmount,
    taxJurisdiction: order.taxJurisdiction ?? "UNCONFIGURED",
    taxRateBps: order.taxRateBps ?? 0,
    taxableBase: order.taxableBase ?? "0.00",
    total: order.totalAmount,
    currency: order.currency,
    pricingPolicyVersion: order.pricingPolicyVersion ?? "1",
    payment: {
      paymentId: paymentRow?.id ?? "",
      provider: (paymentRow?.provider as "stripe" | "cod") ?? "stripe",
      status: (paymentRow?.status as PaymentInitResult["status"]) ?? "PENDING",
      clientSecret: null,
      paymentRequired: (paymentRow?.status ?? "PENDING") === "PENDING",
    },
    reservationExpiresAt: order.checkoutExpiresAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cache invalidation (after successful commit only)
// ---------------------------------------------------------------------------

async function invalidateCheckoutCaches(
  userId: string,
  cartId: string,
  lines: BillableLine[],
): Promise<void> {
  const { invalidateCartCache, invalidateVariantCache } = await import(
    "@/shared/lib/cache/tags"
  );
  await invalidateCartCache({ cartId, userId });
  for (const line of lines) {
    await invalidateVariantCache(line.variantId, line.productId);
  }
}

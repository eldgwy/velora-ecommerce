import { cartStatusEnum, orderReservationStatusEnum } from "@/infrastructure/database/schema/enums";

export type CartStatus = (typeof cartStatusEnum.enumValues)[number];
export type OrderReservationStatus = (typeof orderReservationStatusEnum.enumValues)[number];

export interface CartItem {
  id: string;
  cartId: string;
  variantId: string;
  quantity: number;
  priceAtAddition: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Cart {
  id: string;
  userId: string | null;
  status: CartStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartWithItems extends Cart {
  items: CartItem[];
}

export interface AddCartItemInput {
  variantId: string;
  quantity: number;
}

export interface UpdateCartItemInput {
  itemId: string;
  quantity: number;
}

export interface RemoveCartItemInput {
  itemId: string;
}

export interface CartValidationResult {
  valid: boolean;
  items: ValidatedCartItem[];
  subtotal: string;
  discountTotal: string;
  payableTotal: string;
  warnings: CartWarning[];
  errors: CartError[];
}

export interface ValidatedCartItem {
  id: string;
  variantId: string;
  quantity: number;
  priceAtAddition: string | null;
  currentPrice: string;
  priceChanged: boolean;
  availableStock: number;
  inStock: boolean;
  maxAvailable: number;
  productName: string;
  variantName: string | null;
  sku: string;
  warnings: CartItemWarning[];
}

export interface CartItemWarning {
  type: "price_changed" | "low_stock" | "out_of_stock" | "variant_inactive" | "product_inactive" | "promotion_expired" | "quantity_adjusted";
  message: string;
  severity: "info" | "warning" | "error";
  originalValue?: string | number;
  newValue?: string | number;
}

export interface CartWarning {
  type: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface CartError {
  type: string;
  message: string;
  itemId?: string;
}

export interface MergeCartResult {
  mergedItems: MergedCartItem[];
  adjustedItems: AdjustedCartItem[];
  unavailableItems: UnavailableCartItem[];
  invalidVariants: string[];
  itemsRequiringAction: ActionRequiredItem[];
}

export interface MergedCartItem {
  cartItemId: string;
  variantId: string;
  quantity: number;
  wasExisting: boolean;
}

export interface AdjustedCartItem {
  cartItemId: string;
  variantId: string;
  requestedQuantity: number;
  availableQuantity: number;
  adjustedQuantity: number;
}

export interface UnavailableCartItem {
  variantId: string;
  requestedQuantity: number;
  reason: "inactive" | "out_of_stock" | "deleted";
}

export interface ActionRequiredItem {
  variantId: string;
  guestQuantity: number;
  authQuantity: number;
  availableStock: number;
  reason: "exceeds_stock" | "conflict";
}

export interface CartCookiePayload {
  cartId: string;
  createdAt: number;
  version: number;
}

export interface SignedCartCookie {
  payload: CartCookiePayload;
  signature: string;
}
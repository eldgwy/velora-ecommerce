import { pgEnum } from "drizzle-orm/pg-core";

export const bannerStatusEnum = pgEnum("banner_status", [
  "ACTIVE",
  "EXPIRED",
  "SCHEDULED",
  "DRAFT",
]);

export const promotionTypeEnum = pgEnum("promotion_type", [
  "PERCENTAGE",
  "FIXED",
]);

export const couponTypeEnum = pgEnum("coupon_type", [
  "PERCENTAGE",
  "FIXED",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "PENDING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "COMPLETED",
  "FAILED",
  "REFUNDED",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "CASH_ON_DELIVERY",
  "CARD",
  "PAYPAL",
  "DIGITAL_WALLET",
  "GOOGLE_PAY",
  "APPLE_PAY",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
]);

export const orderPaymentStatusEnum = pgEnum("order_payment_status", [
  "PAID",
  "AUTHORIZED",
  "PENDING",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "REQUIRES_ACTION",
  "EXPIRED",
]);

export const orderAddressTypeEnum = pgEnum("order_address_type", [
  "SHIPPING",
  "BILLING",
]);

export const inventoryMovementTypeEnum = pgEnum(
  "inventory_movement_type",
  [
    "RESTOCK",
    "RELEASE",
    "RESERVATION",
    "DAMAGE",
    "ADJUSTMENT",
    "RETURN",
    "SALE",
  ],
);

export const productVariantStatusEnum = pgEnum(
  "product_variant_status",
  [
    "DRAFT",
    "ACTIVE",
    "ARCHIVE",
  ],
);

export const productStatusEnum = pgEnum("product_status", [
  "DRAFT",
  "ACTIVE",
  "ARCHIVE",
]);

export const cartStatusEnum = pgEnum("cart_status", [
  "ACTIVE",
  "ABANDONED",
  "CONVERTED",
]);

export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "STAFF",
  "CUSTOMER",
]);

export const userStatusEnum = pgEnum("user_status", [
  "ACTIVE",
  "NOTACTIVE",
]);
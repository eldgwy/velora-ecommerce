import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  orderAddressTypeEnum,
  orderPaymentStatusEnum,
  orderReservationStatusEnum,
  orderStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  refundStatusEnum,
} from "./enums";

import { user } from "./auth";
import { productVariants } from "./catalog";
import { randomUUID } from "crypto";

export const orders = pgTable(
  "orders",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    orderNumber: text("order_number").notNull(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "restrict",
      }),

    status: orderStatusEnum("status").notNull(),

    subtotal: numeric("subtotal").notNull(),

    discountAmount: numeric("discount_amount").notNull(),

    shippingAmount: numeric("shipping_amount").notNull(),

    taxAmount: numeric("tax_amount").notNull(),

    totalAmount: numeric("total_amount").notNull(),

    currency: text("currency").notNull(),

    paymentStatus: orderPaymentStatusEnum(
       "payment_status",
     ),

    // FR-08 idempotency: stable client-supplied key per checkout attempt,
    // unique per user. Retries with the same key return the original order.
    // The client-side default keeps historical insert paths compiling; the
    // checkout command always supplies an explicit key.
    idempotencyKey: text("idempotency_key")
      .notNull()
      .$defaultFn(() => randomUUID()),

    // sha256 of the canonical checkout input; reusing a key with different
    // inputs is rejected (409) instead of returning a mismatched order.
    checkoutHash: text("checkout_hash"),

    checkoutExpiresAt: timestamp("checkout_expires_at", {
      mode: "date",
    }),

    notes: text("notes"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_order_number_unique").on(
      table.orderNumber,
    ),

    uniqueIndex("orders_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),

    index("orders_idempotency_key_idx").on(table.idempotencyKey),

    index("orders_user_id_idx").on(table.userId),

    index("orders_status_idx").on(table.status),

    index("orders_payment_status_idx").on(
      table.paymentStatus,
    ),

    index("orders_created_at_idx").on(
      table.createdAt,
    ),

    index("orders_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),

    index("orders_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
      }),

    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "restrict",
      }),

    productName: text("product_name"),

    variantName: text("variant_name"),

    sku: text("sku").notNull(),

    quantity: integer("quantity").notNull(),

    unitPrice: numeric("unit_price"),

    discountAmount: numeric("discount_amount"),

    totalAmount: numeric("total_amount"),

    reservationStatus: orderReservationStatusEnum("reservation_status")
      .notNull()
      .default("PENDING"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_items_order_variant_unique").on(
      table.orderId,
      table.variantId,
    ),

    index("order_items_order_id_idx").on(
      table.orderId,
    ),

    index("order_items_variant_id_idx").on(
      table.variantId,
    ),

    index("order_items_sku_idx").on(table.sku),

    index("order_items_reservation_status_idx").on(
      table.reservationStatus,
    ),
  ],
);

export const orderAddresses = pgTable(
  "order_addresses",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
      }),

    type: orderAddressTypeEnum("type").notNull(),

    firstName: text("first_name"),

    lastName: text("last_name"),

    phone: text("phone"),

    country: text("country"),

    city: text("city"),

    state: text("state"),

    postalCode: text("postal_code"),

    addressLine1: text("address_line1"),

    addressLine2: text("address_line2"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_addresses_order_type_unique").on(
      table.orderId,
      table.type,
    ),

    index("order_addresses_order_id_idx").on(
      table.orderId,
    ),
  ],
);

export const orderStatusHistories = pgTable(
  "order_status_histories",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
      }),

    status: orderStatusEnum("status").notNull(),

    note: text("note"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("order_status_history_order_id_idx").on(
      table.orderId,
    ),

    index("order_status_history_order_created_idx").on(
      table.orderId,
      table.createdAt,
    ),

    index("order_status_history_status_idx").on(
      table.status,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "restrict",
      }),

    provider: text("provider"),

    providerPaymentId: text("provider_payment_id"),

    amount: numeric("amount"),

    currency: text("currency"),

    status: paymentStatusEnum("status"),

    paymentMethod: paymentMethodEnum("payment_method"),

    paidAt: timestamp("paid_at", {
      mode: "date",
    }),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "payments_provider_payment_id_unique",
    ).on(table.providerPaymentId),

    index("payments_order_id_idx").on(table.orderId),

    index("payments_order_status_idx").on(
      table.orderId,
      table.status,
    ),

    index("payments_status_idx").on(table.status),

    index("payments_provider_idx").on(table.provider),

    index("payments_created_at_idx").on(
      table.createdAt,
    ),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, {
        onDelete: "restrict",
      }),

    providerRefundId: text("provider_refund_id"),

    amount: numeric("amount"),

    reason: text("reason"),

    status: refundStatusEnum("status")
      .notNull()
      .default("PENDING"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "refunds_provider_refund_id_unique",
    ).on(table.providerRefundId),

    index("refunds_payment_id_idx").on(
      table.paymentId,
    ),

    index("refunds_payment_status_idx").on(
      table.paymentId,
      table.status,
    ),

    index("refunds_status_idx").on(table.status),

    index("refunds_created_at_idx").on(
      table.createdAt,
    ),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    provider: text("provider").notNull(),

    providerEventId: text("provider_event_id").notNull(),

    eventType: text("event_type").notNull(),

    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),

    paymentId: uuid("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),

    status: text("status").notNull().default("PENDING"),

    errorMessage: text("error_message"),

    attempts: integer("attempts").notNull().default(0),

    completedAt: timestamp("completed_at", {
      mode: "date",
    }),

    payload: jsonb("payload").notNull(),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_event_id_unique").on(
      table.provider,
      table.providerEventId,
    ),

    index("webhook_events_order_id_idx").on(table.orderId),

    index("webhook_events_payment_id_idx").on(table.paymentId),

    index("webhook_events_status_idx").on(table.status),

    index("webhook_events_provider_idx").on(table.provider),
  ],
);
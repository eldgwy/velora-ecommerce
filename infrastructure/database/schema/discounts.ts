import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  couponTypeEnum,
  promotionTypeEnum,
} from "./enums";

import { user } from "./auth";
import { orders } from "./orders";
import { products } from "./catalog";

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    code: text("code").notNull(),

    type: couponTypeEnum("type").notNull(),

    value: numeric("value").notNull(),

    minimumOrderAmount: numeric(
      "minimum_order_amount",
    ),

    maximumDiscountAmount: numeric(
      "maximum_discount_amount",
    ),

    usageLimit: integer("usage_limit"),

    perUserLimit: integer("per_user_limit"),

    usageCount: integer("usage_count")
      .notNull()
      .default(0),

    startsAt: timestamp("starts_at", {
      mode: "date",
    }),

    expiresAt: timestamp("expires_at", {
      mode: "date",
    }),

    isActive: boolean("is_active")
      .notNull()
      .default(true),

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
    uniqueIndex("coupons_code_unique").on(table.code),

    index("coupons_code_idx").on(table.code),

    index("coupons_is_active_idx").on(
      table.isActive,
    ),

    index("coupons_starts_expires_idx").on(
      table.startsAt,
      table.expiresAt,
    ),

    // FR-12 integrity: positive values, percentage bounded, sane windows
    // and limits. Codes are normalized uppercase, 3–32 chars
    // ([A-Z0-9-_] by application validation).
    check(
      "coupons_value_positive",
      sql`"value" > 0`,
    ),
    check(
      "coupons_percentage_bounded",
      sql`"type" <> 'PERCENTAGE' OR "value" <= 100`,
    ),
    check(
      "coupons_minimum_non_negative",
      sql`"minimum_order_amount" IS NULL OR "minimum_order_amount" >= 0`,
    ),
    check(
      "coupons_max_discount_non_negative",
      sql`"maximum_discount_amount" IS NULL OR "maximum_discount_amount" >= 0`,
    ),
    check(
      "coupons_window_ordered",
      sql`"starts_at" IS NULL OR "expires_at" IS NULL OR "expires_at" > "starts_at"`,
    ),
    check(
      "coupons_usage_limit_non_negative",
      sql`"usage_limit" IS NULL OR "usage_limit" >= 0`,
    ),
    check(
      "coupons_per_user_limit_non_negative",
      sql`"per_user_limit" IS NULL OR "per_user_limit" >= 0`,
    ),
    check(
      "coupons_usage_count_non_negative",
      sql`"usage_count" >= 0`,
    ),
    check(
      "coupons_code_length",
      sql`char_length("code") BETWEEN 3 AND 32`,
    ),
  ],
);

export const couponUsages = pgTable(
  "couponusages",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    couponId: uuid("coupon_id").references(
      () => coupons.id,
      {
        onDelete: "cascade",
      },
    ),

    userId: text("user_id").references(
      () => user.id,
      {
        onDelete: "set null",
      },
    ),

    orderId: uuid("order_id").references(
      () => orders.id,
      {
        onDelete: "set null",
      },
    ),

    discountAmount: numeric("discount_amount"),

    // Immutable snapshot of the coupon as applied: historical orders keep
    // explaining their discount even if the coupon is renamed, edited, or
    // deactivated later. NULL on pre-policy rows means "unknown".
    code: text("code"),

    type: couponTypeEnum("type"),

    value: numeric("value"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One redemption record per (coupon, order): retries and replays can
    // never duplicate usage rows.
    uniqueIndex("couponusages_coupon_order_unique").on(
      table.couponId,
      table.orderId,
    ),

    index("couponusages_coupon_id_idx").on(
      table.couponId,
    ),

    index("couponusages_user_id_idx").on(
      table.userId,
    ),

    index("couponusages_order_id_idx").on(
      table.orderId,
    ),

    index("couponusages_coupon_user_idx").on(
      table.couponId,
      table.userId,
    ),
  ],
);

export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    name: text("name").notNull(),

    description: text("description"),

    type: promotionTypeEnum("type").notNull(),

    value: numeric("value").notNull(),

    startsAt: timestamp("starts_at", {
      mode: "date",
    }).notNull(),

    endsAt: timestamp("ends_at", {
      mode: "date",
    }),

    isActive: boolean("is_active")
      .notNull()
      .default(true),

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
    index("promotions_is_active_idx").on(
      table.isActive,
    ),

    index("promotions_starts_ends_idx").on(
      table.startsAt,
      table.endsAt,
    ),

    index("promotions_active_starts_idx").on(
      table.isActive,
      table.startsAt,
    ),
  ],
);

export const promotionProducts = pgTable(
  "promotion_products",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, {
        onDelete: "cascade",
      }),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "restrict",
      }),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "promotion_products_promotion_product_unique",
    ).on(table.promotionId, table.productId),

    index("promotion_products_promotion_id_idx").on(
      table.promotionId,
    ),

    index("promotion_products_product_id_idx").on(
      table.productId,
    ),
  ],
);
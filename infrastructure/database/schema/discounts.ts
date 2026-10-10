import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
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
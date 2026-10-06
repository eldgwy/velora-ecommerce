import {
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";

import { cartStatusEnum } from "./enums";
import { user } from "./auth";
import { productVariants } from "./catalog";

export const carts = pgTable(
  "cart",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),

    status: cartStatusEnum("status").notNull(),

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
    index("cart_user_id_idx").on(table.userId),

    index("cart_status_idx").on(table.status),

    index("cart_user_status_idx").on(
      table.userId,
      table.status,
    ),

    index("cart_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, {
        onDelete: "cascade",
      }),

    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "cascade",
      }),

    quantity: integer("quantity").notNull(),

    priceAtAddition: numeric("price_at_addition"),

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
    uniqueIndex("cart_items_cart_variant_unique").on(
      table.cartId,
      table.variantId,
    ),

    index("cart_items_cart_id_idx").on(table.cartId),

    index("cart_items_variant_id_idx").on(
      table.variantId,
    ),
  ],
);
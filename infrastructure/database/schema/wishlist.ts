import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { products } from "./catalog";

export const wishlists = pgTable(
  "wishlist",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
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
    uniqueIndex("wishlist_user_id_unique").on(
      table.userId,
    ),
  ],
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, {
        onDelete: "cascade",
      }),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
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
      "wishlist_items_wishlist_product_unique",
    ).on(table.wishlistId, table.productId),

    index("wishlist_items_wishlist_id_idx").on(
      table.wishlistId,
    ),

    index("wishlist_items_product_id_idx").on(
      table.productId,
    ),
  ],
);
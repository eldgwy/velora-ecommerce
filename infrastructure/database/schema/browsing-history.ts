import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { products } from "./catalog";

/**
 * Server-side browsing history for authenticated customers: one row per
 * (customer, product) with the most recent view time. Repeat views refresh
 * the row in place (upsert) — never duplicates. Rows beyond the history
 * limit are pruned on write, so no scheduler or retention job exists.
 *
 * Guests use bounded browser-local storage instead (no server rows, no
 * tracking accounts); see the recently-viewed module domain rules.
 */
export const productViewHistory = pgTable(
  "product_view_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
      }),

    viewedAt: timestamp("viewed_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("product_view_history_user_product_unique").on(
      table.userId,
      table.productId,
    ),

    index("product_view_history_user_viewed_idx").on(
      table.userId,
      table.viewedAt,
    ),

    index("product_view_history_product_id_idx").on(
      table.productId,
    ),
  ],
);

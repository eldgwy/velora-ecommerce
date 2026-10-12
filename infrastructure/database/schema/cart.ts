import {
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { cartStatusEnum } from "./enums";
import { user } from "./auth";
import { productVariants } from "./catalog";

export const carts = pgTable(
  "cart",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    // Nullable: guest carts are owned by `guestId` instead.
    // Exactly one of userId / guestId must be set (see cart_owner_check).
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),

    // Opaque guest token (random UUID generated server-side). The signed
    // guest cookie carries only this identifier — never prices or items.
    guestId: text("guest_id"),

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

    index("cart_guest_id_idx").on(table.guestId),

    index("cart_status_idx").on(table.status),

    index("cart_user_status_idx").on(
      table.userId,
      table.status,
    ),

    index("cart_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),

    // FR-06: each authenticated user has at most one ACTIVE cart.
    // Partial index so CONVERTED/ABANDONED history rows are unaffected.
    uniqueIndex("cart_user_active_unique")
      .on(table.userId)
      .where(sql`${table.status} = 'ACTIVE'`),

    // One ACTIVE cart per guest token (NULL guestIds never conflict).
    uniqueIndex("cart_guest_active_unique")
      .on(table.guestId)
      .where(sql`${table.status} = 'ACTIVE'`),

    // Every cart must have exactly one owner.
    check(
      "cart_owner_check",
      sql`${table.userId} IS NOT NULL OR ${table.guestId} IS NOT NULL`,
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

    // BR-017: cart-item quantities are positive integers.
    // Quantity zero is represented by deleting the row.
    check(
      "cart_items_quantity_positive",
      sql`${table.quantity} >= 1`,
    ),
  ],
);
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bannerStatusEnum } from "./enums";
import { products } from "./catalog";

export const collections = pgTable(
  "collections",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    name: text("name").notNull(),

    slug: text("slug").notNull(),

    description: text("description"),

    image: text("image"),

    isActive: boolean("is_active")
      .notNull()
      .default(false),

    sortOrder: integer("sort_order"),

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
    uniqueIndex("collections_slug_unique").on(
      table.slug,
    ),

    index("collections_is_active_idx").on(
      table.isActive,
    ),

    index("collections_sort_order_idx").on(
      table.sortOrder,
    ),

    index("collections_active_sort_idx").on(
      table.isActive,
      table.sortOrder,
    ),
  ],
);

export const collectionProducts = pgTable(
  "collection_products",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, {
        onDelete: "cascade",
      }),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "restrict",
      }),

    sortOrder: integer("sort_order"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "collection_products_collection_product_unique",
    ).on(table.collectionId, table.productId),

    index("collection_products_collection_id_idx").on(
      table.collectionId,
    ),

    index("collection_products_product_id_idx").on(
      table.productId,
    ),

    index("collection_products_collection_sort_idx").on(
      table.collectionId,
      table.sortOrder,
    ),
  ],
);

export const banners = pgTable(
  "banners",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    title: text("title"),

    subtitle: text("subtitle"),

    image: text("image"),

    mobileImage: text("mobile_image"),

    link: text("link"),

    sortOrder: integer("sort_order"),

    startsAt: timestamp("starts_at", {
      mode: "date",
    }),

    endsAt: timestamp("ends_at", {
      mode: "date",
    }),

    // Preserve original Prisma mapping:
    // status BannerStatus @map("is_active")
    status: bannerStatusEnum("is_active")
      .notNull()
      .default("ACTIVE"),

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
    index("banners_status_idx").on(table.status),

    index("banners_sort_order_idx").on(
      table.sortOrder,
    ),

    index("banners_starts_ends_idx").on(
      table.startsAt,
      table.endsAt,
    ),

    index("banners_status_sort_idx").on(
      table.status,
      table.sortOrder,
    ),
  ],
);
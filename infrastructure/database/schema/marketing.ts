import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

    check(
      "collections_name_length",
      sql`char_length("name") BETWEEN 1 AND 120`,
    ),

    check(
      "collections_slug_format",
      sql`char_length("slug") BETWEEN 3 AND 64 AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),

    check(
      "collections_description_length",
      sql`"description" IS NULL OR char_length("description") <= 2000`,
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

    title: text("title").notNull(),

    subtitle: text("subtitle"),

    image: text("image").notNull(),

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

    check(
      "banners_title_length",
      sql`char_length("title") BETWEEN 1 AND 120`,
    ),

    check(
      "banners_subtitle_length",
      sql`"subtitle" IS NULL OR char_length("subtitle") <= 300`,
    ),

    check(
      "banners_sort_order_non_negative",
      sql`"sort_order" IS NULL OR "sort_order" >= 0`,
    ),

    check(
      "banners_window_ordered",
      sql`"starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"`,
    ),

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
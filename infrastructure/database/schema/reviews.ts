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

import { reviewStatusEnum } from "./enums";
import { user } from "./auth";
import { products } from "./catalog";

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    userId: text("user_id").references(
      () => user.id,
      {
        onDelete: "set null",
      },
    ),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
      }),

    rating: integer("rating"),

    title: text("title"),

    content: text("content"),

    status: reviewStatusEnum("status").default("pending"),

    // Server-determined at submission: the author holds a DELIVERED order
    // containing this product. The public badge renders only for
    // APPROVED + verified rows; never client-supplied.
    isVerifiedBuyer: boolean("is_verified_buyer")
      .notNull()
      .default(false),

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
    uniqueIndex("reviews_user_product_unique").on(
      table.userId,
      table.productId,
    ),

    check(
      "reviews_rating_range",
      sql`"rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5)`,
    ),

    check(
      "reviews_title_length",
      sql`"title" IS NULL OR char_length("title") BETWEEN 1 AND 120`,
    ),

    check(
      "reviews_content_length",
      sql`"content" IS NULL OR char_length("content") BETWEEN 1 AND 5000`,
    ),

    index("reviews_product_id_idx").on(
      table.productId,
    ),

    index("reviews_product_status_idx").on(
      table.productId,
      table.status,
    ),

    index("reviews_user_id_idx").on(table.userId),

    index("reviews_status_idx").on(table.status),

    index("reviews_created_at_idx").on(
      table.createdAt,
    ),
  ],
);

export const reviewImages = pgTable(
  "review_images",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, {
        onDelete: "cascade",
      }),

    url: text("url"),

    publicId: text("public_id"),

    sortOrder: integer("sort_order"),

    isPrimary: boolean("is_primary")
      .notNull()
      .default(false),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("review_images_review_id_idx").on(
      table.reviewId,
    ),

    index("review_images_review_sort_idx").on(
      table.reviewId,
      table.sortOrder,
    ),
  ],
);
import {
  AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  productStatusEnum,
  productVariantStatusEnum,
} from "./enums";

export const categories = pgTable("categories", {
    id: uuid("id").defaultRandom().primaryKey(),

    slug: text("slug").notNull(),

    name: text("name").notNull(),

    description: text("description"),

    logo: text("logo"),

    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict", }),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { mode: "date", }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date", }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_slug_unique").on(table.slug),

    index("categories_parent_id_idx").on(table.parentId),

    index("categories_is_active_idx").on(table.isActive),

    index("categories_parent_active_idx").on(table.parentId, table.isActive),
  ],
);

export const brands = pgTable("brand", {
    id: uuid("id").defaultRandom().primaryKey(),

    slug: text("slug").notNull(),

    name: text("name").notNull(),

    description: text("description"),

    logo: text("logo"),

    website: text("website"),

    seoTitle: text("seo_title"),

    seoDescription: text("seo_description"),

    createdAt: timestamp("created_at", { mode: "date", }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date", }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("brand_slug_unique").on(table.slug),

    index("brand_name_idx").on(table.name),
  ],
);

export const products = pgTable("products", {
    id: uuid("id").defaultRandom().primaryKey(),

    name: text("name").notNull(),

    description: text("description"),

    status: productStatusEnum("status").notNull().default("ACTIVE"),

    basePrice: numeric("base_price").notNull(),

    comparePrice: numeric("compare_price"),

    createdAt: timestamp("created_at", { mode: "date", }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date", }).notNull().defaultNow(),

    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "restrict", }),

    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "restrict", }),
  },
  (table) => [
    index("products_category_id_idx").on(
      table.categoryId,
    ),

    index("products_brand_id_idx").on(table.brandId),

    index("products_status_idx").on(table.status),

    index("products_created_at_idx").on(
      table.createdAt,
    ),

    index("products_category_status_idx").on(
      table.categoryId,
      table.status,
    ),

    index("products_brand_status_idx").on(
      table.brandId,
      table.status,
    ),

    check("products_base_price_positive", sql`${table.basePrice} > 0`),

    check("products_compare_price_valid", sql`${table.comparePrice} IS NULL OR ${table.comparePrice} >= ${table.basePrice}`),
  ],
);

export const productImages = pgTable("product_images", {
    id: uuid("id").defaultRandom().primaryKey(),

    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade", }),

    publicId: text("public_id").notNull(),

    url: text("url").notNull(),

    alt: text("alt"),

    isPrimary: boolean("is_primary").notNull().default(false),

    sortOrder: integer("sort_order"),

    createdAt: timestamp("created_at", { mode: "date", }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date", }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_images_public_id_unique").on(
      table.publicId,
    ),

    uniqueIndex("product_images_url_unique").on(
      table.url,
    ),

    index("product_images_product_id_idx").on(
      table.productId,
    ),

    index("product_images_product_sort_idx").on(
      table.productId,
      table.sortOrder,
    ),

    // Exactly one primary image per product (SRS FR-XX)
    uniqueIndex("product_images_product_primary_unique").on(
      table.productId,
    ).where(sql`is_primary = true`),
  ],
);

export const productVariants = pgTable(
  "product_variant",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
      }),

    description: text("description"),

    status: productVariantStatusEnum("is_active")
      .notNull()
      .default("ACTIVE"),

    sku: text("sku"),

    barcode: text("barcode"),

    priceOverride: numeric("price_override"),

    seoTitle: text("seo_title"),

    seoDescription: text("seo_description"),

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
    index("product_variant_product_id_idx").on(
      table.productId,
    ),

    index("product_variant_status_idx").on(table.status),

    index("product_variant_product_status_idx").on(
      table.productId,
      table.status,
    ),

    uniqueIndex("product_variant_sku_unique").on(
      table.sku,
    ),

    uniqueIndex("product_variant_barcode_unique").on(
      table.barcode,
    ),

    check("product_variant_price_override_positive", sql`${table.priceOverride} IS NULL OR ${table.priceOverride} > 0`),
  ],
);

export const productOptions = pgTable(
  "product_option",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
      }),

    name: text("name").notNull(),

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
    uniqueIndex("product_option_product_name_unique").on(
      table.productId,
      table.name,
    ),

    index("product_option_product_id_idx").on(
      table.productId,
    ),
  ],
);

export const productOptionValues = pgTable(
  "product_option_value",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    optionId: uuid("option_id")
      .notNull()
      .references(() => productOptions.id, {
        onDelete: "cascade",
      }),

    value: text("value").notNull(),

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
    uniqueIndex(
      "product_option_value_option_value_unique",
    ).on(table.optionId, table.value),

    index("product_option_value_option_id_idx").on(
      table.optionId,
    ),
  ],
);

export const variantOptionValues = pgTable(
  "variant_option_value",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "cascade",
      }),

    optionValueId: uuid("option_value_id")
      .notNull()
      .references(() => productOptionValues.id, {
        onDelete: "cascade",
      }),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.variantId, table.optionValueId],
    }),

    index("variant_option_value_option_value_idx").on(
      table.optionValueId,
    ),
  ],
);

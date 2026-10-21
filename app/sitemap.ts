import type { MetadataRoute } from "next";
import { and, eq, inArray } from "drizzle-orm";

import { env } from "@/config/env";
import { db } from "@/infrastructure/database";
import { categories, products } from "@/infrastructure/database/schema/catalog";
import {
  getEffectiveVisibleCategoryIds,
} from "@/services/catalog-public/queries";
import { listPublicCollections } from "@/modules/collections/application/queries/collections";

/**
 * Sitemap (GP-29) built strictly from real public data:
 * - products: ACTIVE and inside effectively visible categories (the same
 *   visibility rule the catalog queries enforce, reused via
 *   getEffectiveVisibleCategoryIds);
 * - categories: the visible set only (hidden subtree never appears);
 * - collections: active collections only;
 * - plus the static storefront entry points. Filtered listing URLs
 *   (?brand=, ?page=) are intentionally excluded from crawling hints.*
 * No unstable_cache wrappers here: sitemap entries are relatively cheap,
 * the route is revalidated hourly, and Next's sitemap output is served
 * per-request-slice — mirroring how other public data routes consume the
 * same queries directly. lastModified uses stored updated_at values.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = new URL(env.BETTER_AUTH_URL);

  const route = (path: string, lastModified?: Date): MetadataRoute.Sitemap[number] => ({
    url: new URL(path, base).toString(),
    ...(lastModified ? { lastModified } : {}),
  });

  const entries: MetadataRoute.Sitemap = [
    route("/"),
    route("/products"),
    route("/categories"),
    route("/collections"),
  ];

  const [visibleCategoryIds, collections] = await Promise.all([
    getEffectiveVisibleCategoryIds(),
    listPublicCollections(),
  ]);

  if (visibleCategoryIds.length > 0) {
    const [categoryRows, productRows] = await Promise.all([
      db
        .select({ slug: categories.slug, updatedAt: categories.updatedAt })
        .from(categories)
        .where(inArray(categories.id, visibleCategoryIds)),
      db
        .select({ slug: products.slug, updatedAt: products.updatedAt })
        .from(products)
        .where(
          and(
            eq(products.status, "ACTIVE"),
            inArray(products.categoryId, visibleCategoryIds),
          ),
        ),
    ]);

    for (const category of categoryRows) {
      entries.push(route(`/categories/${category.slug}`, category.updatedAt));
    }
    for (const product of productRows) {
      entries.push(route(`/products/${product.slug}`, product.updatedAt));
    }
  }

  for (const collection of collections) {
    entries.push(route(`/collections/${collection.slug}`));
  }

  return entries;
}

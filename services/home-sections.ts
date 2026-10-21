import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { cacheTags } from "@/shared/lib/cache/tag-names";
import {
  getCategoryTree,
  listProducts,
} from "@/services/catalog-public/queries";
import { getCollectionCards } from "@/modules/collections/application/queries/collections";
import type { CollectionCardData } from "@/modules/collections/application/queries/collections";

/**
 * Home-page merchandising (GP-02): every section is backed by the same
 * public catalog data the storefront serves elsewhere — nothing static.
 *
 * - `featured` — deterministic default listing order, capped.
 * - `newArrivals` — `newest` sort (created_at with deterministic tie-break).
 * - `bestSellers` — real sales rollup: units sold via order lines of orders
 *   whose payment is PAID (money captured at the order level). order_items
 *   carries only the variant reference, so the rollup goes through
 *   product_variant; snapshots (historical order rows) are only read, never
 *   written. When the store has no paid sales yet, the section falls back to
 *   the `rating` sort instead of showing fabricated "best sellers"
 *   (decision documented in docs/production-remediation-report.md, D9).
 * - `categories` — top-level categories of the effective-visible tree, the
 *   same tree the storefront category surfaces use.
 *
 * Cached under the shared catalog tags so any listing/category mutation
 * revalidates the home page exactly like the other catalog surfaces.
 */
const SECTION_SIZE = 8;

export interface HomeCategorySectionItem {
  name: string;
  slug: string;
}

export interface HomeSections {
  featured: CollectionCardData[];
  newArrivals: CollectionCardData[];
  bestSellers: CollectionCardData[];
  bestSellersBySales: boolean;
  categories: HomeCategorySectionItem[];
}

interface BestSellerRow {
  productId: string;
}

async function getBestSellerProductIds(limit: number): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT pv.product_id AS "productId",
           SUM(oi.quantity)::int AS "units",
           MAX(o.created_at) AS "lastSale"
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    INNER JOIN product_variant pv ON pv.id = oi.variant_id
    INNER JOIN products p ON p.id = pv.product_id
    WHERE o.payment_status = 'PAID'
      AND p.status = 'ACTIVE'
    GROUP BY pv.product_id
    ORDER BY "units" DESC, "lastSale" DESC, pv.product_id
    LIMIT ${limit}
  `)) as unknown as BestSellerRow[];
  return rows.map((row) => row.productId);
}

async function getSectionCards(order: string[]): Promise<CollectionCardData[]> {
  if (order.length === 0) return [];
  const cards = await getCollectionCards(order);
  // getCollectionCards drops rows that are not currently ACTIVE; preserve
  // the caller's section order.
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  return order.map((id) => cardMap.get(id)).filter((c) => c !== undefined);
}

export const getHomeSections = unstable_cache(
  async (): Promise<HomeSections> => {
    const [featuredList, newArrivalsList] = await Promise.all([
      listProducts({ pageSize: SECTION_SIZE }),
      listProducts({ pageSize: SECTION_SIZE, sort: "newest" }),
    ]);

    const [bestSellerIds, categoryTree] = await Promise.all([
      getBestSellerProductIds(SECTION_SIZE),
      getCategoryTree(true),
    ]);

    const bestSellersBySales = bestSellerIds.length > 0;
    let bestSellerOrder = bestSellerIds;
    if (!bestSellersBySales) {
      // No completed sales yet — fall back to the top-rated listing so the
      // section reflects real catalog data instead of fabricated rankings.
      const topRated = await listProducts({
        pageSize: SECTION_SIZE,
        sort: "rating",
      });
      bestSellerOrder = topRated.items.map((p) => p.id);
    }

    const [featured, newArrivals, bestSellers] = await Promise.all([
      getSectionCards(featuredList.items.map((p) => p.id)),
      getSectionCards(newArrivalsList.items.map((p) => p.id)),
      getSectionCards(bestSellerOrder),
    ]);

    return {
      featured,
      newArrivals,
      bestSellers,
      bestSellersBySales,
      // Deterministic ordering (audit GP-07): name-ascending, capped.
      categories: [...categoryTree]
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, SECTION_SIZE)
        .map((c) => ({ name: c.name, slug: c.slug })),
    };
  },
  ["home-sections"],
  { tags: [cacheTags.productsListing, cacheTags.categoriesTree], revalidate: 60 },
);

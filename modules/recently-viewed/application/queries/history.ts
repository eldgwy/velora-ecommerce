import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { productImages, products } from "@/infrastructure/database/schema/catalog";
import { productViewHistory } from "@/infrastructure/database/schema/browsing-history";
import { HISTORY_LIMIT } from "@/modules/recently-viewed/domain/history-rules";

export interface RecentViewItem {
  productId: string;
  slug: string;
  productName: string;
  basePrice: string;
  comparePrice: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVE";
  primaryImageUrl: string | null;
  primaryImageAlt: string | null;
  viewedAt: Date;
}

export interface RecentHistory {
  items: RecentViewItem[];
  itemCount: number;
}

/**
 * The customer's history with live catalog data in one joined query —
 * no N+1, no frozen prices. Ordered by recency (timestamp, then id for
 * full determinism), capped at the history limit. Products that became
 * DRAFT/ARCHIVE stay listed with their live status so the customer can
 * remove them; deleted products vanish via the cascade.
 */
export async function getRecentHistory(
  userId: string,
  opts: { excludeProductId?: string; limit?: number } = {},
): Promise<RecentHistory> {
  const limit = Math.min(HISTORY_LIMIT, Math.max(1, opts.limit ?? HISTORY_LIMIT));
  const rows = await db
    .select({
      productId: products.id,
      slug: products.slug,
      productName: products.name,
      basePrice: products.basePrice,
      comparePrice: products.comparePrice,
      status: products.status,
      primaryImageUrl: productImages.url,
      primaryImageAlt: productImages.alt,
      viewedAt: productViewHistory.viewedAt,
    })
    .from(productViewHistory)
    .innerJoin(products, eq(products.id, productViewHistory.productId))
    .leftJoin(
      productImages,
      and(
        eq(productImages.productId, products.id),
        eq(productImages.isPrimary, true),
      ),
    )
    .where(eq(productViewHistory.userId, userId))
    .orderBy(desc(productViewHistory.viewedAt), desc(productViewHistory.id))
    .limit(limit + (opts.excludeProductId ? 1 : 0));

  const items = rows
    .filter((r) => r.productId !== opts.excludeProductId)
    .slice(0, limit);
  return { items, itemCount: items.length };
}

/**
 * Resolve guest ids to live product cards in the caller's order.
 * Unknown, deleted, or inactive products drop out; no stored metadata is
 * trusted — name, price, image, and status all come from the catalog.
 */
export async function resolveGuestHistory(
  productIds: string[],
): Promise<RecentViewItem[]> {
  const ids = [...new Set(productIds)].slice(0, HISTORY_LIMIT);
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      productId: products.id,
      slug: products.slug,
      productName: products.name,
      basePrice: products.basePrice,
      comparePrice: products.comparePrice,
      status: products.status,
      primaryImageUrl: productImages.url,
      primaryImageAlt: productImages.alt,
    })
    .from(products)
    .leftJoin(
      productImages,
      and(
        eq(productImages.productId, products.id),
        eq(productImages.isPrimary, true),
      ),
    )
    .where(inArray(products.id, ids));
  const byId = new Map(rows.map((r) => [r.productId, r]));
  const now = new Date();
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r && r.status === "ACTIVE")
    .map((r) => ({ ...r, viewedAt: now }));
}

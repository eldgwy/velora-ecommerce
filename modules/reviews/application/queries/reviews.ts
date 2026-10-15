import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import { reviewImages, reviews } from "@/infrastructure/database/schema/reviews";
import { user } from "@/infrastructure/database/schema/auth";

export type ApprovedStatus = "approved";

export interface RatingSummary {
  productId: string;
  averageRating: number | null;
  reviewCount: number;
  /** Approved-only counts per star, keys 1–5. */
  distribution: Record<number, number>;
}

/**
 * Approved-only rating summary in SQL (no full fetch). Pending and
 * rejected rows can never influence the average, count, or distribution.
 */
export async function getRatingSummary(productId: string): Promise<RatingSummary> {
  const [row] = await db
    .select({
      avgRating: sql<number | null>`AVG(${reviews.rating})::numeric(3,2)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.status, "approved")));
  const distRows = await db
    .select({
      rating: reviews.rating,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.status, "approved")))
    .groupBy(reviews.rating);
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of distRows) {
    if (d.rating !== null && d.rating >= 1 && d.rating <= 5) {
      distribution[d.rating] = d.count;
    }
  }
  return {
    productId,
    averageRating: row?.avgRating != null ? Number(row.avgRating) : null,
    reviewCount: row?.count ?? 0,
    distribution,
  };
}

export interface PublicReviewImage {
  id: string;
  url: string | null;
}

export interface PublicReviewView {
  id: string;
  rating: number | null;
  title: string | null;
  content: string | null;
  userName: string | null;
  /** Badge renders only when true AND the review is approved (always true here). */
  isVerifiedBuyer: boolean;
  createdAt: Date;
  images: PublicReviewImage[];
}

export interface PublicReviewList {
  items: PublicReviewView[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/**
 * Paginated approved-only review list with batched images (no N+1).
 * The only public review surface; pending/rejected rows are excluded in
 * the data-access layer, never merely hidden in the UI.
 */
export async function listApprovedReviews(
  productId: string,
  page = 1,
  pageSize = 10,
): Promise<PublicReviewList> {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(50, Math.max(1, pageSize));
  const where = and(eq(reviews.productId, productId), eq(reviews.status, "approved"));

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(reviews)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      content: reviews.content,
      userName: user.name,
      isVerifiedBuyer: reviews.isVerifiedBuyer,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(where)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(safeSize)
    .offset((safePage - 1) * safeSize);

  const imageRows =
    rows.length > 0
      ? await db
          .select({
            id: reviewImages.id,
            reviewId: reviewImages.reviewId,
            url: reviewImages.url,
            sortOrder: reviewImages.sortOrder,
          })
          .from(reviewImages)
          .where(
            inArray(
              reviewImages.reviewId,
              rows.map((r) => r.id),
            ),
          )
      : [];
  const imageMap = new Map<string, PublicReviewImage[]>();
  for (const img of imageRows
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const list = imageMap.get(img.reviewId) ?? [];
    list.push({ id: img.id, url: img.url });
    imageMap.set(img.reviewId, list);
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      content: r.content,
      userName: r.userName,
      isVerifiedBuyer: r.isVerifiedBuyer,
      createdAt: r.createdAt,
      images: imageMap.get(r.id) ?? [],
    })),
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safeSize)),
    currentPage: safePage,
  };
}

export interface ModerationQueueItem {
  id: string;
  productId: string;
  productName: string | null;
  userName: string | null;
  rating: number | null;
  title: string | null;
  content: string | null;
  status: string | null;
  isVerifiedBuyer: boolean;
  imageCount: number;
  createdAt: Date;
}

export interface ModerationQueue {
  items: ModerationQueueItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/**
 * Admin moderation queue (server-gated by the action layer). Joins product
 * and author names plus image counts in batched queries — no N+1, no
 * unnecessary PII (names only, never emails or addresses).
 */
export async function getModerationQueue(opts: {
  status?: "pending" | "approved" | "rejected";
  productId?: string;
  page?: number;
  pageSize?: number;
}): Promise<ModerationQueue> {
  const status = opts.status ?? "pending";
  const safePage = Math.max(1, opts.page ?? 1);
  const safeSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const conditions = [eq(reviews.status, status)];
  if (opts.productId) conditions.push(eq(reviews.productId, opts.productId));
  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(reviews)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select({
      id: reviews.id,
      productId: reviews.productId,
      productName: products.name,
      userName: user.name,
      rating: reviews.rating,
      title: reviews.title,
      content: reviews.content,
      status: reviews.status,
      isVerifiedBuyer: reviews.isVerifiedBuyer,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .leftJoin(products, eq(products.id, reviews.productId))
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(where)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(safeSize)
    .offset((safePage - 1) * safeSize);

  const imageCounts =
    rows.length > 0
      ? ((await db.execute(sql`
          SELECT review_id, COUNT(*)::int AS count
          FROM review_images
          WHERE review_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
          GROUP BY review_id
        `)) as Array<{ review_id: string; count: number }>)
      : [];
  const countMap = new Map(imageCounts.map((c) => [c.review_id, c.count]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      userName: r.userName,
      rating: r.rating,
      title: r.title,
      content: r.content,
      status: r.status,
      isVerifiedBuyer: r.isVerifiedBuyer,
      imageCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt,
    })),
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safeSize)),
    currentPage: safePage,
  };
}

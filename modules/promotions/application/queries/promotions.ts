import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import {
  promotionProducts,
  promotions,
} from "@/infrastructure/database/schema/discounts";

export type PromotionDisplayStatus =
  | "ACTIVE"
  | "SCHEDULED"
  | "EXPIRED"
  | "INACTIVE";

export interface PromotionListItem {
  id: string;
  name: string;
  description: string | null;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  status: PromotionDisplayStatus;
  productCount: number;
}

export interface PromotionList {
  items: PromotionListItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

export type PromotionStatusFilter = "all" | "active" | "inactive" | "scheduled" | "expired";

function deriveStatus(
  row: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): PromotionDisplayStatus {
  if (!row.isActive) return "INACTIVE";
  if (row.startsAt !== null && row.startsAt.getTime() > now.getTime()) return "SCHEDULED";
  if (row.endsAt !== null && row.endsAt.getTime() < now.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/** Searchable, paginated promotion list with mapped-product counts. */
export async function listPromotions(opts: {
  query?: string;
  status?: PromotionStatusFilter;
  page?: number;
  pageSize?: number;
  now?: Date;
}): Promise<PromotionList> {
  const now = opts.now ?? new Date();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const conditions = [];
  if (opts.query && opts.query.trim() !== "") {
    conditions.push(ilike(promotions.name, `%${opts.query.trim()}%`));
  }
  switch (opts.status ?? "all") {
    case "active":
      conditions.push(eq(promotions.isActive, true));
      break;
    case "inactive":
      conditions.push(eq(promotions.isActive, false));
      break;
    case "scheduled":
      conditions.push(sql`${promotions.startsAt} > ${now.toISOString()}`);
      break;
    case "expired":
      conditions.push(sql`${promotions.endsAt} <= ${now.toISOString()}`);
      break;
    case "all":
      break;
  }
  const where = conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined;

  const rows = await db
    .select()
    .from(promotions)
    .where(where)
    .orderBy(desc(promotions.createdAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(promotions)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const counts =
    items.length > 0
      ? ((await db.execute(sql`
          SELECT promotion_id, COUNT(*)::int AS count
          FROM promotion_products
          WHERE promotion_id IN (${sql.join(items.map((i) => sql`${i.id}`), sql`, `)})
          GROUP BY promotion_id
        `)) as Array<{ promotion_id: string; count: number }>)
      : [];
  const countMap = new Map(counts.map((c) => [c.promotion_id, c.count]));

  return {
    items: items.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      value: r.value,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      isActive: r.isActive,
      status: deriveStatus(r, now),
      productCount: countMap.get(r.id) ?? 0,
    })),
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    currentPage: page,
  };
}

export interface MappedProductRow {
  productId: string;
  productName: string;
}

export interface PromotionDetail extends PromotionListItem {
  mappedProducts: MappedProductRow[];
}

/** Promotion with its mapped products (names for review; ids for unmap). */
export async function getPromotionDetail(
  id: string,
  now: Date = new Date(),
): Promise<PromotionDetail | null> {  const [row] = await db.select().from(promotions).where(eq(promotions.id, id));
  if (!row) return null;
  const mapped = await db
    .select({ productId: promotionProducts.productId, productName: products.name })
    .from(promotionProducts)
    .innerJoin(products, eq(products.id, promotionProducts.productId))
    .where(eq(promotionProducts.promotionId, id))
    .orderBy(products.name);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    value: row.value,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    status: deriveStatus(row, now),
    productCount: mapped.length,
    mappedProducts: mapped,
  };
}

export interface ProductSearchRow {
  id: string;
  name: string;
  basePrice: string;
  mapped: boolean;
}

/** Product picker for mappings: name search with mapped flags for context. */
export async function searchProductsForMapping(
  promotionId: string,
  query: string,
  limit = 20,
): Promise<ProductSearchRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db
    .select({ id: products.id, name: products.name, basePrice: products.basePrice })
    .from(products)
    .where(ilike(products.name, `%${q}%`))
    .orderBy(products.name)
    .limit(limit);
  if (rows.length === 0) return rows.map((r) => ({ ...r, mapped: false }));
  const mapped = await db
    .select({ productId: promotionProducts.productId })
    .from(promotionProducts)
    .where(
      and(
        eq(promotionProducts.promotionId, promotionId),
        inArray(
          promotionProducts.productId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const mappedSet = new Set(mapped.map((m) => m.productId));
  return rows.map((r) => ({ ...r, mapped: mappedSet.has(r.id) }));
}

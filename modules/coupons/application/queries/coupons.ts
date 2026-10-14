import { and, desc, eq, ilike, lte, or, isNull, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { coupons, couponUsages } from "@/infrastructure/database/schema/discounts";
import { orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import { deriveCouponStatus, type CouponDisplayStatus } from "@/modules/coupons/domain/coupon-rules";

export interface CouponListItem {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  minimumOrderAmount: string | null;
  maximumDiscountAmount: string | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  status: CouponDisplayStatus;
}

export interface CouponList {
  items: CouponListItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

export type CouponStatusFilter =
  | "all"
  | "active"
  | "inactive"
  | "scheduled"
  | "expired"
  | "exhausted";

function toListItem(row: typeof coupons.$inferSelect, now: Date): CouponListItem {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    minimumOrderAmount: row.minimumOrderAmount,
    maximumDiscountAmount: row.maximumDiscountAmount,
    usageLimit: row.usageLimit,
    perUserLimit: row.perUserLimit,
    usageCount: row.usageCount,
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    isActive: row.isActive,
    status: deriveCouponStatus(
      {
        isActive: row.isActive,
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
        usageLimit: row.usageLimit,
        usageCount: row.usageCount,
      },
      now,
    ),
  };
}

/**
 * Searchable, paginated coupon list. `query` matches code prefix
 * (case-insensitive; codes are stored uppercase). Derived statuses that
 * need no extra joins are filtered in SQL so pagination stays exact.
 */
export async function listCoupons(opts: {
  query?: string;
  status?: CouponStatusFilter;
  page?: number;
  pageSize?: number;
  now?: Date;
}): Promise<CouponList> {
  const now = opts.now ?? new Date();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const status = opts.status ?? "all";
  // Raw SQL fragments bind timestamps as ISO walls (the driver cannot bind
  // Date objects inside `sql` templates); drizzle's own operators below
  // handle Date mapping themselves.
  const nowIso = now.toISOString();

  const conditions = [];
  if (opts.query && opts.query.trim() !== "") {
    conditions.push(ilike(coupons.code, `${opts.query.trim().toUpperCase()}%`));
  }
  switch (status) {
    case "active":
      conditions.push(eq(coupons.isActive, true));
      conditions.push(or(isNull(coupons.startsAt), lte(coupons.startsAt, now))!);
      conditions.push(or(isNull(coupons.expiresAt), sql`${coupons.expiresAt} > ${nowIso}`)!);
      break;
    case "inactive":
      conditions.push(eq(coupons.isActive, false));
      break;
    case "scheduled":
      conditions.push(sql`${coupons.startsAt} IS NOT NULL AND ${coupons.startsAt} > ${nowIso}`);
      break;
    case "expired":
      conditions.push(sql`${coupons.expiresAt} IS NOT NULL AND ${coupons.expiresAt} <= ${nowIso}`);
      break;
    case "exhausted":
      conditions.push(
        sql`${coupons.usageLimit} IS NOT NULL AND ${coupons.usageCount} >= ${coupons.usageLimit}`,
      );
      break;
    case "all":
      break;
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coupons)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select()
    .from(coupons)
    .where(where)
    .orderBy(desc(coupons.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((r) => toListItem(r, now)),
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    currentPage: page,
  };
}

export interface CouponUsageRow {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  userEmail: string | null;
  discountAmount: string | null;
  code: string | null;
  createdAt: Date;
}

export interface CouponDetail extends CouponListItem {
  usages: CouponUsageRow[];
}

/** Coupon with its redemption history (order numbers, no sensitive data). */
export async function getCouponDetail(id: string, now: Date = new Date()): Promise<CouponDetail | null> {
  const [row] = await db.select().from(coupons).where(eq(coupons.id, id));
  if (!row) return null;
  const usageRows = await db
    .select({
      id: couponUsages.id,
      orderId: couponUsages.orderId,
      orderNumber: orders.orderNumber,
      userEmail: user.email,
      discountAmount: couponUsages.discountAmount,
      code: couponUsages.code,
      createdAt: couponUsages.createdAt,
    })
    .from(couponUsages)
    .leftJoin(orders, eq(orders.id, couponUsages.orderId))
    .leftJoin(user, eq(user.id, couponUsages.userId))
    .where(eq(couponUsages.couponId, id))
    .orderBy(desc(couponUsages.createdAt))
    .limit(200);
  return {
    ...toListItem(row, now),
    usages: usageRows.map((u) => ({
      id: u.id,
      orderId: u.orderId,
      orderNumber: u.orderNumber,
      userEmail: u.userEmail,
      discountAmount: u.discountAmount,
      code: u.code,
      createdAt: u.createdAt,
    })),
  };
}

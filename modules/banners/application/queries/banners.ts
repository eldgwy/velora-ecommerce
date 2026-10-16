import { and, asc, eq, ilike, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { banners } from "@/infrastructure/database/schema/marketing";
import { isBannerEligible, type BannerStatus } from "@/modules/banners/domain/banner-rules";

export interface BannerListItem {
  id: string;
  title: string;
  subtitle: string | null;
  image: string;
  mobileImage: string | null;
  link: string | null;
  sortOrder: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: BannerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface BannerList {
  items: BannerListItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

function toListItem(row: typeof banners.$inferSelect): BannerListItem {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    image: row.image,
    mobileImage: row.mobileImage,
    link: row.link,
    sortOrder: row.sortOrder,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Admin banner list: searchable, paginated, display order. */
export async function listBanners(opts: {
  query?: string;
  status?: BannerStatus;
  page?: number;
  pageSize?: number;
}): Promise<BannerList> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const conditions = [];
  if (opts.query && opts.query.trim() !== "") {
    conditions.push(ilike(banners.title, `%${opts.query.trim()}%`));
  }
  if (opts.status) {
    conditions.push(eq(banners.status, opts.status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(banners)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select()
    .from(banners)
    .where(where)
    .orderBy(asc(banners.sortOrder), asc(banners.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map(toListItem),
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    currentPage: page,
  };
}

export interface PublicBanner {
  id: string;
  title: string;
  subtitle: string | null;
  image: string;
  mobileImage: string | null;
  link: string | null;
  sortOrder: number | null;
}

/**
 * Eligible banners for the storefront carousel with one clock value:
 * stored ACTIVE, inside the inclusive window, ordered by sortOrder ASC
 * with id as the deterministic tie-break. Drafts, scheduled, expired, and
 * out-of-window rows are excluded here regardless of sync state.
 */
export async function getEligibleBanners(now: Date = new Date()): Promise<PublicBanner[]> {
  const rows = await db
    .select({
      id: banners.id,
      title: banners.title,
      subtitle: banners.subtitle,
      image: banners.image,
      mobileImage: banners.mobileImage,
      link: banners.link,
      sortOrder: banners.sortOrder,
      startsAt: banners.startsAt,
      endsAt: banners.endsAt,
      status: banners.status,
    })
    .from(banners)
    .where(eq(banners.status, "ACTIVE"))
    .orderBy(asc(banners.sortOrder), asc(banners.id));
  return rows
    .filter((r) =>
      isBannerEligible({ status: r.status as BannerStatus, startsAt: r.startsAt, endsAt: r.endsAt }, now),
    )
    .map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      image: r.image,
      mobileImage: r.mobileImage,
      link: r.link,
      sortOrder: r.sortOrder,
    }));
}

/** Single banner for the admin edit view (any status). */
export async function getBannerDetail(id: string): Promise<BannerListItem | null> {
  const [row] = await db.select().from(banners).where(eq(banners.id, id));
  return row ? toListItem(row) : null;
}

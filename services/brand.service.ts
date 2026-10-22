import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import {
  brands,
} from "@/infrastructure/database/schema/catalog";
import { logger } from "@/shared/lib/logging/logger";

// ============================================
// Types
// ============================================

export type BrandRow = typeof brands.$inferSelect;
export type BrandInsertData = Omit<typeof brands.$inferInsert, "createdAt" | "updatedAt">;
export type BrandPatch = Partial<Omit<BrandInsertData, "id">>;

// ============================================
// CRUD
// ============================================

export async function listBrands(): Promise<BrandRow[]> {
  return db.select().from(brands);
}

/** Admin console page size for the brands table. */
export const ADMIN_BRANDS_PAGE_SIZE = 20;

export interface AdminBrandsPage {
  items: BrandRow[];
  total: number;
  currentPage: number;
  totalPages: number;
}

/**
 * Server-side paginated admin brand listing. Deterministic ordering:
 * name ASC with id ASC as a unique tie-breaker (two identical names are
 * otherwise ambiguous under LIMIT/OFFSET). Filter first, then one page
 * selected via LIMIT/OFFSET with an exact COUNT over the same filtered
 * population — the whole table is never loaded.
 */
export async function listAdminBrands(opts: {
  page?: number;
  pageSize?: number;
} = {}): Promise<AdminBrandsPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(Math.max(1, Math.floor(opts.pageSize ?? ADMIN_BRANDS_PAGE_SIZE)), 100);

  const [rows, countRows] = await Promise.all([
    db.select().from(brands).orderBy(asc(brands.name), asc(brands.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(brands),
  ]);

  const total = countRows[0]?.count ?? 0;
  return {
    items: rows,
    total,
    currentPage: page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getBrandById(
  id: string,
): Promise<BrandRow | null> {
  const [row] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, id));
  return row ?? null;
}

export async function getBrandBySlug(
  slug: string,
): Promise<BrandRow | null> {
  const [row] = await db
    .select()
    .from(brands)
    .where(eq(brands.slug, slug));
  return row ?? null;
}

export async function createBrand(
  data: BrandInsertData,
  userId?: string,
  requestId?: string,
): Promise<BrandRow> {
  const [created] = await db.insert(brands).values(data).returning();
  if (!created) throw new Error("Brand insert returned no row");
  logger.catalog.brandCreated(created.id, userId ?? "unknown", requestId);
  return created;
}

export async function updateBrand(
  id: string,
  patch: BrandPatch,
  userId?: string,
  requestId?: string,
): Promise<BrandRow | null> {
  const [updated] = await db
    .update(brands)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(brands.id, id))
    .returning();

  if (updated) {
    const changes = Object.keys(patch);
    logger.catalog.brandUpdated(id, changes, userId ?? "unknown", requestId);
  }
  return updated ?? null;
}

export async function deleteBrand(
  id: string,
  userId?: string,
  requestId?: string,
): Promise<boolean> {
  const result = await db.delete(brands).where(eq(brands.id, id)).returning();
  if (result.length > 0) {
    logger.catalog.brandDeleted(id, userId ?? "unknown", requestId);
  }
  return result.length > 0;
}
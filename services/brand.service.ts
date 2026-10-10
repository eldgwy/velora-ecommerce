import { and, eq } from "drizzle-orm";
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
  logger.catalog.brandCreated(created.id, userId ?? "unknown", requestId);
  return created!;
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
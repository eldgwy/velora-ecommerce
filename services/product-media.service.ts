import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import {
  productImages,
} from "@/infrastructure/database/schema/catalog";
import { logger } from "@/shared/lib/logging/logger";

// ============================================
// Types
// ============================================

export type ImageRow = typeof productImages.$inferSelect;
export type ImageInsertData = Omit<typeof productImages.$inferInsert, "createdAt" | "updatedAt">;
export type ImagePatch = Partial<Omit<ImageInsertData, "id" | "productId">>;

// ============================================
// CRUD
// ============================================

export async function listImagesByProduct(
  productId: string,
): Promise<ImageRow[]> {
  return db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(
      sql`${productImages.sortOrder} ASC NULLS LAST`,
      productImages.createdAt,
    );
}

export async function getImageById(
  id: string,
): Promise<ImageRow | null> {
  const [row] = await db
    .select()
    .from(productImages)
    .where(eq(productImages.id, id));
  return row ?? null;
}

export async function createImage(
  data: ImageInsertData,
  userId?: string,
  requestId?: string,
): Promise<ImageRow> {
  const [created] = await db
    .insert(productImages)
    .values(data)
    .returning();
  logger.catalog.imageCreated(created.id, data.productId, created.isPrimary, userId ?? "unknown", requestId);
  return created!;
}

export async function updateImage(
  id: string,
  patch: ImagePatch,
  userId?: string,
  requestId?: string,
): Promise<ImageRow | null> {
  const [updated] = await db
    .update(productImages)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(productImages.id, id))
    .returning();

  if (updated) {
    const changes = Object.keys(patch);
    logger.catalog.imageUpdated(id, changes, userId ?? "unknown", requestId);

    if ("isPrimary" in patch && patch.isPrimary) {
      logger.catalog.imagePrimarySet(id, updated.productId, userId ?? "unknown", requestId);
    }
  }
  return updated ?? null;
}

export async function deleteImage(
  id: string,
  userId?: string,
  requestId?: string,
): Promise<ImageRow | null> {
  const [deleted] = await db
    .delete(productImages)
    .where(eq(productImages.id, id))
    .returning();

  if (deleted) {
    logger.catalog.imageDeleted(id, deleted.productId, deleted.isPrimary, userId ?? "unknown", requestId);
  }
  return deleted ?? null;
}

// ============================================
// Primary Image Invariant
// ============================================

/**
 * Set an image as primary. Atomically:
 * 1. Unset all other primaries for the product
 * 2. Set the target image as primary
 *
 * The partial unique index on (productId) WHERE isPrimary = true
 * enforces the invariant at the database level.
 */
export async function setPrimaryImage(
  imageId: string,
  userId?: string,
  requestId?: string,
): Promise<ImageRow | null> {
  const image = await getImageById(imageId);
  if (!image) return null;

  return db.transaction(async (tx) => {
    // 1. Unset all existing primaries for this product
    await tx
      .update(productImages)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(productImages.productId, image.productId),
          eq(productImages.isPrimary, true),
        ),
      );

    // 2. Set the target as primary
    const [primary] = await tx
      .update(productImages)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(productImages.id, imageId))
      .returning();

    if (primary) {
      logger.catalog.imagePrimarySet(primary.id, primary.productId, userId ?? "unknown", requestId);
    }

    return primary ?? null;
  });
}

/**
 * Delete an image. If it's the primary image, promote the next image
 * (by sortOrder, then createdAt) as the new primary atomically.
 */
export async function deleteImageSafe(
  id: string,
  userId?: string,
  requestId?: string,
): Promise<{ deleted: ImageRow | null; newPrimary: ImageRow | null }> {
  const image = await getImageById(id);
  if (!image) return { deleted: null, newPrimary: null };

  return db.transaction(async (tx) => {
    // 1. Delete the image
    const [deleted] = await tx
      .delete(productImages)
      .where(eq(productImages.id, id))
      .returning();
    if (!deleted) return { deleted: null, newPrimary: null };

    // 2. If it was primary, promote the next image
    if (image.isPrimary) {
      const [next] = await tx
        .select()
        .from(productImages)
        .where(eq(productImages.productId, image.productId))
        .orderBy(
          sql`${productImages.sortOrder} ASC NULLS LAST`,
          productImages.createdAt,
        )
        .limit(1);

      if (next) {
        await tx
          .update(productImages)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(productImages.id, next.id));
        logger.catalog.imagePrimarySet(next.id, next.productId, userId ?? "unknown", requestId);
        logger.catalog.imageDeleted(id, image.productId, true, userId ?? "unknown", requestId);
        return { deleted, newPrimary: { ...next, isPrimary: true } };
      }
    }

    logger.catalog.imageDeleted(id, image.productId, image.isPrimary, userId ?? "unknown", requestId);
    return { deleted, newPrimary: null };
  });
}

/**
 * Check if a product has exactly one primary image.
 */
export async function getPrimaryImage(
  productId: string,
): Promise<ImageRow | null> {
  const [row] = await db
    .select()
    .from(productImages)
    .where(
      and(
        eq(productImages.productId, productId),
        eq(productImages.isPrimary, true),
      ),
    );
  return row ?? null;
}
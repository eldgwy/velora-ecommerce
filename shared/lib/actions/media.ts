"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { productImages } from "@/infrastructure/database/schema/catalog";
import { requireAdmin } from "@/shared/lib/guards";
import { imageSchema, type ImageFormValues } from "@/shared/types/catalog";
import {
  createImage as createImageService,
  setPrimaryImage as setPrimaryImageService,
  deleteImageSafe as deleteImageSafeService,
  listImagesByProduct,
  getImageById,
} from "@/services/product-media.service";
import { getProductById } from "@/services/product.service";
import {
  createSignedUploadParams,
  deleteImage as deleteCloudinaryImage,
  validateImageFile,
} from "@/infrastructure/cloudinary/client";
import { invalidateImageCache } from "@/shared/lib/cache/tags";
import type { ActionResult } from "@/shared/types/actions";

const GENERIC_ERROR = "We couldn't save the image. Please try again.";
const NOT_FOUND_ERROR = "That product could not be found.";

export async function getSignedUploadParams(
  productId: string,
  folder?: string,
): Promise<{ params: ReturnType<typeof createSignedUploadParams> } | { error: string }> {
  const session = await requireAdmin();

  const product = await getProductById(productId);
  if (!product) return { error: NOT_FOUND_ERROR };

  const params = createSignedUploadParams({
    folder: folder || `velora/products/${productId}`,
    tags: [productId],
  });

  return { params };
}

export async function createProductImage(
  productId: string,
  input: unknown,
): Promise<{ id: string } | { error: string }> {
  const session = await requireAdmin();

  const product = await getProductById(productId);
  if (!product) return { error: NOT_FOUND_ERROR };

  const parsed = imageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  try {
    const created = await createImageService({
      ...parsed.data,
      productId,
    }, session.user.id);

    invalidateImageCache(created.id, productId);
    return { id: created.id };
  } catch (err) {
    console.error("[catalog] createProductImage failed:", err);
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return { error: "This image public ID is already in use." };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function setPrimaryImage(
  imageId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();

  const image = await getImageById(imageId);
  if (!image) return { error: NOT_FOUND_ERROR };

  try {
    const updated = await setPrimaryImageService(imageId, session.user.id);
    if (!updated) return { error: NOT_FOUND_ERROR };

    invalidateImageCache(imageId, image.productId);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] setPrimaryImage failed:", err);
    return { error: GENERIC_ERROR };
  }
}

export async function deleteProductImage(
  imageId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();

  const image = await getImageById(imageId);
  if (!image) return { error: NOT_FOUND_ERROR };

  try {
    const { deleted, newPrimary } = await deleteImageSafeService(imageId, session.user.id);
    if (!deleted) return { error: NOT_FOUND_ERROR };

    // Clean up Cloudinary asset (best-effort, outside transaction)
    if (deleted.publicId) {
      deleteCloudinaryImage(deleted.publicId).catch(() => {
        // Best-effort cleanup; don't fail the request
      });
    }

    invalidateImageCache(imageId, image.productId);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] deleteProductImage failed:", err);
    return { error: GENERIC_ERROR };
  }
}

export async function reorderImages(
  productId: string,
  imageIds: string[],
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();

  const product = await getProductById(productId);
  if (!product) return { error: NOT_FOUND_ERROR };

  try {
    // Update sortOrder for each image
    for (let i = 0; i < imageIds.length; i++) {
      await db
        .update(productImages)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(productImages.id, imageIds[i]));
    }

    invalidateImageCache(imageIds[0] ?? "", productId);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] reorderImages failed:", err);
    return { error: GENERIC_ERROR };
  }
}
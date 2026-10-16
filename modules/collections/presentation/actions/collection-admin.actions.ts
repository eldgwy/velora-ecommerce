"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  addProductToCollection,
  createCollection,
  removeProductFromCollection,
  reorderCollectionProducts,
  setCollectionActive,
  updateCollection,
} from "@/modules/collections/application/commands/collections";
import {
  getCollectionDetail,
  listCollections,
  type CollectionDetail,
  type CollectionList,
} from "@/modules/collections/application/queries/collections";
import {
  CollectionConflictError,
  CollectionNotFoundError,
  CollectionValidationError,
} from "@/modules/collections/domain/collection-errors";

const collectionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  slug: z.string().trim().max(64).optional(),
  description: z.string().trim().max(2000).optional(),
  image: z
    .preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.string().trim().max(2048).optional()),
  isActive: z.coerce.boolean().optional().default(false),
  sortOrder: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).max(9999).optional(),
  ),
});

const listSchema = z.object({
  query: z.string().max(120).optional(),
  isActive: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v === "true" || v === true),
    z.boolean().optional(),
  ),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function collectionFailure(action: string, error: unknown): ActionResult<never> {
  if (
    error instanceof CollectionNotFoundError ||
    error instanceof CollectionConflictError ||
    error instanceof CollectionValidationError
  ) {
    return { ok: false, error: error.message };
  }
  logger.error(`Collection admin action failed: ${action}`, {
    module: "collections",
    action,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "That collection action could not be completed." };
}

/** Paginated, searchable collection list (admin-gated). */
export async function listCollectionsAction(input: unknown): Promise<ActionResult<CollectionList>> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  const result = await listCollections({
    query: parsed.data.query,
    isActive: parsed.data.isActive,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
  return { ok: true, data: result };
}

/** Single collection with ordered mappings (admin-gated). */
export async function getCollectionDetailAction(
  input: unknown,
): Promise<ActionResult<CollectionDetail>> {
  await requireAdmin();
  const parsed = z.string().uuid("Invalid collection.").safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid collection." };
  const detail = await getCollectionDetail(parsed.data);
  if (!detail) return { ok: false, error: "Collection not found." };
  return { ok: true, data: detail };
}

/** Create a collection (admin-gated). Slug derived from name when blank. */
export async function createCollectionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = collectionFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid collection details." };
  }
  try {
    const result = await createCollection({
      name: parsed.data.name,
      slug: parsed.data.slug || null,
      description: parsed.data.description ?? null,
      image: parsed.data.image ?? null,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder ?? null,
    });
    return { ok: true, data: result };
  } catch (error) {
    return collectionFailure("createCollection", error) as ActionResult<{ id: string }>;
  }
}

/** Update metadata/cover/state (admin-gated). Mappings managed separately. */
export async function updateCollectionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = collectionFormSchema
    .extend({ id: z.string().uuid("Invalid collection.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid collection details." };
  }
  try {
    await updateCollection({
      id: parsed.data.id,
      name: parsed.data.name,
      slug: parsed.data.slug || null,
      description: parsed.data.description ?? null,
      image: parsed.data.image ?? null,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder ?? null,
    });
    return { ok: true, data: { id: parsed.data.id } };
  } catch (error) {
    return collectionFailure("updateCollection", error) as ActionResult<{ id: string }>;
  }
}

/** Publish/unpublish (admin-gated). */
export async function setCollectionActiveAction(
  input: unknown,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid("Invalid collection."), isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid collection." };
  try {
    await setCollectionActive(parsed.data.id, parsed.data.isActive);
    return { ok: true, data: parsed.data };
  } catch (error) {
    return collectionFailure("setCollectionActive", error) as ActionResult<{
      id: string;
      isActive: boolean;
    }>;
  }
}

const mappingSchema = z.object({
  collectionId: z.string().uuid("Invalid collection."),
  productId: z.string().uuid("Invalid product."),
});

/** Append a product at the end of the collection order (admin-gated). */
export async function addProductToCollectionAction(
  input: unknown,
): Promise<ActionResult<{ collectionId: string; productId: string }>> {
  await requireAdmin();
  const parsed = mappingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product mapping." };
  try {
    await addProductToCollection(parsed.data.collectionId, parsed.data.productId);
    return { ok: true, data: parsed.data };
  } catch (error) {
    return collectionFailure("addProductToCollection", error) as ActionResult<{
      collectionId: string;
      productId: string;
    }>;
  }
}

/** Remove a mapping; positions collapse densely (admin-gated). */
export async function removeProductFromCollectionAction(
  input: unknown,
): Promise<ActionResult<{ collectionId: string; productId: string }>> {
  await requireAdmin();
  const parsed = mappingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product mapping." };
  try {
    await removeProductFromCollection(parsed.data.collectionId, parsed.data.productId);
    return { ok: true, data: parsed.data };
  } catch (error) {
    return collectionFailure("removeProductFromCollection", error) as ActionResult<{
      collectionId: string;
      productId: string;
    }>;
  }
}

/** Persist an explicit product order (admin-gated). */
export async function reorderCollectionProductsAction(
  input: unknown,
): Promise<ActionResult<{ collectionId: string }>> {
  await requireAdmin();
  const parsed = z
    .object({
      collectionId: z.string().uuid("Invalid collection."),
      orderedProductIds: z.array(z.string().uuid()).min(1).max(500),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product order." };
  try {
    await reorderCollectionProducts(parsed.data.collectionId, parsed.data.orderedProductIds);
    return { ok: true, data: { collectionId: parsed.data.collectionId } };
  } catch (error) {
    return collectionFailure("reorderCollectionProducts", error) as ActionResult<{
      collectionId: string;
    }>;
  }
}

/** Product picker search for mappings (admin-gated, names only). */
export async function searchProductsForCollectionAction(
  input: unknown,
): Promise<
  ActionResult<
    Array<{ id: string; name: string; basePrice: string; mapped: boolean }>
  >
> {
  await requireAdmin();
  const parsed = z
    .object({ collectionId: z.string().uuid(), query: z.string().max(120) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };
  const { searchProductsForCollection } = await import(
    "@/modules/collections/application/queries/collections"
  );
  const rows = await searchProductsForCollection(parsed.data.collectionId, parsed.data.query);
  return { ok: true, data: rows };
}

/**
 * Signed Cloudinary params for collection cover uploads. Scoped to the
 * collection folder; recording the URL still goes through the validated
 * create/update actions.
 */
export async function getCollectionCoverUploadParamsAction(input: unknown): Promise<
  ActionResult<{ params: {
    timestamp: number;
    signature: string;
    apiKey: string;
    cloudName: string;
    folder: string;
    uploadPreset?: string;
  } }>
> {
  await requireAdmin();
  const parsed = z
    .object({ collectionId: z.string().uuid().optional() })
    .safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid upload request." };
  const { createSignedUploadParams } = await import("@/infrastructure/cloudinary/client");
  const params = createSignedUploadParams({
    folder: `velora/collections/${parsed.data.collectionId ?? "new"}`,
    tags: parsed.data.collectionId ? [parsed.data.collectionId] : [],
  });
  return { ok: true, data: { params } };
}

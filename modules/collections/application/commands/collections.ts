import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import {
  collectionProducts,
  collections,
} from "@/infrastructure/database/schema/marketing";
import {
  assertCollectionDescription,
  assertCollectionImage,
  assertCollectionName,
  normalizeCollectionSlug,
  slugifyCollectionName,
} from "@/modules/collections/domain/collection-rules";
import {
  CollectionConflictError,
  CollectionNotFoundError,
  CollectionValidationError,
} from "@/modules/collections/domain/collection-errors";
import { invalidateCollectionCache } from "@/shared/lib/cache/tags";
import { logger } from "@/shared/lib/logging/logger";

export interface CollectionTermsInput {
  name: string;
  /** Optional explicit slug; derived from the name when omitted. */
  slug?: string | null;
  description?: string | null;
  /** Provider-uploaded HTTPS cover URL (or null to clear). */
  image?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
}

function validateTerms(input: CollectionTermsInput) {
  const name = assertCollectionName(input.name);
  const slug =
    input.slug !== null && input.slug !== undefined && input.slug.trim() !== ""
      ? normalizeCollectionSlug(input.slug)
      : slugifyCollectionName(name);
  const description = assertCollectionDescription(input.description);
  const image = assertCollectionImage(input.image);
  let sortOrder: number | null = null;
  if (input.sortOrder !== null && input.sortOrder !== undefined) {
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 9999) {
      throw new CollectionValidationError("Sort order must be an integer from 0 to 9999.");
    }
    sortOrder = input.sortOrder;
  }
  return { name, slug, description, image, sortOrder };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.code === "23505") return true;
      if (typeof record.message === "string" && record.message.includes("duplicate key value")) {
        return true;
      }
      current = "cause" in record ? record.cause : null;
      continue;
    }
    return false;
  }
  return false;
}

async function invalidateCollection(slug: string): Promise<void> {
  try {
    await invalidateCollectionCache(slug);
  } catch (error) {
    // Commands also run outside Server Actions (tests, scripts) where tag
    // invalidation is unavailable; the time-based revalidate window bounds
    // staleness there. Anything else is a real failure.
    if (error instanceof Error && /Server Action/.test(error.message)) return;
    throw error;
  }
}

/**
 * Create a collection. Starts inactive unless requested — nothing is
 * public until explicitly published. Slug races surface as domain
 * conflicts, never raw constraint errors.
 */
export async function createCollection(input: CollectionTermsInput): Promise<{ id: string }> {
  const terms = validateTerms(input);
  try {
    const [created] = await db
      .insert(collections)
      .values({
        name: terms.name,
        slug: terms.slug,
        description: terms.description,
        image: terms.image,
        isActive: input.isActive ?? false,
        sortOrder: terms.sortOrder,
      })
      .returning({ id: collections.id, slug: collections.slug });
    if (!created) throw new Error("Collection insert failed");
    logger.info("Collection created", {
      module: "collections",
      action: "collectionCreated",
      collectionId: created.id,
    });
    await invalidateCollection(created.slug);
    return { id: created.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CollectionConflictError(`A collection with slug "${terms.slug}" already exists.`);
    }
    throw error;
  }
}

export interface CollectionUpdateInput extends CollectionTermsInput {
  id: string;
  isActive: boolean;
}

/** Update metadata/cover/state. Product mappings are managed separately. */
export async function updateCollection(input: CollectionUpdateInput): Promise<void> {
  const terms = validateTerms(input);
  try {
    const updated = await db
      .update(collections)
      .set({
        name: terms.name,
        slug: terms.slug,
        description: terms.description,
        image: terms.image,
        isActive: input.isActive,
        sortOrder: terms.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(collections.id, input.id))
      .returning({ id: collections.id, slug: collections.slug });
    if (updated.length === 0) throw new CollectionNotFoundError(input.id);
    logger.info("Collection updated", {
      module: "collections",
      action: "collectionUpdated",
      collectionId: input.id,
    });
    await invalidateCollection(updated[0]!.slug);
  } catch (error) {
    if (error instanceof CollectionNotFoundError) throw error;
    if (isUniqueViolation(error)) {
      throw new CollectionConflictError(`A collection with slug "${terms.slug}" already exists.`);
    }
    throw error;
  }
}

/** Flip publication. Unpublished collections vanish from public queries. */
export async function setCollectionActive(id: string, isActive: boolean): Promise<void> {
  const updated = await db
    .update(collections)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning({ id: collections.id, slug: collections.slug });
  if (updated.length === 0) throw new CollectionNotFoundError(id);
  await invalidateCollection(updated[0]!.slug);
}

/**
 * Append a product at the end of the collection order. Duplicate mappings
 * reject as domain conflicts; missing products reject as validation.
 */
export async function addProductToCollection(
  collectionId: string,
  productId: string,
): Promise<void> {
  const [collection] = await db
    .select({ id: collections.id, slug: collections.slug })
    .from(collections)
    .where(eq(collections.id, collectionId));
  if (!collection) throw new CollectionNotFoundError(collectionId);
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) {
    throw new CollectionValidationError("The selected product does not exist.");
  }
  try {
    await db.insert(collectionProducts).values({
      collectionId,
      productId,
      sortOrder: await nextSortOrder(collectionId),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CollectionConflictError("That product is already in this collection.");
    }
    throw error;
  }
  await invalidateCollection(collection.slug);
}

async function nextSortOrder(collectionId: string): Promise<number> {
  const rows = await db
    .select({ sortOrder: collectionProducts.sortOrder })
    .from(collectionProducts)
    .where(eq(collectionProducts.collectionId, collectionId));
  const max = rows.reduce((m, r) => Math.max(m, r.sortOrder ?? -1), -1);
  return max + 1;
}

/** Remove a mapping. Remaining positions collapse to stay dense. */
export async function removeProductFromCollection(
  collectionId: string,
  productId: string,
): Promise<void> {
  const [collection] = await db
    .select({ id: collections.id, slug: collections.slug })
    .from(collections)
    .where(eq(collections.id, collectionId));
  if (!collection) throw new CollectionNotFoundError(collectionId);
  await db.transaction(async (tx) => {
    await tx
      .delete(collectionProducts)
      .where(
        and(
          eq(collectionProducts.collectionId, collectionId),
          eq(collectionProducts.productId, productId),
        ),
      );
    await normalizePositions(tx, collectionId);
  });
  await invalidateCollection(collection.slug);
}

/**
 * Reorder a collection from an explicit ordered product-id array. The
 * array must contain exactly the currently mapped set — no missing,
 * extra, or foreign ids — so positions can never go stale or duplicate.
 * Dense positions 0..n-1 are written in one transaction.
 */
export async function reorderCollectionProducts(
  collectionId: string,
  orderedProductIds: string[],
): Promise<void> {
  const [collection] = await db
    .select({ id: collections.id, slug: collections.slug })
    .from(collections)
    .where(eq(collections.id, collectionId));
  if (!collection) throw new CollectionNotFoundError(collectionId);
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ productId: collectionProducts.productId })
      .from(collectionProducts)
      .where(eq(collectionProducts.collectionId, collectionId));
    const currentSet = new Set(current.map((r) => r.productId));
    const nextSet = new Set(orderedProductIds);
    if (currentSet.size !== nextSet.size || ![...nextSet].every((id) => currentSet.has(id))) {
      throw new CollectionConflictError(
        "The new order must contain exactly the collection's current products.",
      );
    }
    for (const [index, productId] of orderedProductIds.entries()) {
      await tx
        .update(collectionProducts)
        .set({ sortOrder: index })
        .where(
          and(
            eq(collectionProducts.collectionId, collectionId),
            eq(collectionProducts.productId, productId),
          ),
        );
    }
  });
  await invalidateCollection(collection.slug);
}

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Renumber positions densely after removals (0..n-1 by current order). */
async function normalizePositions(tx: TxClient, collectionId: string): Promise<void> {
  const rows = await tx
    .select({ productId: collectionProducts.productId, sortOrder: collectionProducts.sortOrder })
    .from(collectionProducts)
    .where(eq(collectionProducts.collectionId, collectionId));
  const ordered = rows
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const [index, row] of ordered.entries()) {
    await tx
      .update(collectionProducts)
      .set({ sortOrder: index })
      .where(
        and(
          eq(collectionProducts.collectionId, collectionId),
          eq(collectionProducts.productId, row.productId),
        ),
      );
  }
}

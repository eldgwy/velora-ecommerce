"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/shared/lib/guards";
import { variantSchema, type VariantFormValues } from "@/shared/types/catalog";
import {
  createVariantWithInventory,
  setVariantOptionValues,
  combinationExists,
  getVariantById,
  updateVariant as updateVariantService,
} from "@/services/product-variant.service";
import { listOptionsByProduct, listOptionValuesByOption } from "@/services/product-option.service";
import { getProductById } from "@/services/product.service";
import { invalidateVariantCache } from "@/shared/lib/cache/tags";
import type { ActionResult } from "@/shared/types/actions";

const GENERIC_ERROR = "We couldn't save the variant. Please try again.";
const NOT_FOUND_ERROR = "That product could not be found.";
const DUPLICATE_ERROR = "A variant with this combination already exists.";
const SKU_TAKEN_ERROR = "This SKU is already in use.";
const INVALID_OPTION_VALUES_ERROR = "One or more option values are invalid for this product.";

/**
 * Verify that all option value IDs belong to options of the given product.
 */
async function validateOptionValuesForProduct(
  productId: string,
  optionValueIds: string[],
): Promise<void> {
  if (optionValueIds.length === 0) return;

  // Get all option values for this product's options
  const options = await listOptionsByProduct(productId);
  const validOptionValueIds = new Set<string>();

  for (const opt of options) {
    const values = await listOptionValuesByOption(opt.id);
    for (const v of values) {
      validOptionValueIds.add(v.id);
    }
  }

  for (const ovId of optionValueIds) {
    if (!validOptionValueIds.has(ovId)) {
      throw new Error(INVALID_OPTION_VALUES_ERROR);
    }
  }
}

export async function createVariant(
  productId: string,
  input: unknown,
): Promise<{ id: string } | { error: string }> {
  const session = await requireAdmin();

  const product = await getProductById(productId);
  if (!product) return { error: NOT_FOUND_ERROR };

  const parsed = variantSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  // Verify all option values belong to this product
  try {
    await validateOptionValuesForProduct(productId, parsed.data.optionValueIds);
  } catch (err) {
    if (err instanceof Error && err.message === INVALID_OPTION_VALUES_ERROR) {
      return { error: INVALID_OPTION_VALUES_ERROR };
    }
    throw err;
  }

  // Check for duplicate combination
  const dup = await combinationExists(productId, parsed.data.optionValueIds);
  if (dup) return { error: DUPLICATE_ERROR };

  try {
    const { variant } = await createVariantWithInventory(
      {
        productId,
        sku: parsed.data.sku,
        description: parsed.data.description,
        priceOverride: parsed.data.priceOverride?.toString(),
        status: parsed.data.status,
      },
      { quantity: 0, reservedQuantity: 0 },
      session.user.id,
    );

    await setVariantOptionValues(variant.id, parsed.data.optionValueIds, productId);

    invalidateVariantCache(variant.id, productId);
    return { id: variant.id };
  } catch (err) {
    console.error("[catalog] createVariant failed:", err);
    if (err instanceof Error && err.message.includes("duplicate key")) {
      if (err.message.includes("sku")) return { error: SKU_TAKEN_ERROR };
      return { error: DUPLICATE_ERROR };
    }
    if (err instanceof Error && err.message === INVALID_OPTION_VALUES_ERROR) {
      return { error: INVALID_OPTION_VALUES_ERROR };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function updateVariant(
  id: string,
  input: Partial<VariantFormValues>,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();

  const variant = await getVariantById(id);
  if (!variant) return { error: NOT_FOUND_ERROR };

  // Validate option values if provided
  if (input.optionValueIds) {
    try {
      await validateOptionValuesForProduct(variant.productId, input.optionValueIds);
    } catch (err) {
      if (err instanceof Error && err.message === INVALID_OPTION_VALUES_ERROR) {
        return { error: INVALID_OPTION_VALUES_ERROR };
      }
      throw err;
    }
  }

  // Check for duplicate combination if option values are changing
  if (input.optionValueIds) {
    const dup = await combinationExists(variant.productId, input.optionValueIds, id);
    if (dup) return { error: DUPLICATE_ERROR };
  }

  try {
    const updated = await updateVariantService(id, {
      sku: input.sku,
      description: input.description,
      priceOverride: input.priceOverride !== undefined ? String(input.priceOverride) : undefined,
      status: input.status,
    }, session.user.id);
    if (!updated) return { error: NOT_FOUND_ERROR };

    if (input.optionValueIds) {
      await setVariantOptionValues(id, input.optionValueIds, variant.productId);
    }

    invalidateVariantCache(id, variant.productId);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] updateVariant failed:", err);
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return { error: SKU_TAKEN_ERROR };
    }
    if (err instanceof Error && err.message === INVALID_OPTION_VALUES_ERROR) {
      return { error: INVALID_OPTION_VALUES_ERROR };
    }
    return { error: GENERIC_ERROR };
  }
}
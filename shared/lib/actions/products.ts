"use server";

import { requireAdmin } from "@/shared/lib/guards";
import { productSchema, type ProductFormValues } from "@/shared/types/catalog";
import {
  createProduct as createProductService,
  updateProduct as updateProductService,
  deleteProduct as deleteProductService,
  getProductById,
} from "@/services/product.service";
import { invalidateProductCache } from "@/shared/lib/cache/tags";
import type { ActionResult } from "@/shared/types/actions";

const GENERIC_ERROR = "We couldn't save the product. Please try again.";
const NOT_FOUND_ERROR = "That product could not be found.";

export async function createProduct(
  input: unknown,
): Promise<{ id: string } | { error: string }> {
  const session = await requireAdmin();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  try {
    const created = await createProductService(
      {
        ...parsed.data,
        basePrice: parsed.data.basePrice.toString(),
        comparePrice: parsed.data.comparePrice?.toString() ?? null,
      },
      session.user.id
    );
    invalidateProductCache(created.id, parsed.data.slug);
    return { id: created.id };
  } catch (err) {
    console.error("[catalog] createProduct failed:", err);
    if (err instanceof Error && err.message.includes("foreign key")) {
      return { error: "Category or brand not found." };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function updateProduct(
  id: string,
  input: unknown,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  const existing = await getProductById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  try {
    const updated = await updateProductService(
      id,
      {
        ...parsed.data,
        basePrice: parsed.data.basePrice.toString(),
        comparePrice: parsed.data.comparePrice?.toString() ?? null,
      },
      session.user.id
    );
    if (!updated) return { error: NOT_FOUND_ERROR };
    invalidateProductCache(id, parsed.data.slug ?? existing.id);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] updateProduct failed:", err);
    if (err instanceof Error && err.message.includes("foreign key")) {
      return { error: "Category or brand not found." };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function updateProductStatus(
  id: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVE",
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();
  const existing = await getProductById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  try {
    const updated = await updateProductService(id, { status }, session.user.id);
    if (!updated) return { error: NOT_FOUND_ERROR };
    invalidateProductCache(id, existing.id);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] updateProductStatus failed:", err);
    return { error: GENERIC_ERROR };
  }
}

export async function deleteProduct(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();
  const existing = await getProductById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  try {
    await deleteProductService(id, session.user.id);
    invalidateProductCache(id, existing.id);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] deleteProduct failed:", err);
    return { error: GENERIC_ERROR };
  }
}
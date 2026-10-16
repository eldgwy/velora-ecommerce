"use server";

import { requireAdmin } from "@/shared/lib/guards";
import { categorySchema } from "@/shared/types/catalog";
import {
  createCategory as createCategoryService,
  updateCategory as updateCategoryService,
  deactivateCategory as deactivateCategoryService,
  activateCategory as activateCategoryService,
  getCategoryById,
  wouldCreateCycle,
  validateParentCategory,
} from "@/services/catalog.service";
import { invalidateCategoryCache } from "@/shared/lib/cache/tags";

const GENERIC_ERROR = "We couldn't save the category. Please try again.";
const NOT_FOUND_ERROR = "That category could not be found.";
const CYCLE_ERROR = "This change would create a cycle in the category hierarchy.";
const SLUG_TAKEN_ERROR = "A category with that slug already exists.";
const PARENT_NOT_FOUND_ERROR = "Parent category not found.";

export async function createCategory(
  input: unknown,
): Promise<{ id: string } | { error: string }> {
  const session = await requireAdmin();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  // Validate parent exists
  if (parsed.data.parentId) {
    try {
      await validateParentCategory(parsed.data.parentId);
    } catch {
      return { error: PARENT_NOT_FOUND_ERROR };
    }
  }

  try {
    const created = await createCategoryService(parsed.data, session.user.id);
    invalidateCategoryCache(created.id);
    return { id: created.id };
  } catch (err) {
    console.error("[catalog] createCategory failed:", err);
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return { error: SLUG_TAKEN_ERROR };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function updateCategory(
  id: string,
  input: unknown,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  const existing = await getCategoryById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  // Validate parent exists
  if (parsed.data.parentId !== undefined && parsed.data.parentId) {
    try {
      await validateParentCategory(parsed.data.parentId);
    } catch {
      return { error: PARENT_NOT_FOUND_ERROR };
    }
  }

  // Cycle detection
  if (parsed.data.parentId !== undefined) {
    const cycle = await wouldCreateCycle(id, parsed.data.parentId ?? null);
    if (cycle) return { error: CYCLE_ERROR };
  }

  try {
    const updated = await updateCategoryService(id, parsed.data, session.user.id);
    if (!updated) return { error: NOT_FOUND_ERROR };
    invalidateCategoryCache(id);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] updateCategory failed:", err);
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return { error: SLUG_TAKEN_ERROR };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function setCategoryParent(
  id: string,
  parentId: string | null,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();

  const existing = await getCategoryById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  // Validate parent exists
  if (parentId) {
    try {
      await validateParentCategory(parentId);
    } catch {
      return { error: PARENT_NOT_FOUND_ERROR };
    }
  }

  const cycle = await wouldCreateCycle(id, parentId);
  if (cycle) return { error: CYCLE_ERROR };

  try {
    const updated = await updateCategoryService(id, { parentId: parentId ?? null }, session.user.id);
    if (!updated) return { error: NOT_FOUND_ERROR };
    invalidateCategoryCache(id);
    if (parentId) invalidateCategoryCache(parentId);
    if (existing.parentId) invalidateCategoryCache(existing.parentId);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] setCategoryParent failed:", err);
    return { error: GENERIC_ERROR };
  }
}

export async function toggleCategoryActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();

  const existing = await getCategoryById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  try {
    const updated = isActive
      ? await activateCategoryService(id, session.user.id)
      : await deactivateCategoryService(id, session.user.id);
    if (!updated) return { error: NOT_FOUND_ERROR };

    invalidateCategoryCache(id);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] toggleCategoryActive failed:", err);
    return { error: GENERIC_ERROR };
  }
}
"use server";

import { requireAdmin } from "@/shared/lib/guards";
import { brandSchema } from "@/shared/types/catalog";
import {
  createBrand as createBrandService,
  updateBrand as updateBrandService,
  deleteBrand as deleteBrandService,
  getBrandById,
} from "@/services/brand.service";
import { invalidateBrandCache } from "@/shared/lib/cache/tags";

const GENERIC_ERROR = "We couldn't save the brand. Please try again.";
const NOT_FOUND_ERROR = "That brand could not be found.";

export async function createBrand(
  input: unknown,
): Promise<{ id: string } | { error: string }> {
  const session = await requireAdmin();
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  try {
    const created = await createBrandService(parsed.data, session.user.id);
    invalidateBrandCache(created.id);
    return { id: created.id };
  } catch (err) {
    console.error("[catalog] createBrand failed:", err);
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return { error: "A brand with that slug already exists." };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function updateBrand(
  id: string,
  input: unknown,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please review the form." };

  const existing = await getBrandById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  try {
    const updated = await updateBrandService(id, parsed.data, session.user.id);
    if (!updated) return { error: NOT_FOUND_ERROR };
    invalidateBrandCache(id);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] updateBrand failed:", err);
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return { error: "A brand with that slug already exists." };
    }
    return { error: GENERIC_ERROR };
  }
}

export async function deleteBrand(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin();
  const existing = await getBrandById(id);
  if (!existing) return { error: NOT_FOUND_ERROR };

  try {
    await deleteBrandService(id, session.user.id);
    invalidateBrandCache(id);
    return { ok: true };
  } catch (err) {
    console.error("[catalog] deleteBrand failed:", err);
    return { error: GENERIC_ERROR };
  }
}